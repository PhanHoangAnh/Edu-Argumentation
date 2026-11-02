// The study app's top bar look (app/frontend/src/shell/Header.tsx): same logo mark, same
// type, same brand red — with "Lab" after the name and a way back to the study app.
// On the VPN door (http://<host>:8798) the study app is on its own port; through the public
// nginx it is this origin's root.
const STUDY_HOME = window.location.port === '8798' ? `${window.location.protocol}//${window.location.hostname}:8767/` : '/';

// ⚑ 25-09-26 (user): Lab can live INSIDE the study app's Learn window (a panel, see
//   app/frontend/src/reader/LabDock.tsx) or in its own browser tab. Two glyph buttons, by place:
//     in the Learn window : Close (the panel) · Open in a new tab
//     in its own tab      : Back to Learn (re-dock beside the lesson, close this tab) · Close
//   Lab never touches the study window directly: it posts a message to it (the study app
//   believes only Lab origins, and re-validates the href).
const STUDY_ORIGIN = window.location.port === '8798' ? `${window.location.protocol}//${window.location.hostname}:8767` : window.location.origin;
export const EMBEDDED = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();
const GLYPH_BTN =
  'min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-gray-600 text-gray-300 hover:text-white hover:border-brand-600 transition-colors';

function post(target: Window | null, type: string): boolean {
  if (!target) return false;
  try {
    target.postMessage({ type, href: window.location.href }, STUDY_ORIGIN);
    return true;
  } catch {
    return false;
  }
}

// ⚑ 25-09-26 (user): `]` toggles the Lab panel in the reader; inside the panel the key lands HERE
//   (the iframe has focus), so it closes the panel the same way. Never while typing — `]` is code.
if (EMBEDDED) {
  document.addEventListener('keydown', (event) => {
    if (event.key !== ']' || event.repeat || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
    const node = event.target as HTMLElement | null;
    if (node && (['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName) || node.isContentEditable)) return;
    event.preventDefault();
    post(window.parent, 'lab:close');
  });
}

const CloseGlyph = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export function WindowControls() {
  if (EMBEDDED) {
    return (
      <div className="flex items-center gap-2">
        <button id="lab-popout" type="button" title="Open in a new tab" aria-label="Open in a new tab" className={GLYPH_BTN} onClick={() => post(window.parent, 'lab:popout')}>
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 4h6v6" />
            <path d="M20 4l-9 9" />
            <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
          </svg>
        </button>
        <button id="lab-close" type="button" title="Close Lab" aria-label="Close Lab" className={GLYPH_BTN} onClick={() => post(window.parent, 'lab:close')}>
          <CloseGlyph />
        </button>
      </div>
    );
  }
  const backToLearn = () => {
    // The Learn tab that opened this one takes it back; with no opener, go there and ask for it.
    if (post(window.opener as Window | null, 'lab:dock')) {
      window.close();
      return;
    }
    const lab = window.location.pathname + window.location.search;
    window.location.href = `${STUDY_ORIGIN}/?lab=${encodeURIComponent(lab)}`;
  };
  const close = () => {
    window.close();
    // A tab the user opened by hand cannot be closed by script: go to the study app instead.
    window.setTimeout(() => {
      window.location.href = `${STUDY_ORIGIN}/`;
    }, 150);
  };
  return (
    <div className="flex items-center gap-2">
      <button id="lab-back-to-learn" type="button" title="Back to Learn — put Lab beside the lesson" aria-label="Back to Learn" className={GLYPH_BTN} onClick={backToLearn}>
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M14 4v16" />
          <path d="M11 12H6" />
          <path d="M8.5 9.5L6 12l2.5 2.5" />
        </svg>
      </button>
      <button id="lab-close" type="button" title="Close Lab" aria-label="Close Lab" className={GLYPH_BTN} onClick={close}>
        <CloseGlyph />
      </button>
    </div>
  );
}

// ⚑ 25-09-26 (user): inside the Learn window there is NO header (no logo, no "Lab", no account) —
//   App renders none, and WindowControls sits at the end of the selector row instead.
export function Header({ name }: { name: string | null }) {
  return (
    <header className="px-4 sm:px-12 py-4 sm:py-5 gap-4 flex justify-between items-center text-white border-b border-gray-800 bg-gray-900">
      <a
        id="lab-brand"
        // Inside the Learn window the logo must not navigate the panel to the study app.
        href={EMBEDDED ? undefined : STUDY_HOME}
        className="flex items-center gap-3 min-w-0 min-h-[44px] rounded-lg pr-2 whitespace-nowrap text-white transition-colors hover:text-brand-400"
        aria-label="Lab — back to the study app"
      >
        <svg className="w-8 h-8 shrink-0" viewBox="0 0 40 40" aria-hidden="true">
          <rect x="2" y="2" width="36" height="36" rx="9" fill="none" stroke="currentColor" strokeWidth="2.5" />
          <g fill="currentColor">
            <rect x="13" y="11" width="4.5" height="18" rx="1" />
            <rect x="13" y="11" width="14" height="4.5" rx="1" />
            <rect x="13" y="24.5" width="14" height="4.5" rx="1" />
          </g>
          <rect x="13" y="17.75" width="10" height="4.5" rx="1" fill="#ef5b5b" />
        </svg>
        {/* ⚑ 25-09-26 (user): the mark + "Lab" only, like the importer's mark + "Importer". */}
        <span className="text-xl sm:text-2xl font-bold tracking-widest uppercase">Lab</span>
      </a>
      <div className="flex items-center gap-6 shrink-0 text-sm font-semibold tracking-wider">
        {/* ⚑ 25-09-26 (user): the signed-in account in brand red, so it is obvious whose kernel runs. */}
        {name ? <span id="lab-user" className="hidden sm:inline text-brand-600 normal-case">{name}</span> : null}
        <WindowControls />
      </div>
    </header>
  );
}
