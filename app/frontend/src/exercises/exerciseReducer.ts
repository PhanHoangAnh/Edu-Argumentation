// Seam 18 (exercises), part 2 — ⚑⚑ A1b: THE ONE INTENTIONAL BEHAVIOUR DELTA OF THIS SLICE.
//
// ── WHAT CHANGES, STATED UP FRONT ────────────────────────────────────────────────────
// In the legacy app, three exercise controls re-enter the reader by calling
// `renderTheoryBlock()` — which REBUILDS THE ENTIRE THEORY BLOCK:
//
//   as-of-21-09-26 anchor | current line | control      | what it does first
//   ----------------------|--------------|--------------|--------------------------------
//   app.js:2482           | app.js:2538  | mode toggle  | writeExerciseState({mode})
//   app.js:2611           | app.js:2667  | retry-wrong  | clears wrong verdicts+picks,
//                         |              |              | sets retryOnly = true
//   app.js:2626           | app.js:2682  | clear        | wipes answers|picks + verdicts,
//                         |              |              | sets retryOnly = false
//
//   (⚠ the +56 shift is Step C inserting the THEME_TITLE_CLASS lookup — see the phase
//    report, A1a. Locate these by symbol: they are the three `renderTheoryBlock()` calls
//    INSIDE renderExercises.)
//
// In React each becomes a `dispatch` on THIS reducer, whose state persists to
// **localStorage**. The re-render then scopes to <ExercisePanel> instead of rebuilding
// the whole block — every figure, equation, code cell and rich-text-viewer above the
// panel survives untouched.
//
// ⛔ THIS IS A PARITY DELTA, AND IT IS **INTENTIONAL**. It is recorded in the phase
//    report as such, not discovered later. It is an improvement — a KaTeX re-render and
//    a shadow-root rebuild per mode toggle is pure waste — but it is still a difference
//    in observable behaviour: a gate that asserted "the whole block re-renders" would go
//    red, correctly.
//
// ⛔⛔ PERSISTENCE IS **localStorage**, NEVER progress.json, NEVER /api/progress.
//     Client-only state is exactly what keeps Phase 03 READ-ONLY. progress.json must be
//     byte-identical before and after a full browse, and the built bundle must contain
//     ZERO non-GET fetch call sites. Routing exercise answers to the server would fail
//     both gates at once — and drafts are not worth a round trip per keystroke anyway.
//     ⚠ Nineteen typed answers are too much work to lose to a reload; that is the whole
//       reason this state is persisted at all.
//
// ── THE THREE BEHAVIOURS BEING PRESERVED EXACTLY ─────────────────────────────────────
// Each has a user decision behind it; none is incidental.
//   · RETRY-WRONG narrows the panel to what is LEFT. The ones already right DISAPPEAR
//     rather than sit there locked (user, 20-09-26) — twenty exercises re-answered to fix
//     one is busywork. They are NOT forgotten: the hidden tally carries them, so the
//     block still ticks only at 100% of the FULL list.
//     A WRITTEN answer is KEPT so it can be edited rather than retyped — improving a
//     wrong answer IS the exercise. A CHOSEN option must go, or the card stays locked.
//   · CLEAR means the whole list again, hidden ones included: `retryOnly` back to false.
//   · MODE falls back to 'write' when the module has no multiple-choice options.

/** `eduExercises.<moduleId>.<blockId>` — module-scoped, or two books share answers. */
export const EXERCISE_STORE_PREFIX = 'eduExercises';

export function exerciseStoreKey(moduleId: string, blockId: string): string {
  return `${EXERCISE_STORE_PREFIX}.${moduleId || 'module'}.${blockId}`;
}

export type ExerciseMode = 'write' | 'choose';

export interface ExerciseVerdict {
  /** Written answers are marked by the model: `partial` and `unmarked` are real verdicts too. */
  verdict: 'correct' | 'partial' | 'incorrect' | 'unmarked';
  feedback: string;
}

export interface ExerciseState {
  mode: ExerciseMode;
  answers: Record<string, string>;
  picks: Record<string, number>;
  verdicts: Record<string, ExerciseVerdict>;
  /** Narrowed to the exercises still to get right. Stored, so a reload does not
   *  silently put the already-answered ones back on the page. */
  retryOnly: boolean;
}

export const emptyExerciseState: ExerciseState = {
  mode: 'write',
  answers: {},
  picks: {},
  verdicts: {},
  retryOnly: false,
};

export type ExerciseAction =
  /** app.js:2538 (was 2482) — the mode toggle. */
  | { type: 'mode/set'; mode: ExerciseMode }
  /** app.js:2667 (was 2611) — "Retry the wrong ones". */
  | { type: 'retry/wrongOnly' }
  /** app.js:2682 (was 2626) — "Clear" / "Start over". */
  | { type: 'answers/clear' }
  | { type: 'answer/write'; n: number; text: string }
  | { type: 'answer/pick'; n: number; index: number; correct: boolean }
  | { type: 'verdicts/apply'; verdicts: Record<string, ExerciseVerdict> };

export function exerciseReducer(state: ExerciseState, action: ExerciseAction): ExerciseState {
  switch (action.type) {
    case 'mode/set':
      return { ...state, mode: action.mode };

    case 'retry/wrongOnly': {
      const verdicts: Record<string, ExerciseVerdict> = {};
      const picks = { ...state.picks };
      for (const [n, verdict] of Object.entries(state.verdicts)) {
        if (verdict && verdict.verdict === 'correct') verdicts[n] = verdict;
        else delete picks[n];   // a chosen option must go, or the card stays locked
      }
      // ⛔ `answers` is untouched on purpose — see the header.
      return { ...state, verdicts, picks, retryOnly: true };
    }

    case 'answers/clear':
      return {
        ...state,
        answers: state.mode === 'write' ? {} : state.answers,
        picks: state.mode === 'write' ? state.picks : {},
        verdicts: {},
        retryOnly: false,
      };

    case 'answer/write':
      return { ...state, answers: { ...state.answers, [action.n]: action.text } };

    case 'answer/pick':
      // The quiz locks once answered, and so does this.
      if (state.verdicts[action.n]) return state;
      return {
        ...state,
        picks: { ...state.picks, [action.n]: action.index },
        verdicts: {
          ...state.verdicts,
          [action.n]: { verdict: action.correct ? 'correct' : 'incorrect', feedback: '' },
        },
      };

    case 'verdicts/apply':
      return { ...state, verdicts: { ...state.verdicts, ...action.verdicts } };

    default:
      return state;
  }
}

/** readExerciseState — tolerant by design: private mode or a corrupt entry must not
 *  throw away the panel, it must fall back to empty. */
export function readExerciseState(key: string): ExerciseState {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!stored || typeof stored !== 'object') return emptyExerciseState;
    const raw = stored as Partial<ExerciseState>;
    return {
      mode: raw.mode === 'choose' ? 'choose' : 'write',
      answers: raw.answers && typeof raw.answers === 'object' ? raw.answers : {},
      picks: raw.picks && typeof raw.picks === 'object' ? raw.picks : {},
      verdicts: raw.verdicts && typeof raw.verdicts === 'object' ? raw.verdicts : {},
      retryOnly: raw.retryOnly === true,
    };
  } catch {
    return emptyExerciseState;
  }
}

/** writeExerciseState — storage blocked is not an error: the answers still work for
 *  this session. */
export function writeExerciseState(key: string, state: ExerciseState): void {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    /* storage blocked */
  }
}
