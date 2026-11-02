import type { ReactNode } from 'react';
import type { Output, RunResult } from '../api';

// Rendering ported from ml/study/geron-lab/viewer/page.html: stdout as <pre>, stderr in red,
// errors as a traceback block, images inline, HTML tables inside a SANDBOXED iframe
// (never injected into this page).
// ⚑ 24-09-26: text keeps the program's own layout (white-space: pre, app.css .lab-pre) and a
//   wide block scrolls sideways inside itself; the panel scrolls vertically; images fit its width.

export type ResultState =
  | { kind: 'idle' }
  | { kind: 'running'; seconds: number }
  | { kind: 'done'; result: RunResult }
  | { kind: 'failed'; status: number; message: string };

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

const STATUS_TEXT: Record<string, string> = {
  ok: 'Finished',
  error: 'Finished with an error',
  timeout: 'Stopped — the time limit was reached',
  busy: 'This lesson is still running — press Stop, or wait for it to finish',
  restarted: 'The kernel had stopped and was restarted — run again',
  dead: 'The kernel stopped',
};

function OutputBlock({ output }: { output: Output }) {
  switch (output.kind) {
    case 'stream':
      return (
        <pre data-output="stream" className={`lab-pre font-mono text-sm leading-6 ${output.name === 'stderr' ? 'text-red-300' : 'text-gray-100'}`}>
          {output.text}
        </pre>
      );
    case 'text':
      return <pre data-output="text" className="lab-pre font-mono text-sm leading-6 text-gray-100">{output.data}</pre>;
    case 'html':
      return (
        <iframe
          data-output="html"
          title="Table output"
          sandbox=""
          srcDoc={`<style>body{font:13px sans-serif;margin:0;color:#111}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:2px 6px}</style>${output.data}`}
          className="w-full min-h-[12rem] rounded-lg bg-white"
        />
      );
    case 'image':
      return <img data-output="image" alt="Figure produced by the code" src={`data:image/png;base64,${output.data}`} className="block max-w-full h-auto rounded-lg bg-white" />;
    case 'error':
      return (
        <pre data-output="error" className="lab-pre font-mono text-sm leading-6 rounded-lg bg-red-950/60 border border-red-900 text-red-200 p-3">
          {(output.traceback?.length ? output.traceback.join('\n') : `${output.ename}: ${output.evalue}`).replace(ANSI, '')}
        </pre>
      );
    default:
      return null;
  }
}

function failureText(status: number, message: string): string {
  if (status === 503 && /busy/i.test(message)) return 'The runner is busy — try again in a minute';
  if (status === 503) return 'The sign-in service is unavailable — try again in a minute';
  if (status === 413) return 'Code is over 64 KB — the shared runner takes at most 64 KB per run';
  if (status === 502) return 'Runner offline';
  if (status === 429) return 'Too many runs — at most 60 a minute. Wait a moment and try again';
  return message;
}

export function ResultPanel({ state, onCopy }: { state: ResultState; onCopy: () => void }) {
  let status: { text: string; tone: string } | null = null;
  let body: ReactNode = null;
  if (state.kind === 'idle') {
    body = null; // ⚑ 25-09-26 (user): no placeholder text — an empty panel until the first Run.
  } else if (state.kind === 'running') {
    status = {
      text: `Running… ${state.seconds} s${state.seconds >= 3 ? ' (the first run of a lesson starts a kernel, which can take ~10 s)' : ''}`,
      tone: 'text-gray-300',
    };
  } else if (state.kind === 'failed') {
    status = { text: failureText(state.status, state.message), tone: 'text-red-400' };
  } else {
    const { result } = state;
    const seconds = result.elapsed_ms != null ? ` · ${(result.elapsed_ms / 1000).toFixed(1)} s` : '';
    status = {
      text: `${STATUS_TEXT[result.status] ?? result.status}${seconds}`,
      tone: result.status === 'ok' ? 'text-green-400' : result.status === 'error' ? 'text-red-400' : 'text-amber-300',
    };
    body = (
      <div className="flex flex-col gap-3">
        {result.heavy ? (
          <div id="lab-heavy" className="rounded-xl border border-amber-500/60 bg-amber-500/10 p-4 flex flex-col gap-3">
            <p className="text-amber-200 font-semibold">{result.message}</p>
            <div>
              <button
                id="lab-heavy-copy-btn"
                type="button"
                onClick={onCopy}
                className="min-h-[40px] px-4 rounded-lg border border-amber-500/60 text-amber-100 text-sm font-semibold uppercase tracking-wider hover:bg-amber-500/20"
              >
                Copy the code
              </button>
            </div>
          </div>
        ) : null}
        {result.outputs.length === 0 && !result.heavy ? <p className="text-sm text-gray-500">The code ran and printed nothing.</p> : null}
        {result.outputs.map((output, index) => (
          <OutputBlock key={index} output={output} />
        ))}
      </div>
    );
  }
  return (
    <div id="lab-result" className="flex flex-col gap-3 h-full min-h-0 rounded-xl bg-gray-800 border border-gray-700 p-4 overflow-y-auto overflow-x-hidden" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Result</h3>
        {status ? (
          <p id="lab-status" data-status={state.kind === 'done' ? state.result.status : state.kind} className={`text-sm ${status.tone}`}>
            {status.text}
          </p>
        ) : null}
      </div>
      {body}
    </div>
  );
}
