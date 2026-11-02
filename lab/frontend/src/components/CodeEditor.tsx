import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { MAX_CODE_BYTES, byteLength } from '../api';
import { CODE_COLOURS_CSS, highlightPython } from '../codeColours';

// A plain monospace <textarea> — no editor dependency (plan F4). Tab inserts four spaces.
// ⚑ 16-10-26 (user): VS Code-style syntax colours. The <textarea> stays the real editor (typing, caret,
//   selection, Run selection, gates all unchanged); its text is made transparent and a coloured <pre>
//   with the SAME font, padding and scroll position sits behind it. Same trick as any "textarea + overlay"
//   editor — no editor library.
// ⚑ 25-09-26 (user): exactly four buttons — Run, Stop, Reset, Copy. Reset = start over: original
//   code AND a fresh kernel (the old separate "Reset to original" + "Reset kernel" pair, merged).
// ⚑ 05-10-26 (user): Run selection. Highlight lines and Run (or Ctrl+Enter) sends only those lines to
//   the same kernel, so a long lesson runs one part at a time under the 60 s limit. The selection
//   widens to whole lines and is dedented, so a half-selected or indented block still runs.
//   Nothing highlighted = the whole editor, as before. Still exactly four buttons.
export function selectedLines(value: string, start: number, end: number): string | null {
  if (start === end) return null;
  const from = value.lastIndexOf('\n', start - 1) + 1;
  const lastChar = value[end - 1] === '\n' ? end - 1 : end;
  const stop = value.indexOf('\n', lastChar);
  const lines = value.slice(from, stop === -1 ? value.length : stop).split('\n');
  if (!lines.some((line) => line.trim())) return null;
  const indent = Math.min(...lines.filter((line) => line.trim()).map((line) => line.length - line.trimStart().length));
  return lines.map((line) => line.slice(Math.min(indent, line.length - line.trimStart().length))).join('\n');
}

let coloursInjected = false;
function injectColours() {
  if (coloursInjected || typeof document === 'undefined') return;
  coloursInjected = true;
  const style = document.createElement('style');
  style.textContent = CODE_COLOURS_CSS;
  document.head.appendChild(style);
}

const BTN =
  'min-h-[36px] px-3 rounded-lg border text-xs font-semibold uppercase tracking-wider whitespace-nowrap transition-colors active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed';

export function CodeEditor(props: {
  code: string;
  edited: boolean;
  running: boolean;
  onChange: (code: string) => void;
  onRun: (selection?: string) => void;
  onStop: () => void;
  onReset: () => void;
  onCopy: () => void;
  copied: boolean;
}) {
  const size = byteLength(props.code);
  // Long lines never wrap; when some line is wider than the box, a fade on the right edge says
  // "there is more — scroll sideways" (a headless or overlay scrollbar alone is easy to miss).
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const paintRef = useRef<HTMLPreElement>(null);
  injectColours();
  // a trailing newline keeps the last (empty) line's height, so both layers scroll the same distance
  const painted = useMemo(() => highlightPython(props.code) + '\n', [props.code]);
  const [moreRight, setMoreRight] = useState(false);
  const measure = () => {
    const area = areaRef.current;
    if (area) setMoreRight(area.scrollWidth - area.clientWidth - area.scrollLeft > 2);
    const paint = paintRef.current;
    if (area && paint) {
      paint.scrollTop = area.scrollTop;
      paint.scrollLeft = area.scrollLeft;
    }
  };
  useEffect(() => {
    measure();
    const area = areaRef.current;
    if (!area || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, [props.code]);
  const tooBig = size > MAX_CODE_BYTES;
  const [hasSelection, setHasSelection] = useState(false);
  const selection = () => {
    const area = areaRef.current;
    return area ? selectedLines(area.value, area.selectionStart, area.selectionEnd) ?? undefined : undefined;
  };
  const trackSelection = () => setHasSelection(selection() !== undefined);
  useEffect(trackSelection, [props.code]);
  useEffect(() => {
    // selectionchange also covers selections made by keyboard, double-click and select-all
    const onChange = () => {
      if (document.activeElement === areaRef.current) trackSelection();
    };
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (!props.running && !tooBig) props.onRun(selection());
      return;
    }
    if (event.key !== 'Tab' || event.shiftKey) return;
    event.preventDefault();
    const area = event.currentTarget;
    const { selectionStart, selectionEnd, value } = area;
    const next = `${value.slice(0, selectionStart)}    ${value.slice(selectionEnd)}`;
    props.onChange(next);
    requestAnimationFrame(() => {
      area.selectionStart = area.selectionEnd = selectionStart + 4;
    });
  };

  return (
    // ⚑ 25-09-26 (user): the code panel is a CARD like the result panel, with its buttons in the card's
    //   header row — so side by side the two cards are exactly the same height.
    <div id="lab-code" className="flex flex-col h-full min-h-0 rounded-xl bg-gray-800 border border-gray-700 overflow-hidden">
      {/* ⚑ 25-09-26 (user): header keeps its padding; the editor below fills the card edge to edge. */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-700">
        <h3 className="mr-auto text-xs font-semibold uppercase tracking-wider text-gray-400">Code</h3>
        <button
          id="lab-run-btn"
          type="button"
          onClick={() => props.onRun(selection())}
          disabled={props.running || tooBig}
          title="Highlight lines to run only them; nothing highlighted runs everything"
          className={`${BTN} border-brand-600 bg-brand-600 text-white hover:bg-brand-500`}
        >
          {hasSelection ? 'Run selection' : 'Run'}
        </button>
        <button id="lab-stop-btn" type="button" onClick={props.onStop} disabled={!props.running} className={`${BTN} border-gray-600 text-gray-200 hover:bg-gray-700`}>
          Stop
        </button>
        <button
          id="lab-reset-btn"
          type="button"
          onClick={props.onReset}
          disabled={props.running}
          title="Start over: the lesson's original code, a fresh Python session, an empty result"
          className={`${BTN} border-gray-600 text-gray-200 hover:bg-gray-700`}
        >
          Reset
        </button>
        <button id="lab-copy-btn" type="button" onClick={props.onCopy} className={`${BTN} border-gray-600 text-gray-200 hover:bg-gray-700`}>
          {props.copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="relative flex-1 min-h-[12rem] bg-gray-950">
        <pre
          ref={paintRef}
          id="lab-editor-paint"
          aria-hidden="true"
          className="absolute inset-0 m-0 overflow-hidden whitespace-pre pointer-events-none p-4 font-mono text-sm leading-6 text-gray-100"
          style={{ tabSize: 4 }}
          dangerouslySetInnerHTML={{ __html: painted }}
        />
        <textarea
          id="lab-editor"
          ref={areaRef}
          wrap="off"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          value={props.code}
          onChange={(e) => props.onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onSelect={trackSelection}
          onKeyUp={trackSelection}
          onMouseUp={trackSelection}
          onScroll={measure}
          aria-label="Lesson code"
          style={{ tabSize: 4, caretColor: '#f3f4f6' }}
          className="absolute inset-0 w-full h-full resize-none bg-transparent border-0 text-transparent p-4 font-mono text-sm leading-6 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-600"
        />
        {moreRight ? (
          <div
            id="lab-editor-more"
            aria-hidden="true"
            className="pointer-events-none absolute top-px bottom-3 right-3 w-10 bg-gradient-to-l from-gray-950 to-transparent flex items-center justify-end pr-1 text-gray-400"
          >
            <span className="text-lg leading-none">›</span>
          </div>
        ) : null}
      </div>
      {tooBig ? (
        <p id="lab-too-big" className="px-4 py-2 text-sm text-red-400 border-t border-gray-700">
          This code is {Math.ceil(size / 1024)} KB. The shared runner takes at most 64 KB per run.
        </p>
      ) : null}
    </div>
  );
}
