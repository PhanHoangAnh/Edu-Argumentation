// THE IN-APP DIALOG — confirm / notice / text prompt (30-09-26, study-rooms-qna P2 defect D).
//
// ⚑ User (30-09-26): "why using this browser's popup bruh. It should use its own popup model of
//   the page". The browser's native dialogs are GONE from this app; gates/gate-r-ro.mjs R-RO4
//   fails the build if one comes back anywhere under src/.
//
// Reuse-first: the shell is the quiz-setup dialog's own (quiz/QuizSetupScreen.tsx) — the
// `bg-black/70` backdrop, the `role="dialog" aria-modal` panel with `bg-gray-800 border
// border-gray-700 rounded-2xl p-6 sm:p-8 shadow-2xl`, and the shell/ui.ts buttons. No new visual
// language: `danger` only turns the panel border brand red and puts the confirm label in the
// primary (red) button.
//
// Behaviour: focus is trapped inside the panel (Tab / Shift+Tab cycle); Esc = cancel; Enter on
// the focused button presses it (native <button>); in a text prompt Enter submits. A danger
// dialog opens with focus on Cancel, so a stray Enter never deletes.
//
// The API is promise-based and module-level, so non-React code (data/writes.ts) can ask too.
// One <DialogHost/> is mounted once (main.tsx). Requests queue; one dialog shows at a time.
// ⛔ Class strings are complete literals (Tailwind purge).
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { BODY_MUTED, FIELD, LABEL, OUTLINE_BTN, PRIMARY_BTN, SECTION_TITLE } from './ui';

interface Base { title: string; body?: string }
export interface ConfirmOptions extends Base { confirmLabel: string; cancelLabel?: string; danger?: boolean }
export interface TextOptions extends Base { label: string; confirmLabel: string; secret?: boolean }

type Request =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: 'notice'; opts: Base; resolve: () => void }
  | { kind: 'text'; opts: TextOptions; resolve: (value: string | null) => void };

const queue: Request[] = [];
let listener: (() => void) | null = null;
const enqueue = (request: Request) => {
  queue.push(request);
  listener?.();
};

/** Yes/no. Resolves true only on the confirm button. */
export function askConfirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => enqueue({ kind: 'confirm', opts, resolve }));
}

/** A message with one OK button. */
export function showNotice(opts: Base): Promise<void> {
  return new Promise((resolve) => enqueue({ kind: 'notice', opts, resolve }));
}

/** One line of text. Resolves null on cancel. */
export function askText(opts: TextOptions): Promise<string | null> {
  return new Promise((resolve) => enqueue({ kind: 'text', opts, resolve }));
}

const PANEL = 'w-full max-w-md bg-gray-800 border border-gray-700 rounded-2xl p-6 sm:p-8 shadow-2xl';
const PANEL_DANGER = 'w-full max-w-md bg-gray-800 border border-brand-600 rounded-2xl p-6 sm:p-8 shadow-2xl';

export function DialogHost() {
  const [, setTick] = useState(0);
  useEffect(() => {
    listener = () => setTick((n) => n + 1);
    return () => { listener = null; };
  }, []);
  const current = queue[0] ?? null;
  if (!current) return null;
  return <DialogView key={queue.length + ':' + current.opts.title} request={current} onDone={() => { queue.shift(); setTick((n) => n + 1); }} />;
}

function DialogView({ request, onDone }: { request: Request; onDone: () => void }) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [text, setText] = useState('');
  const danger = request.kind === 'confirm' && Boolean(request.opts.danger);

  const finish = (ok: boolean) => {
    if (request.kind === 'confirm') request.resolve(ok);
    else if (request.kind === 'notice') request.resolve();
    else request.resolve(ok ? text : null);
    onDone();
  };

  // Focus in, and back to wherever it was when the dialog closes.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const first = request.kind === 'text' ? '#app-dialog-input' : danger ? '#app-dialog-cancel' : '#app-dialog-confirm';
    panelRef.current?.querySelector<HTMLElement>(first)?.focus();
    return () => before?.focus?.();
  }, [request, danger]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
      return;
    }
    if (event.key === 'Enter' && request.kind === 'text' && (event.target as HTMLElement).id === 'app-dialog-input') {
      event.preventDefault();
      finish(true);
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const items = [...panelRef.current.querySelectorAll<HTMLElement>('button, input')].filter((e) => !e.hasAttribute('disabled'));
    if (!items.length) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : (at === items.length - 1 ? 0 : at + 1);
    event.preventDefault();
    items[next].focus();
  };

  const confirmLabel = request.kind === 'notice' ? 'OK' : request.opts.confirmLabel;
  const cancelLabel = request.kind === 'confirm' ? request.opts.cancelLabel || 'Cancel' : 'Cancel';

  return (
    <div id="app-dialog-layer" className="fixed inset-0 z-[80] overflow-y-auto" onKeyDown={onKeyDown}>
      <div id="app-dialog-backdrop" className="fixed inset-0 bg-black/70" onClick={() => finish(false)} />
      <div className="relative min-h-full flex items-center justify-center p-4">
        <div
          ref={panelRef}
          id="app-dialog"
          role={request.kind === 'notice' ? 'alertdialog' : 'dialog'}
          aria-modal="true"
          aria-labelledby="app-dialog-title"
          aria-describedby={request.opts.body ? 'app-dialog-body' : undefined}
          data-danger={danger ? 'true' : undefined}
          className={danger ? PANEL_DANGER : PANEL}
        >
          <h2 id="app-dialog-title" className={SECTION_TITLE}>{request.opts.title}</h2>
          {request.opts.body ? <p id="app-dialog-body" className={BODY_MUTED}>{request.opts.body}</p> : null}
          {request.kind === 'text' ? (
            <div className="mt-4">
              <label htmlFor="app-dialog-input" className={LABEL}>{request.opts.label}</label>
              <input
                id="app-dialog-input"
                type={request.opts.secret ? 'password' : 'text'}
                autoComplete="off"
                className={FIELD}
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </div>
          ) : null}
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            {request.kind !== 'notice' ? (
              <button id="app-dialog-cancel" type="button" className={OUTLINE_BTN} onClick={() => finish(false)}>
                {cancelLabel}
              </button>
            ) : null}
            <button
              id="app-dialog-confirm"
              type="button"
              className={PRIMARY_BTN}
              disabled={request.kind === 'text' && !text.trim()}
              onClick={() => finish(true)}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
