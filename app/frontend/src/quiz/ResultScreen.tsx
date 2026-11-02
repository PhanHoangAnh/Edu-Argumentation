// Seam 22 (quiz/ResultScreen) — THE SCORE, THE MESSAGE AND THE WAY BACK.
//
// Split out of showResults (93 lines — one of the six spanning functions). showResults
// was doing FOUR unrelated jobs; only the last two are this component:
//   1. SCREEN SWITCHING (hide landing/tutorial/settings/quiz, show result, close setup)
//      -> shell/AppShell. A screen does not hide its siblings.
//   2. THE TALLY (tallyScore/tallyTotal) -> state/quizReducer, as DERIVED SELECTORS.
//   3. THE MESSAGE + the two conditional notes -> here.
//   4. THE NAV (renderResultNav / returnToReader) -> here, as props.
//
// ⚑ 22-09-26 (EVL fix 004, D-10): jobs 3 and 4 ARRIVED. Until this slice the screen
//   switch did not exist at all, so this component's content rendered into a permanently
//   `display:none` section — the whole of D-10. The switch is now in AppShell (via
//   QuizScreen's finish effect); the two conditional notes and renderResultNav are below.
//
// ⛔ THE CARRIED TALLY, NOT THIS RUN'S RAW COUNT. A retry that fixes the last 3 of 20
//    must read 20/20, or the reader is told they failed an assessment they passed.
//
// ⚠ renderResultNav() is called BEFORE the 0% early return in the legacy code, and the
//   comment says why: "a zero score is exactly when the reader most needs a way back to
//   the block". In React the nav simply always renders — the hazard is only reintroduced
//   if someone early-returns a different tree at 0%.
//
// Contract DOM this seam owns: #restart-btn · #result-retry-wrong-btn
import { useQuiz } from '../state/QuizProvider';
import { owningBlockId } from '../state/quizReducer';
import { useBookContext } from '../state/BookProvider';
import { useProgressContext } from '../state/ProgressProvider';
import { nextTheory } from '../state/theoryNav';
import type { TheoryCursor } from '../data/types';
import type { SaveNote } from '../shell/useStudyActions';

export interface ResultScreenProps {
  /**
   * returnToReader(selection) — app.js:856. `null` means "just go back to the reader,
   * wherever the cursor already is"; a cursor means select that block FIRST, then show.
   */
  onBackToReader: (selection: TheoryCursor | null) => void;
  /** `#result-new-btn` — openQuizSetup(sessionKey()) (app.js:1322), same call as `#quiz-new-btn`. */
  onNewQuiz: () => void;
  /**
   * ⛔⛔ THE SECOND HALF OF D-10, AND IT WAS MISSED UNTIL A BROWSER RAN THE JOURNEY.
   *     Both `restartQuiz` (app.js:886-890) and `retryWrongOnly` (app.js:895-911) END IN
   *     `startQuiz()`, which calls `showQuizScreen()` — i.e. they do not merely reset the
   *     atom, they PUT THE LEARNER BACK ON THE QUIZ. This port dispatched the reducer action
   *     and nothing else, so MEASURED on the local preview before this fix: clicking
   *     "Retry the 4 you missed" left `visibleScreens = ["welcome-screen","result-screen"]`
   *     with a freshly narrowed run sitting behind an unchanged result page.
   *     Exactly the same class of defect as the finish itself: the state moved, the screen
   *     did not. A screen does not show its siblings — so the switch is a prop.
   */
  onResumeQuiz: () => void;
  /** #generate-new-btn — the listener at app.js:1326 (same pick / same block / fresh). */
  onGenerateAnother: () => void;
  /** What the completion write reported (shell/useStudyActions). */
  saveNote: SaveNote;
}

/*
  ⛔ THE THREE BUTTON CLASS STRINGS ARE app.js:RESULT_BTN_BASE / _PRIMARY / _SECONDARY,
     COPIED CONSTANT FOR CONSTANT (app.js:811-813). They are module-level for the same
     reason OptionCard's four strings are: six call sites, one string each, so "primary"
     cannot drift into two slightly different primaries.
  ⛔ `min-h-[44px]` IS AN ACCESSIBILITY FLOOR (WCAG 2.5.8 target size), not padding. Every
     legacy result button carries it. Do not drop it when tidying.
*/
const RESULT_BTN_BASE =
  'min-h-[44px] max-w-full font-bold uppercase tracking-wider py-4 px-8 transition-colors rounded-lg border-2';
const RESULT_BTN_PRIMARY = 'bg-brand-600 hover:bg-brand-900 border-brand-600 text-white';
const RESULT_BTN_SECONDARY =
  'bg-transparent border-gray-500 text-gray-300 hover:bg-gray-700 hover:text-white hover:border-gray-400';

/** styleResultButton (app.js:818-825), as a pure class+style builder. */
function resultBtn(primary: boolean, order: number, hidden: boolean) {
  return {
    className: `${RESULT_BTN_BASE} ${primary ? RESULT_BTN_PRIMARY : RESULT_BTN_SECONDARY}${hidden ? ' hidden-view' : ''}`,
    // Visual order only; on a phone the column stacks, so the lead action is on top.
    style: { order: String(order) } as const,
  };
}

/**
 * blockFromId (app.js:814-818). ⛔ POSITIONAL AND 1-BASED on the wire, 0-based in state —
 * `ch01-b03` is chapterIndex 0, blockIndex 2. Getting that off by one silently sends
 * "Next block" to the wrong place, which looks like working navigation.
 * ⚠ The legacy runs the result through clampTheory(); here the bounds check IS the clamp —
 *   an id naming a block the open book does not have resolves to null rather than to a
 *   cursor the reader cannot display.
 */
function blockFromId(
  blockId: string | null,
  chapterCount: number,
  blockCountOf: (chapterIndex: number) => number,
): TheoryCursor | null {
  const match = /^ch(\d{2})-b(\d{2})$/.exec(blockId || '');
  if (!match) return null;
  const chapterIndex = Number(match[1]) - 1;
  const blockIndex = Number(match[2]) - 1;
  if (chapterIndex < 0 || chapterIndex >= chapterCount) return null;
  if (blockIndex < 0 || blockIndex >= blockCountOf(chapterIndex)) return null;
  return { chapterIndex, blockIndex };
}

export function ResultScreen({ onBackToReader, onNewQuiz, onResumeQuiz, onGenerateAnother, saveNote }: ResultScreenProps) {
  const { state, dispatch, scored, total } = useQuiz();
  const { chapters, blocksOf } = useBookContext();
  const { completed, chapterProgress } = useProgressContext();
  const percent = total === 0 ? 0 : Math.round((scored / total) * 100);

  const blockCountOf = (index: number) => blocksOf(index).length;

  /*
    ⛔⛔ owningBlockId() ASKS `full`, NOT `active`. See state/quizReducer.ts for the full
        reasoning; the short version is that after a retry-wrong `active` is the narrowed
        miss set, so asking it would let a MODULE-WIDE quiz narrowed to one block's misses
        resolve to that block and claim it off a whole-book tally.
  */
  const blockId = owningBlockId(state);
  const origin = blockFromId(blockId, chapters.length, blockCountOf);
  const next = origin ? nextTheory(origin, chapters.length, blockCountOf) : null;

  // renderResultNav (app.js:810-854), decision for decision.
  const passed = total > 0 && scored === total;
  const missed = state.wrongIndices.length;
  const forward = Boolean(origin && passed && next);

  let nextLabel = 'Next block';
  if (next && origin) {
    const block = blocksOf(next.chapterIndex)[next.blockIndex];
    const name = block?.term || `Block ${next.blockIndex + 1}`;
    nextLabel =
      next.chapterIndex === origin.chapterIndex ? `Next: ${name} →` : `Next chapter: ${name} →`;
  }

  return (
    <>
      {/*
        ⛔ THE HEADINGS ARE PART OF THE SCREEN, ported from index.html:491-492. Without them
           the result page opens on a bare percentage with no statement of what finished.
      */}
      <h2 className="text-4xl font-light text-white mb-2">
        Assessment <span className="font-bold text-brand-600">Complete</span>
      </h2>
      <p className="text-gray-500 uppercase tracking-widest text-sm font-semibold mb-12">Final Results</p>

      {/*
        A4 OWNS the count-up animation (setInterval over `animationDuration/percent`).
        It is presentation only; #final-score must read the final percent regardless.
      */}
      <div id="final-score" className="text-7xl font-bold text-white mb-4">{`${percent}%`}</div>
      {/*
        ⛔⛔ #final-fraction IS WHERE THE CARRY INVARIANT BECOMES VISIBLE, and it is the
            element the journey gate reads. `total` is tallyTotal() = `carriedTotal ||
            active.length`, so a run narrowed to 3 misses out of 20 posts **20**, never 3.
            Wiring this to `state.active.length` would silently turn a 20-question
            assessment into a 3-question one and tell a reader who passed that they failed.
      */}
      <div id="final-fraction" className="text-gray-500 font-semibold uppercase tracking-wider mb-12">
        {`${scored} / ${total}`}
      </div>

      <div id="result-message" className="text-lg text-gray-300 mb-12 leading-relaxed">
        {/* ⚑ Phase 04 parity (gate R-PAR-RESULT): the legacy's span is `... text-3xl text-white` and
            showResults() ADDS the colour class on top (app.js:721-741), so BOTH classes are on the
            element and the stylesheet's order decides — measured: the heading renders WHITE on
            :8767. The port had dropped text-white and rendered it in colour. Both classes kept. */}
        {total === 0 ? (
          <span className="font-light block mb-4 text-3xl text-white text-gray-400">No Assessment Available.</span>
        ) : percent >= 80 ? (
          <>
            <span className="font-light block mb-4 text-3xl text-white text-emerald-400">Outstanding Performance!</span>
            {' You have demonstrated expert-level mastery of the material.'}
          </>
        ) : percent >= 60 ? (
          <>
            <span className="font-light block mb-4 text-3xl text-white text-brand-400">Solid Effort.</span>
            {' You understand the fundamentals well, but reviewing key concepts will push you further.'}
          </>
        ) : (
          <>
            <span className="font-light block mb-4 text-3xl text-white text-brand-500">Keep Reviewing.</span>
            {' Review the tutorial material deeply before retaking the assessment.'}
          </>
        )}
        {/*
          ⛔ THE "A BLOCK NEEDS 100%" RULE (app.js:752-759). It is the only thing that tells a
             reader WHY a block they just scored 4/5 on is still unticked — without it the
             completion model is invisible and reads as a bug.
          ⛔ IT IS GATED ON `!completed[blockId]`: once the block is done, repeating the quiz
             must not nag. `completed` is an OBJECT keyed by block id (store.py:93), tested
             with Boolean() — never `=== true`.
          ⚑ PHASE 04: the queued-save warning (app.js:745) and announceCompletion (app.js:1097)
            are both driven by the completion write's outcome (SaveNote).
          ⚠ ONE DELIBERATE DIFFERENCE: the legacy sets `progressSaveFailed` after an ASYNC POST
            that showResults() does not wait for, so its warning surfaced on the NEXT result
            screen, about the wrong quiz. Here it shows on the result it belongs to.
        */}
        {saveNote.failed ? (
          <span className="block mt-6 text-sm text-amber-300">
            Your score could not be saved — the connection dropped. It is queued and will be saved next time this page loads.
          </span>
        ) : null}
        {blockId && total > 0 && scored < total && !completed[blockId] ? (
          <span className="block mt-6 text-sm text-gray-400">
            {missed
              ? `Not complete yet — a block needs 100% (you got ${scored}/${total}). Retry just the ${missed} you missed to finish it.`
              : `Not complete yet — a block needs 100% (you got ${scored}/${total}). Retake to finish it.`}
          </span>
        ) : null}
        {saveNote.completedBlock ? <CompletionNote blockId={saveNote.completedBlock} chapterTitles={chapters.map((c) => c.title)} chapterProgress={chapterProgress} /> : null}
      </div>

      {/*
        ⛔ ORDER AND EMPHASIS ARE PER RESULT, not fixed (renderResultNav). Pass a block and
           the way FORWARD leads; miss some and redoing only those leads — but Next stays
           available, because moving on is the reader's call, not ours.
      */}
      <div id="result-actions" className="flex flex-col sm:flex-row sm:flex-wrap gap-4 justify-center">
        <button
          id="result-back-btn"
          type="button"
          {...resultBtn(!forward && !missed && Boolean(origin), forward ? 1 : 1, false)}
          onClick={() => onBackToReader(origin)}
        >
          {/* "Back to block" only when we know WHICH block; otherwise the honest label. */}
          <span id="result-back-label">{origin ? 'Back to block' : 'Back to reading'}</span>
        </button>

        {/*
          ⛔ REDO-THE-MISSES IS A USER RULING (20-09-26) AND MUST SURVIVE: "A 20-question
             assessment failed on one question should not cost 20 answers again." The
             questions already answered correctly DISAPPEAR from the narrowed run — that is
             `run/retryWrong` rebuilding `active` from `wrongIndices` — and `Retry Quiz`
             (#restart-btn, below) still redoes EVERYTHING because it replays `full`.
          ⛔ Hidden when nothing was missed, and it takes the PRIMARY slot off "Back to
             block" when something was, because it is the action worth leading with.
        */}
        <button
          id="result-retry-wrong-btn"
          type="button"
          {...resultBtn(missed > 0, forward ? 2 : 0, missed === 0)}
          onClick={() => {
            dispatch({ type: 'run/retryWrong' });
            onResumeQuiz();
          }}
        >
          <span id="result-retry-wrong-label">
            {missed === 1 ? 'Retry the 1 you missed' : `Retry the ${missed} you missed`}
          </span>
        </button>

        {/*
          ⛔ `run/restart` REPLAYS `full`, NOT `active`. After a retry-wrong run, `active` is
             the narrowed set — restarting from it would turn the assessment into a
             3-question one. The reducer already guarantees this; the note is here because
             this is the button that would expose it.
        */}
        <button
          id="restart-btn"
          type="button"
          {...resultBtn(false, 3, false)}
          onClick={() => {
            dispatch({ type: 'run/restart' });
            onResumeQuiz();
          }}
        >
          Retry Quiz
        </button>

        <button id="result-new-btn" type="button" {...resultBtn(false, 5, false)} onClick={onNewQuiz}>
          New Quiz
        </button>

        {/*
          An AI quiz launched from a block regenerates for THAT block, not the book
          (app.js:838-840). Generation itself is a POST and therefore Phase 04 — the button
          is rendered and labelled, not wired.
        */}
        <button
          id="generate-new-btn"
          type="button"
          {...resultBtn(!origin && state.scope === 'ai' && !missed, 3, state.scope !== 'ai')}
          onClick={onGenerateAnother}
        >
          {origin ? 'Another AI-Quiz on this block' : 'Another AI-Quiz'}
        </button>

        <button
          id="result-next-btn"
          type="button"
          {...resultBtn(forward, forward ? 0 : 4, !next)}
          title={next && origin ? nextLabel : undefined}
          onClick={() => onBackToReader(next)}
        >
          <span id="result-next-label" className="block truncate">
            {nextLabel}
          </span>
        </button>
      </div>
    </>
  );
}

/** announceCompletion (app.js:1097) — "✓ Block complete — <chapter> is now N% (d of t)." */
function CompletionNote({
  blockId,
  chapterTitles,
  chapterProgress,
}: {
  blockId: string;
  chapterTitles: string[];
  chapterProgress: (chapterIndex: number) => { done: number; total: number; percent: number };
}) {
  const match = /^ch(\d{2})-b(\d{2})$/.exec(blockId);
  if (!match) return null;
  const chapterIndex = Number(match[1]) - 1;
  const p = chapterProgress(chapterIndex);
  const name = chapterTitles[chapterIndex] || `Chapter ${chapterIndex + 1}`;
  return (
    <span className="block mt-6 text-base font-semibold text-green-400">
      {`✓ Block complete — ${name} is now ${p.percent}% (${p.done} of ${p.total}).`}
    </span>
  );
}
