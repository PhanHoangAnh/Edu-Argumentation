// Seam 6 (state/QuizProvider), context half — one of the FOUR contexts (A2).
// The 13-field atom and its derived selectors live in ./quizReducer.
import { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import type { ReactNode } from 'react';
import { initialQuizState, quizReducer, tallyScore, tallyTotal } from './quizReducer';
import type { QuizAction, QuizState } from './quizReducer';

interface QuizContextValue {
  state: QuizState;
  dispatch: React.Dispatch<QuizAction>;
  /** Derived during render. Never stored. */
  scored: number;
  /** Derived during render. Never stored. */
  total: number;
}

const QuizContext = createContext<QuizContextValue | null>(null);

// 22-10-26: a run in progress survives a reload. Saved after every change, cleared when the run ends.
// Not saved: an exam (the server holds it) and the AI-quiz bank (`generated`). A question already
// answered is restored as PASSED — its score and miss are in the saved counts, so showing it again
// would let it be scored twice.
const RUN_KEY = 'edu.quizrun.v1';

function loadRun(): QuizState {
  try {
    const raw = localStorage.getItem(RUN_KEY);
    if (!raw) return initialQuizState;
    const saved = JSON.parse(raw) as Partial<QuizState>;
    if (!Array.isArray(saved.active) || !saved.active.length || typeof saved.currentQuestionIndex !== 'number') return initialQuizState;
    if (saved.currentQuestionIndex >= saved.active.length || saved.scope === 'exam') return initialQuizState;
    return {
      ...initialQuizState,
      ...saved,
      exam: null,
      generated: null,
      currentQuestionIndex: saved.currentQuestionIndex + (saved.isAnswered ? 1 : 0),
      isAnswered: false,
      selectedAnswer: null,
    };
  } catch {
    return initialQuizState;
  }
}

export function QuizProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(quizReducer, undefined, loadRun);
  useEffect(() => {
    try {
      const live = state.active.length > 0 && state.currentQuestionIndex < state.active.length && state.scope !== 'exam';
      if (live) localStorage.setItem(RUN_KEY, JSON.stringify({ ...state, exam: null, generated: null }));
      else localStorage.removeItem(RUN_KEY);
    } catch {
      /* storage blocked: the run just is not remembered */
    }
  }, [state]);
  const value = useMemo<QuizContextValue>(
    () => ({ state, dispatch, scored: tallyScore(state), total: tallyTotal(state) }),
    [state],
  );
  return <QuizContext.Provider value={value}>{children}</QuizContext.Provider>;
}

export function useQuiz(): QuizContextValue {
  const value = useContext(QuizContext);
  if (!value) throw new Error('useQuiz must be used inside <QuizProvider>');
  return value;
}
