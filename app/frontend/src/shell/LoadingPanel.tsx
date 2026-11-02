// THE LOADING PANEL — the AI-Quiz's "Writing a fresh quiz" state, shared (30-09-26).
//
// ⚑ User (30-09-26): "The Q&A loading screen is not the same as the AI-Quiz". Reuse-first rule:
//   this is the AI-Quiz's own markup, MOVED here VERBATIM from shell/AppShell.tsx's #loading-screen
//   (index.html:220-228 class strings), so the AI-Quiz and every add-on that waits on the model
//   draw the SAME panel. gates/gate-r-qna.mjs QNA-UI-LOADING compares the two, class for class.
//
// ⛔ The children are a FRAGMENT: the caller owns the wrapper (the AI-Quiz's <Screen id=
//    "loading-screen"> with its `flex flex-col items-center justify-center text-center py-24
//    animate-fade-in` classes). Adding a wrapper here would change #loading-screen's DOM.
// ⛔ Ids come from `idBase`: 'loading' reproduces #loading-scope / #loading-model /
//    #loading-cancel-btn exactly (pinned). Another screen MUST pass its own base — every screen
//    stays mounted, so two panels with one base would duplicate ids.
// ⛔ Class strings are complete literals (Tailwind purge). Do not edit one without the other caller.
import type { ReactNode } from 'react';

/** The wrapper classes of the AI-Quiz's #loading-screen, for a caller that is not a <Screen>. */
export const LOADING_PANEL_CLASS = 'flex flex-col items-center justify-center text-center py-24 animate-fade-in';

export interface LoadingPanelProps {
  idBase: string;
  /** The headline, e.g. <>Writing a <span className="font-bold">fresh quiz</span></>. */
  title: ReactNode;
  scope: string;
  model: string;
  onCancel: () => void;
}

export function LoadingPanel({ idBase, title, scope, model, onCancel }: LoadingPanelProps) {
  return (
    <>
      <div className="relative w-16 h-16 mb-6 mx-auto">
        <div className="absolute inset-0 border-4 border-gray-700 rounded-full" />
        <div className="absolute inset-0 border-4 border-brand-600 rounded-full border-t-transparent animate-spin" />
      </div>
      <h2 className="text-3xl text-white font-light mb-2">{title}</h2>
      <p id={`${idBase}-scope`} className="text-brand-600 uppercase tracking-widest text-sm font-semibold">
        {scope}
      </p>
      <p id={`${idBase}-model`} className="mt-2 text-gray-500 text-xs">{model}</p>
      {/* ⚑ 25-09-26 (user): stop writing this quiz and go back. */}
      <button
        id={`${idBase}-cancel-btn`}
        type="button"
        onClick={onCancel}
        className="mt-8 inline-flex items-center justify-center min-h-[44px] px-5 rounded-lg border border-gray-600 text-gray-200 hover:border-brand-600 hover:text-white font-semibold uppercase tracking-wider text-sm transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
      >
        Cancel
      </button>
    </>
  );
}
