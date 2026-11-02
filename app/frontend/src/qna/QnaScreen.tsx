// Q&A examiner screen — the first add-on screen (study-rooms-qna P2, 29-09-26).
//
// Rendered by the add-on registry inside <Screen id="qna-screen"> (shell/screens.tsx). Stays
// mounted like every screen; `open` is true while it is the visible one.
//
// Flow: setup (book + chapters/blocks) -> question -> grading -> result (pass: Proceed / Ask;
// fail: Try again) -> ask-back -> ... -> done. "New" is always visible in a session, confirms,
// and clears it. The session survives a reload until New (useQnaSession).
//
// ⚑ ONE live region: #qna-status (role=status, atomic). Grade card takes focus when it arrives.
// ⚑ Reduced motion: the root turns off transitions/transforms for everything inside it.
// ⛔ Class strings are complete literals from shell/ui.ts (Tailwind purge). Copy stays terse.
// ⚑ 30-09-26 (user: "not the same as the AI-Quiz"): while a model call runs, the card shows the
//   AI-Quiz's OWN loading panel (shell/LoadingPanel.tsx, reused — not redrawn) inside #qna-loading.
import { useEffect, useRef, useState } from 'react';
import { useAccount } from '../account/AccountContext';
import { useLibrary } from '../state/LibraryProvider';
import { useBookContext } from '../state/BookProvider';
import { ScopePicker } from '../scope/ScopePicker';
import type { ScopeValue } from '../scope/ScopePicker';
import { BODY_MUTED, CAPTION, CARD, EYEBROW, FIELD, FIELD_INVALID, LABEL, OUTLINE_BTN, PAGE_TITLE, PRIMARY_BTN } from '../shell/ui';
import { LOADING_PANEL_CLASS, LoadingPanel } from '../shell/LoadingPanel';
import { askConfirm } from '../shell/dialog';
import { GradeCard } from './GradeCard';
import { DEFAULT_OPTIONS, useQnaSession, weakSlots } from './useQnaSession';
import type { QnaDifficulty, QnaOptions, QnaStyle } from './useQnaSession';

// P2b (30-09-26): the setup options. Labels are terse (memory ui-copy-terse-not-prose).
const STYLE_CHOICES: ReadonlyArray<{ id: QnaStyle; label: string }> = [
  { id: 'own', label: 'Own words' },
  { id: 'whyhow', label: 'Why / how' },
  { id: 'compare', label: 'Compare' },
  { id: 'apply', label: 'Apply' },
  { id: 'mistake', label: 'Spot the mistake' },
];
const MAX_COUNT = 200;
const PASS_MIN = 1;
const PASS_MAX = 9.5;
const CHECKBOX = 'h-5 w-5 shrink-0 cursor-pointer rounded accent-brand-600';

const ROOT = 'space-y-6 motion-reduce:[&_*]:transition-none motion-reduce:[&_*]:transform-none';
const TEXTAREA = 'w-full min-h-[44px] rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white placeholder-gray-500 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600 transition-colors min-h-[10rem] resize-y';

export function QnaScreen({ open }: { open: boolean }) {
  const account = useAccount();
  const { ordered } = useLibrary();
  const { activeBookFile } = useBookContext();
  const qna = useQnaSession(account.id);
  const { session, busy, error } = qna;
  const [scope, setScope] = useState<ScopeValue>({ bookId: '', blocks: [] });
  const gradeRef = useRef<HTMLElement | null>(null);
  const [opts, setOpts] = useState<QnaOptions>(DEFAULT_OPTIONS);
  // The total follows lessons x per-lesson until the user types their own number.
  const [countText, setCountText] = useState('');
  const [passText, setPassText] = useState(String(DEFAULT_OPTIONS.passMark));
  const available = Math.min(MAX_COUNT, scope.blocks.length * opts.perLesson);
  const count = countText === '' ? available : Number(countText);
  const countOk = Number.isInteger(count) && count >= 1 && count <= Math.max(1, available);
  const passMark = Number(passText);
  const passOk = passText.trim() !== '' && Number.isFinite(passMark) && passMark >= PASS_MIN && passMark <= PASS_MAX;
  const toggleStyle = (id: QnaStyle, on: boolean) =>
    setOpts((o) => ({ ...o, styles: on ? STYLE_CHOICES.map((c) => c.id).filter((x) => x === id || o.styles.includes(x)) : o.styles.filter((x) => x !== id) }));

  // Default the setup's book to the one being read, once the library is known.
  useEffect(() => {
    if (!scope.bookId && activeBookFile && ordered.some((b) => b.file === activeBookFile)) setScope({ bookId: activeBookFile, blocks: [] });
  }, [activeBookFile, ordered, scope.bookId]);

  const grade = session?.grade ?? null;
  useEffect(() => {
    if (grade && open) gradeRef.current?.focus();
  }, [grade, open]);

  const question = session ? session.questions[String(session.index)] : undefined;
  const total = session?.total ?? question?.total ?? null;

  let status = '';
  if (busy === 'question') status = 'Loading question…';
  else if (busy === 'grade') status = 'Grading…';
  else if (busy === 'ask') status = 'Asking…';
  else if (busy === 'hint') status = 'Getting a hint…';
  else if (error) status = error;
  else if (session?.done) status = resultText(session);
  // The latest event wins: an ask-back answer comes after the grade it follows.
  else if (session?.ask) status = session.ask.refused ? 'Not in this theory.' : 'Answer ready.';
  else if (grade) status = `Score ${String(grade.score)} of 10 — ${grade.pass ? 'passed' : 'not passed'}`;
  else if (question && total) status = `Question ${question.index + 1} of ${total}`;
  else if (!session) status = scope.blocks.length ? `${scope.blocks.length} lesson${scope.blocks.length === 1 ? '' : 's'} selected` : '';

  const weak = session ? weakSlots(session) : [];
  const hintText = session ? session.hints[String(session.index)] : undefined;

  // 30-09-26 (defect D): the in-app dialog, never the browser's.
  const confirmNew = async () => {
    if (await askConfirm({ title: 'Start a new Q&A?', body: 'This clears the current one.', confirmLabel: 'New' })) qna.reset();
  };

  return (
    <div className={ROOT}>
      <div className={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={EYEBROW}>{question ? question.lessonTitle : 'Examiner'}</p>
            <h1 className={PAGE_TITLE}>Q&amp;A</h1>
          </div>
          {session ? (
            <button id="qna-new-btn" type="button" className={OUTLINE_BTN} onClick={() => void confirmNew()}>
              New
            </button>
          ) : null}
        </div>
        <p id="qna-status" role="status" aria-live="polite" aria-atomic="true" className={BODY_MUTED}>
          {status}
        </p>
      </div>

      {!session ? (
        <div className={CARD}>
          <ScopePicker books={ordered} value={scope} onChange={setScope} allowBookPick idBase="qna" />
          <div id="qna-setup" className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label htmlFor="qna-per-lesson" className={LABEL}>Per lesson</label>
              <select id="qna-per-lesson" className={FIELD} value={opts.perLesson}
                onChange={(e) => setOpts((o) => ({ ...o, perLesson: Number(e.target.value) }))}>
                {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="qna-count" className={LABEL}>Questions</label>
              <input id="qna-count" type="number" inputMode="numeric" min={1} max={Math.max(1, available)} step={1}
                className={countOk || !scope.blocks.length ? FIELD : FIELD_INVALID}
                value={countText === '' ? (available || '') : countText}
                onChange={(e) => setCountText(e.target.value)} />
            </div>
            <div>
              <label htmlFor="qna-pass-mark" className={LABEL}>Pass above</label>
              <input id="qna-pass-mark" type="number" inputMode="decimal" min={PASS_MIN} max={PASS_MAX} step={0.5}
                className={passOk ? FIELD : FIELD_INVALID} value={passText} onChange={(e) => setPassText(e.target.value)} />
            </div>
            <div>
              <label htmlFor="qna-order" className={LABEL}>Order</label>
              <select id="qna-order" className={FIELD} value={opts.order}
                onChange={(e) => setOpts((o) => ({ ...o, order: e.target.value as QnaOptions['order'] }))}>
                <option value="book">Book</option>
                <option value="shuffle">Shuffled</option>
              </select>
            </div>
            <div>
              <label htmlFor="qna-difficulty" className={LABEL}>Difficulty</label>
              <select id="qna-difficulty" className={FIELD} value={opts.difficulty}
                onChange={(e) => setOpts((o) => ({ ...o, difficulty: e.target.value as QnaDifficulty }))}>
                <option value="easy">Easy</option>
                <option value="normal">Normal</option>
                <option value="hard">Hard</option>
              </select>
            </div>
            <div className="flex items-end">
              <label htmlFor="qna-hints" className="flex min-h-[44px] items-center gap-3 text-sm font-semibold text-gray-200">
                <input id="qna-hints" type="checkbox" className={CHECKBOX} checked={opts.hints}
                  onChange={(e) => setOpts((o) => ({ ...o, hints: e.target.checked }))} />
                Hints
              </label>
            </div>
          </div>
          <fieldset id="qna-styles" className="mt-6">
            <legend className={LABEL}>Style</legend>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {STYLE_CHOICES.map((c) => (
                <label key={c.id} className="flex min-h-[44px] items-center gap-3 text-sm text-gray-200">
                  <input type="checkbox" data-style={c.id} className={CHECKBOX} checked={opts.styles.includes(c.id)}
                    onChange={(e) => toggleStyle(c.id, e.target.checked)} />
                  {c.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-6">
            <button
              id="qna-start-btn"
              type="button"
              className={PRIMARY_BTN}
              disabled={!scope.bookId || scope.blocks.length === 0 || !countOk || !passOk || opts.styles.length === 0}
              onClick={() => qna.start(scope.bookId, scope.blocks, { ...opts, count, passMark })}
            >
              Start
            </button>
          </div>
        </div>
      ) : busy && busy !== 'hint' ? (
        <div id="qna-loading" className={LOADING_PANEL_CLASS}>
          <LoadingPanel
            idBase="qna-loading"
            title={busy === 'question' ? <>Writing a <span className="font-bold">question</span></>
              : busy === 'grade' ? <>Grading <span className="font-bold">your answer</span></>
                : <>Answering <span className="font-bold">your question</span></>}
            scope={question?.lessonTitle || 'AI is reading the lessons you picked · up to a minute'}
            model=""
            onCancel={qna.cancel}
          />
        </div>
      ) : session.done ? (
        <div className={CARD}>
          <p id="qna-result" className="text-lg text-white">{resultText(session)}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            {weak.length ? (
              <button id="qna-redo-btn" type="button" className={PRIMARY_BTN} onClick={qna.redoWeak}>
                {`Redo weak (${weak.length})`}
              </button>
            ) : null}
            <button id="qna-restart-btn" type="button" className={OUTLINE_BTN} onClick={qna.restart}>
              Restart
            </button>
            <button id="qna-done-new-btn" type="button" className={OUTLINE_BTN} onClick={() => void confirmNew()}>
              New
            </button>
          </div>
        </div>
      ) : (
        <div className={`${CARD} space-y-5`}>
          {total ? <p className={CAPTION}>{`Question ${(question?.index ?? session.index) + 1} of ${total}`}</p> : null}
          {question ? (
            <p id="qna-question" className="text-lg text-white">
              {question.question}
            </p>
          ) : error ? (
            <button id="qna-question-retry-btn" type="button" className={OUTLINE_BTN} onClick={qna.retryQuestion}>
              Try again
            </button>
          ) : null}

          {question && session.options.hints && !grade ? (
            hintText ? (
              <p id="qna-hint" className="rounded-xl border border-gray-700 bg-gray-900/60 p-4 text-sm text-gray-300">{hintText}</p>
            ) : (
              <button id="qna-hint-btn" type="button" className={OUTLINE_BTN} disabled={busy !== null} onClick={() => void qna.hint()}>
                Hint
              </button>
            )
          ) : null}

          {question ? (
            <div>
              <label htmlFor="qna-answer" className={LABEL}>
                Your explanation
              </label>
              <textarea
                id="qna-answer"
                className={TEXTAREA}
                value={session.draft}
                readOnly={Boolean(grade)}
                onChange={(event) => qna.setDraft(event.target.value)}
              />
              {!grade ? (
                <div className="mt-4">
                  <button
                    id="qna-submit-btn"
                    type="button"
                    className={PRIMARY_BTN}
                    disabled={!session.draft.trim() || busy !== null}
                    onClick={() => void qna.submit()}
                  >
                    Submit
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {grade ? <GradeCard ref={gradeRef} grade={grade} /> : null}

          {grade && !grade.pass ? (
            <div className="flex flex-wrap gap-3">
              <button id="qna-retry-btn" type="button" className={PRIMARY_BTN} onClick={qna.tryAgain}>
                Try again
              </button>
              <button id="qna-next-btn" type="button" className={OUTLINE_BTN} onClick={qna.proceed}>
                Next
              </button>
            </div>
          ) : null}

          {grade && grade.pass ? (
            <div className="flex flex-wrap gap-3">
              <button id="qna-proceed-btn" type="button" className={PRIMARY_BTN} onClick={qna.proceed}>
                Proceed
              </button>
              {!session.askOpen ? (
                <button id="qna-ask-btn" type="button" className={OUTLINE_BTN} onClick={qna.openAsk}>
                  Ask
                </button>
              ) : null}
            </div>
          ) : null}

          {grade && grade.pass && session.askOpen ? (
            <div className="space-y-3">
              <label htmlFor="qna-ask-input" className={LABEL}>
                Your question
              </label>
              <input
                id="qna-ask-input"
                type="text"
                className={FIELD}
                value={session.askDraft}
                onChange={(event) => qna.setAskDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void qna.ask();
                }}
              />
              <button
                id="qna-ask-send-btn"
                type="button"
                className={OUTLINE_BTN}
                disabled={!session.askDraft.trim() || busy !== null}
                onClick={() => void qna.ask()}
              >
                Ask
              </button>
              {session.ask ? (
                <div id="qna-ask-answer" className="rounded-xl border border-gray-700 bg-gray-900/60 p-4">
                  <p className={CAPTION}>{session.ask.question}</p>
                  <p className={session.ask.refused ? 'mt-2 text-gray-400' : 'mt-2 text-gray-200 whitespace-pre-wrap'}>{session.ask.answer}</p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** "Passed 2 of 3 · 1 weak" — always over the ORIGINAL total (memory redo-only-what-was-missed). */
function resultText(session: { total: number | null; results: Record<string, { score: number; pass: boolean }> } & Parameters<typeof weakSlots>[0]): string {
  const passed = Object.values(session.results).filter((r) => r.pass).length;
  return `Passed ${passed} of ${session.total ?? 0} · ${weakSlots(session).length} weak`;
}
