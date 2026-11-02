// Seam 9b (shell/useStudyActions) — THE WRITE-SIDE ACTIONS, Phase 04.
//
// PORTED FROM (by symbol, app.js): recordQuizResult, announceCompletion's data half,
// startBlockAiQuiz, startGeneratedQuiz, generatedCountFor, generateScopeText, setAiQuiz,
// setBlockQuiz, the #tutorial-to-quiz-btn listener, the #generate-new-btn listener,
// syncAiQuizButton's readiness rule, flushPendingProgress on load.
//
// ⛔ WHY A HOOK AND NOT A CONTEXT. Every action here ends in a SCREEN SWITCH, and the screen
//    is owned by shell/AppShell ("a screen does not show its siblings"). The shell calls this
//    hook and passes the actions down as props, exactly like finishQuiz / resumeQuiz already.
//
// ⛔ recordQuizResult READS THE QUIZ THROUGH A REF. The finish is detected by QuizScreen's
//    effect, whose dependency list includes `onFinish`. If the callback closed over the quiz
//    state it would get a new identity on every answer, and a new identity while the finish
//    condition holds re-runs the effect — i.e. the completion would be POSTED TWICE.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, useProviderReadiness, useQuizSizing, MAX_FRESH_QUIZ_SIZE } from '../data/queries';
import {
  flushPendingProgress,
  generationToken,
  postJson,
  postProgress,
  queuePendingProgress,
} from '../data/writes';
import type { ProgressBody, ProgressReply } from '../data/writes';
import type { QuizQuestion, TheoryCursor } from '../data/types';
import { useBookContext } from '../state/BookProvider';
import { theoryBlockId } from '../state/ProgressProvider';
import { useQuiz } from '../state/QuizProvider';
import { owningBlockId, tallyScore, tallyTotal } from '../state/quizReducer';
import { useReaderCursor } from '../state/ReaderCursorProvider';
import { askConfirm, showNotice } from './dialog';

/** What the result screen says about the save, beyond the score (app.js:745-750 + 1097). */
export interface SaveNote {
  /** The completion could not reach the server; it is queued for the next load. */
  failed: boolean;
  /** A block the server just marked complete — announceCompletion(blockId). */
  completedBlock: string | null;
}

export const AI_ONLY_ON_LIBRARY_BOOKS = 'AI quizzes need a library book';

function blockFromId(id: string): TheoryCursor | null {
  const match = /^ch(\d{2})-b(\d{2})$/.exec(id || '');
  return match ? { chapterIndex: Number(match[1]) - 1, blockIndex: Number(match[2]) - 1 } : null;
}

export interface StudyActionsDeps {
  showQuiz: (scope: 'ai' | 'other') => void;
  showLoading: () => void;
  showHome: () => void;
  showReaderAt: (cursor: TheoryCursor | null) => void;
}

export function useStudyActions({ showQuiz, showLoading, showHome, showReaderAt }: StudyActionsDeps) {
  const queryClient = useQueryClient();
  const { moduleId, activeBookFile, data, blocksOf, quizBank, chapters } = useBookContext();
  const { cursor } = useReaderCursor();
  const provider = useProviderReadiness();
  const { aiQuestionCount, generatedQuizSize } = useQuizSizing();
  const { state, dispatch } = useQuiz();

  const stateRef = useRef(state);
  stateRef.current = state;

  const [saveNote, setSaveNote] = useState<SaveNote>({ failed: false, completedBlock: null });
  const [aiBlockStatus, setAiBlockStatus] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [loading, setLoading] = useState({ scope: '', model: '' });
  const generateMemory = useRef<{ fromSetup: boolean; selection: string[] }>({ fromSetup: false, selection: [] });

  // ⚠ `data` IS the tutorialData (BookProvider), so the title is `data.title`. Reading
  //   `data.tutorialData.title` made this always false and Generate silently did nothing —
  //   caught by gate UI-GENERATE, 23-09-26.
  const hasTitle = Boolean(data?.title);
  // aiReady (app.js:331): a provider AND an open library book.
  const aiReady = provider.ready && Boolean(activeBookFile);

  /** Paint the server's answer into the ONE cache entry every progress reader shares. */
  const applyProgress = useCallback(
    (module: string, reply: ProgressReply | null | undefined) => {
      if (reply && reply.completed) {
        queryClient.setQueryData(queryKeys.progress(module), { module, completed: reply.completed });
      }
    },
    [queryClient],
  );

  // flushPendingProgress on DOMContentLoaded (app.js:3754) — once per page load.
  const flushed = useRef(false);
  useEffect(() => {
    if (flushed.current) return;
    flushed.current = true;
    void flushPendingProgress().then((landed) => {
      landed.forEach((reply) => {
        if (reply.module) applyProgress(reply.module, reply);
      });
    });
  }, [applyProgress]);

  /** Any completion write — quiz or exercises. Returns how it went. */
  const recordProgress = useCallback(
    async (body: ProgressBody): Promise<{ failed: boolean; marked: boolean }> => {
      const reply = await postProgress(body);
      if (reply === undefined) {
        queuePendingProgress(body);
        return { failed: true, marked: false };
      }
      applyProgress(body.module, reply);
      return { failed: false, marked: Boolean(reply && reply.marked) };
    },
    [applyProgress],
  );

  /** recordQuizResult (app.js:1184) — called ONLY on the genuine finish. */
  const recordQuizResult = useCallback(async () => {
    const run = stateRef.current;
    const blockId = owningBlockId(run);
    const total = tallyTotal(run);   // the CARRIED pair: a retry posts 20/20, never 3/3
    const scored = tallyScore(run);
    setSaveNote({ failed: false, completedBlock: null });
    if (!blockId || total === 0) return;
    const outcome = await recordProgress({
      module: moduleId,
      block: blockId,
      score: scored,
      total,
      source: run.scope === 'ai' ? 'ai' : 'written',
    });
    setSaveNote({ failed: outcome.failed, completedBlock: outcome.marked ? blockId : null });
  }, [moduleId, recordProgress]);

  // ⚑ 25-09-26 (user): an AI-Quiz being written can be CANCELLED. One controller for whichever
  //   generation is in flight (reader block quiz or the picker's fresh quiz); a newer start or a
  //   Cancel aborts it. An aborted request is never reported as an error.
  const aiAbort = useRef<AbortController | null>(null);
  const beginAiRequest = () => {
    aiAbort.current?.abort();
    const controller = new AbortController();
    aiAbort.current = controller;
    return controller;
  };
  const cancelAiQuiz = useCallback(() => {
    aiAbort.current?.abort();
    aiAbort.current = null;
  }, []);
  const isAbort = (error: unknown) => (error as Error)?.name === 'AbortError';

  /** setAiQuiz (app.js:1048). */
  const setAiQuiz = useCallback(
    (questions: QuizQuestion[], blockId: string | null) => {
      dispatch({ type: 'run/reset', questions });
      dispatch({ type: 'generated/set', questions });
      dispatch({ type: 'scope/set', scope: 'ai', label: '', blockId });
    },
    [dispatch],
  );

  /** startBlockAiQuiz (app.js:3386) — the block on screen. */
  const startBlockAiQuiz = useCallback(
    async (at: TheoryCursor = cursor) => {
      if (!aiReady) return;
      const token = await generationToken(provider.tokenRequired);
      if (token === null) return;
      setAiBlockStatus('Generating questions from this block...');
      setAiBusy(true);
      const controller = beginAiRequest();
      try {
        const response = await postJson(
          '/api/quiz',
          { module: activeBookFile, chapter: at.chapterIndex + 1, block: at.blockIndex + 1, count: aiQuestionCount },
          { 'X-Edu-Quiz-Token': token },
          controller.signal,
        );
        const reply = (await response.json()) as { questions?: QuizQuestion[]; error?: string };
        if (!response.ok) throw new Error(reply.error || `Request failed (${response.status}).`);
        // An AI quiz launched from the reader assesses THIS block, so a perfect score
        // completes the block exactly as a written one does.
        setAiQuiz(reply.questions ?? [], theoryBlockId(at.chapterIndex, at.blockIndex));
        generateMemory.current.fromSetup = false;
        setAiBlockStatus('');
        showQuiz('ai');
      } catch (error) {
        setAiBlockStatus(isAbort(error) ? 'AI-Quiz cancelled.' : (error as Error).message);
      } finally {
        if (aiAbort.current === controller) aiAbort.current = null;
        setAiBusy(false);
      }
    },
    [aiReady, provider.tokenRequired, activeBookFile, aiQuestionCount, cursor, setAiQuiz, showQuiz],
  );

  /** The #tutorial-to-quiz-btn listener (app.js:1289) — assess the block being read. */
  const beginBlockAssessment = useCallback(() => {
    const wanted = theoryBlockId(cursor.chapterIndex, cursor.blockIndex);
    const scoped = quizBank.filter((q) => q?.source?.block === wanted);
    if (!scoped.length) {
      if (aiReady) void startBlockAiQuiz();
      else setAiBlockStatus('No written questions for this block, and no model is connected to write any. Connect one in Settings.');
      return;
    }
    const chapter = chapters[cursor.chapterIndex];
    const block = blocksOf(cursor.chapterIndex)[cursor.blockIndex];
    dispatch({ type: 'run/reset', questions: scoped });
    dispatch({
      type: 'scope/set',
      scope: 'block',
      label: `${chapter?.title || `Chapter ${cursor.chapterIndex + 1}`} — ${block?.term || `Block ${cursor.blockIndex + 1}`}`,
      blockId: wanted,
    });
    showQuiz('other');
  }, [cursor, quizBank, aiReady, startBlockAiQuiz, chapters, blocksOf, dispatch, showQuiz]);

  /** generatedCountFor (app.js:3074). */
  const generatedCountFor = useCallback(
    (blockCount: number) => {
      const cap = Math.min(generatedQuizSize, MAX_FRESH_QUIZ_SIZE);
      return blockCount ? Math.max(5, Math.min(cap, blockCount * 5)) : cap;
    },
    [generatedQuizSize],
  );

  /** generateScopeText (app.js:3079). */
  const generateScopeText = useCallback(
    (selection: string[]) => {
      const picked = selection.map(blockFromId).filter((b): b is TheoryCursor => Boolean(b));
      if (!picked.length) return 'AI is reading random book sections · up to a minute';
      if (picked.length > 1) return `AI is reading ${picked.length} blocks · up to a minute`;
      const item = blocksOf(picked[0].chapterIndex)[picked[0].blockIndex];
      return `AI is reading ${(item && item.term) || 'one block'} · under a minute`;
    },
    [blocksOf],
  );

  /** startGeneratedQuiz (app.js:3029). */
  const startGeneratedQuiz = useCallback(
    async (selection: string[] = []) => {
      if (!hasTitle || !aiReady) return;
      const token = await generationToken(provider.tokenRequired);
      if (token === null) return;
      setLoading({ scope: generateScopeText(selection), model: provider.model ? `Model: ${provider.model}` : '' });
      showLoading();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      const picked = selection.map(blockFromId).filter((b): b is TheoryCursor => Boolean(b));
      const oneBlock = picked.length === 1 ? picked[0] : null;
      const request = oneBlock
        ? {
            url: '/api/quiz' as const,
            body: { module: activeBookFile, chapter: oneBlock.chapterIndex + 1, block: oneBlock.blockIndex + 1, count: aiQuestionCount },
          }
        : {
            url: '/api/quiz/fresh' as const,
            body: {
              module: activeBookFile,
              count: generatedCountFor(picked.length),
              ...(picked.length ? { blocks: picked.map((b) => [b.chapterIndex + 1, b.blockIndex + 1]) } : {}),
            },
          };
      const controller = beginAiRequest();
      try {
        const response = await postJson(request.url, request.body, { 'X-Edu-Quiz-Token': token }, controller.signal);
        const reply = (await response.json()) as { questions?: QuizQuestion[]; error?: string };
        if (!response.ok) throw new Error(reply.error || `Request failed (${response.status}).`);
        setAiQuiz(reply.questions ?? [], oneBlock ? theoryBlockId(oneBlock.chapterIndex, oneBlock.blockIndex) : null);
        generateMemory.current = { fromSetup: true, selection };
        showQuiz('ai');
      } catch (error) {
        if (!isAbort(error)) void showNotice({ title: 'Could not generate a quiz', body: (error as Error).message });
        // A cancel started a newer screen already only if another generation replaced this one.
        if (aiAbort.current === null || aiAbort.current === controller) showHome();
      } finally {
        if (aiAbort.current === controller) aiAbort.current = null;
      }
    },
    [hasTitle, aiReady, provider.tokenRequired, provider.model, activeBookFile, aiQuestionCount,
      generatedCountFor, generateScopeText, setAiQuiz, showLoading, showQuiz, showHome],
  );

  /** The #generate-new-btn listener (app.js:1326). */
  const generateAnother = useCallback(() => {
    if (generateMemory.current.fromSetup) {
      void startGeneratedQuiz(generateMemory.current.selection);
      return;
    }
    const origin = blockFromId(stateRef.current.scopeBlockId || '');
    if (origin && stateRef.current.scope === 'ai') {
      // Back to the assessed block first: generation takes 25-35 s with its status line in
      // the reader, so left on the result screen the click would show nothing for half a minute.
      showReaderAt(origin);
      void startBlockAiQuiz(origin);
      return;
    }
    void startGeneratedQuiz();
  }, [startGeneratedQuiz, startBlockAiQuiz, showReaderAt]);

  /**
   * exam-recall-suite P3 (22-10-26): leaving a RUNNING exam from the header asks first, in the app's own
   * dialog (never window.confirm, never a beforeunload prompt — a reload loses nothing, the run is on the
   * server). `onExamScreen` = the exam is what is on screen now; elsewhere nothing is asked.
   */
  const examRunning = state.scope === 'exam' && Boolean(state.exam) && !state.exam?.finished;
  const guardExamLeave = useCallback(
    (onExamScreen: boolean, go: () => void) => {
      if (!onExamScreen || !examRunning) {
        go();
        return;
      }
      void askConfirm({ title: 'Leave exam?', body: 'Timer keeps running. Resume from Practice.', confirmLabel: 'Leave', cancelLabel: 'Stay' }).then((ok) => {
        if (ok) go();
      });
    },
    [examRunning],
  );

  return {
    guardExamLeave,
    aiReady,
    providerReady: provider.ready,
    providerStatusUnknown: provider.statusUnknown,
    providerModel: provider.model,
    aiBlockStatus,
    setAiBlockStatus,
    aiBusy,
    loading,
    saveNote,
    recordQuizResult,
    recordProgress,
    beginBlockAssessment,
    startBlockAiQuiz,
    startGeneratedQuiz,
    cancelAiQuiz,
    generateAnother,
    generatedCountFor,
    aiQuestionCount,
  };
}

export type StudyActions = ReturnType<typeof useStudyActions>;
