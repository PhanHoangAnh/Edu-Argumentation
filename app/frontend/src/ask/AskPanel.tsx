// Seam 19 (ask) — THE IN-APP TUTOR PANEL. Independently shippable (221 lines).
//
// PORTED FROM (by symbol, app.js): askDom, askLessonLabel, askSyncLesson, askSave,
// askRecord, askRestore, askNewConversation, askBubble, askSetOpen, askSubmit, askInit,
// ASK_STORE_KEY, ASK_MAX_TURNS, ASK_BADGE.
//
// ⚑ PHASE 04 (23-09-26): SENDING IS WIRED, through data/writes.postJson (the one POST site).
//   The conversation persists to localStorage `eduAskConversation`, bounded to ASK_MAX_TURNS=40,
//   and survives closing the panel AND a reload — it is thrown away only on New.
//
// ⚠ The tutor answers grounded lesson -> book -> model knowledge, and each answer is
//   LABELLED with which of the three it came from (ASK_BADGE). The badge is not
//   decoration: it is how the reader knows whether the book actually said this.
//
// ⚑ 22-09-26 (EVL fix 004, R-3) — TWO DEFECTS FIXED HERE, and they are different in kind:
//
//   1. THE PANEL AND THE FAB CARRIED NO CLASS STRINGS AT ALL. MEASURED on the deployed
//      :8792: #ask-panel opened at **48 px tall** with its whole contents collapsed to the
//      running text "CloseNew conversation / Send", and #ask-fab rendered as the bare word
//      "Ask". Every class below is copied from aws-quiz-app/index.html:566-587, element for
//      element — the same failure and the same fix as D-4 (picker) and D-5 (library).
//
//   2. ⛔⛔ THE FAB WAS VISIBLE ON EVERY SCREEN. The legacy scopes it to the READER and
//      nothing else (app.js:3710-3717): it observes #tutorial-screen's class attribute and
//      toggles `hidden-view` on the FAB with it, ALSO force-closing the panel on the way
//      out. Without that, the FAB floated over the home page, the quiz, the settings screen
//      and — visibly, in screenshot 08-quiz-setup.png — straight THROUGH the quiz-setup
//      backdrop, which is a modal it has no business being above.
//      ⚠ The observer is NOT ported: React already knows which screen is up, so `reading`
//        is a prop from shell/AppShell. The legacy's own comment explains why IT needed an
//        observer — "rather than patching the five places that show or hide it, one of
//        those would eventually be missed" — and a single owning prop is the same argument
//        answered better. The BEHAVIOUR is identical; only the plumbing is React's.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { setChatMode, useChatDock } from './chatDock';
import { useBookContext } from '../state/BookProvider';
import { useReaderCursor } from '../state/ReaderCursorProvider';
import { useProviderReadiness } from '../data/queries';
import { generationToken, postJson } from '../data/writes';
import { RichTextViewer } from '../reader/RichTextViewer';

const ASK_STORE_KEY = 'eduAskConversation';
const ASK_MAX_TURNS = 40;

/** ASK_BADGE (app.js:3562) — WHERE the answer came from is not decoration. */
const ASK_BADGE: Record<string, [string, string]> = {
  lesson: ['This lesson', 'bg-green-500/15 text-green-300 border-green-500/30'],
  book: ['From the book', 'bg-blue-500/15 text-blue-300 border-blue-500/30'],
  general: ['Outside the book', 'bg-amber-500/15 text-amber-300 border-amber-500/30'],
};

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  source?: string;
  page?: number | null;
  /** Transient UI states, never saved. */
  pending?: string;
  failed?: string;
}

function readTurns(): Turn[] {
  try {
    const saved = JSON.parse(localStorage.getItem(ASK_STORE_KEY) || 'null');
    const turns = saved && Array.isArray(saved.turns) ? saved.turns : [];
    return turns.filter((t: Turn) => t && (t.role === 'user' || t.role === 'assistant'));
  } catch {
    return [];
  }
}

/** formatText's markup (app.js:1404), kept in the stored turn exactly as the legacy stores it. */
function viewerHtml(text: string): string {
  return `<rich-text-viewer content="${encodeURIComponent(text)}"></rich-text-viewer>`;
}

function saveTurns(turns: Turn[]): void {
  try {
    const clean = turns
      .filter((t) => !t.pending && !t.failed)
      .slice(-ASK_MAX_TURNS)
      .map((t) =>
        t.role === 'assistant'
          ? { role: t.role, text: t.text, html: viewerHtml(t.text), source: t.source, page: t.page }
          : { role: t.role, text: t.text },
      );
    localStorage.setItem(ASK_STORE_KEY, JSON.stringify({ turns: clean }));
  } catch {
    /* private window or full storage: the panel still works for this session */
  }
}

function Badge({ source, page }: { source?: string; page?: number | null }) {
  const [label, classes] = ASK_BADGE[source || 'general'] || ASK_BADGE.general;
  return (
    <span className={`inline-block mb-2 rounded border px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider ${classes}`}>
      {page ? `${label} · p.${page}` : label}
    </span>
  );
}

export interface AskPanelProps {
  /** True only while the reader is the visible screen. See the ⚑ block above. */
  reading: boolean;
}

export function AskPanel({ reading }: AskPanelProps) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>(readTurns);
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const fabRef = useRef<HTMLButtonElement | null>(null);
  const { activeBookFile, chapters, blocksOf } = useBookContext();
  const { cursor } = useReaderCursor();
  const provider = useProviderReadiness();
  // ⚑ 22-10-26 (user): the panel can dock into Lab's side slot (ReaderScreen offers the slot).
  const dock = useChatDock();
  const side = dock.mode === 'side';
  const slot = side ? dock.slot : null;

  // askSetOpen(false) on the way OUT of the reader (app.js:3715).
  useEffect(() => {
    if (!reading) setOpen(false);
  }, [reading]);

  useEffect(() => {
    if (open || slot) inputRef.current?.focus();
  }, [open, slot]);

  // ⚑ 25-09-26 (user): a click OUTSIDE the panel closes it (Escape too). The FAB is excluded — it
  //   toggles on its own click. Nothing is lost: the conversation is saved, and an answer still in
  //   flight lands in the log and is there when the panel is reopened.
  useEffect(() => {
    if (!open || side) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || panelRef.current?.contains(target) || fabRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, side]);

  // Keep the log scrolled to the newest bubble (askBubble / the finally in askSubmit).
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [turns, open, slot]);

  // askLessonLabel (app.js:3568): which lesson the next answer is grounded in.
  const chapter = chapters[cursor.chapterIndex];
  const block = blocksOf(cursor.chapterIndex)[cursor.blockIndex];
  const context = chapter ? [chapter.title, (block && block.term) || ''].filter(Boolean).join(' · ') : '';

  /** askSubmit (app.js:3659). */
  const submit = async () => {
    if (busy) return;
    const asked = question.trim();
    if (!asked) return;
    const token = await generationToken(provider.tokenRequired);
    if (token === null) return;
    setBusy(true);
    setQuestion('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    // The model's context: the saved conversation's last 6 turns (askHistory.slice(-6)).
    const history = turns
      .filter((t) => !t.pending && !t.failed)
      .map((t) => ({ role: t.role, content: String(t.text || '') }))
      .slice(-6);
    const withUser: Turn[] = [...turns, { role: 'user', text: asked }];
    saveTurns(withUser);
    setTurns([...withUser, { role: 'assistant', text: '', pending: 'Reading the lesson…' }]);
    const replace = (turn: Turn) => setTurns([...withUser, turn]);
    const send = () =>
      postJson(
        '/api/ask',
        { module: activeBookFile, chapter: cursor.chapterIndex + 1, block: cursor.blockIndex + 1, question: asked, history },
        { 'X-Edu-Quiz-Token': token || '' },
      );
    try {
      let response: Response;
      try {
        response = await send();
      } catch {
        // The link to this box spikes; try once more before reporting a failure.
        replace({ role: 'assistant', text: '', pending: 'Connection dropped, retrying…' });
        await new Promise((done) => setTimeout(done, 1500));
        response = await send();
      }
      const data = (await response.json().catch(() => ({}))) as { answer?: string; source?: string; page?: number | null; error?: string };
      if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
      const answer: Turn = { role: 'assistant', text: data.answer || '', source: data.source, page: data.page };
      const next = [...withUser, answer].slice(-ASK_MAX_TURNS);
      setTurns(next);
      saveTurns(next);
    } catch (error) {
      const err = error as Error;
      replace({
        role: 'assistant',
        text: '',
        failed: `Could not reach the tutor — ${err.name || 'Error'}: ${err.message || 'unknown'} (online=${navigator.onLine}, from ${location.origin})`,
      });
    } finally {
      setBusy(false);
    }
  };

  const panel = (
      <section
        id="ask-panel"
        ref={panelRef}
        aria-label="Ask about this lesson"
        data-mode={side ? 'side' : 'popup'}
        className={
          side
            ? 'flex flex-col flex-1 min-h-0 bg-gray-800 lg:border lg:border-gray-700 lg:rounded-xl'
            : `${open ? '' : 'hidden-view '}fixed bottom-24 right-6 z-40 flex flex-col w-[44rem] max-w-[calc(100vw-3rem)] h-[80vh] max-h-[calc(100vh-8rem)] rounded-2xl border border-gray-700 bg-gray-800 shadow-2xl`
        }
        data-max-turns={ASK_MAX_TURNS}
      >
        <header className="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-700 shrink-0">
          <div className="min-w-0">
            <p className="text-white font-semibold text-sm">Ask about this lesson</p>
            <p id="ask-context" className="text-xs text-gray-400 truncate">{context}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              id="ask-new"
              type="button"
              title="Start a new conversation and delete this one"
              className="min-h-[44px] px-3 rounded-lg border border-gray-600 text-gray-300 text-xs font-semibold uppercase tracking-wider hover:text-white hover:bg-gray-700 transition-colors"
              onClick={() => {
                // askNewConversation (app.js:3619) — the ONLY place a conversation is cleared.
                setTurns([]);
                try {
                  localStorage.removeItem(ASK_STORE_KEY);
                } catch {
                  /* nothing to clear */
                }
                setQuestion('');
                inputRef.current?.focus();
              }}
            >
              New
            </button>
            <button
              id="ask-dock"
              type="button"
              aria-label={side ? 'Popup' : 'Dock'}
              title={side ? 'Back to a popup (Lab works again)' : 'Dock to the side (replaces Lab)'}
              className="min-h-[44px] px-3 rounded-lg border border-gray-600 text-gray-300 text-xs font-semibold uppercase tracking-wider hover:text-white hover:bg-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 inline-flex items-center gap-1.5"
              onClick={() => {
                if (side) {
                  setChatMode('popup');
                  setOpen(true);
                } else {
                  setChatMode('side');
                }
              }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                {side ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16v14H4zM13 14h4v3h-4z" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16v14H4zM14 5v14" />
                )}
              </svg>
              {side ? 'Popup' : 'Dock'}
            </button>
            <button
              id="ask-close"
              type="button"
              aria-label="Close"
              className="min-h-[44px] min-w-[44px] -mr-2 -mt-1 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
              onClick={() => {
                if (side) setChatMode('popup');
                setOpen(false);
              }}
            >
              <svg className="w-5 h-5 mx-auto" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </header>

        <div id="ask-log" ref={logRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-sm [overflow-wrap:anywhere]">
          {turns.map((turn, index) =>
            turn.role === 'user' ? (
              <div key={index} className="flex justify-end">
                {/* textContent: the question is learner input and is never parsed as markup. */}
                <div className="max-w-[85%] rounded-xl bg-brand-600 text-white px-3 py-2">
                  <div>{turn.text}</div>
                </div>
              </div>
            ) : (
              <div key={index}>
                <div className="rounded-xl bg-gray-900/60 border border-gray-700 px-3 py-2 text-gray-200">
                  {turn.pending ? (
                    <div className="text-gray-500">{turn.pending}</div>
                  ) : turn.failed ? (
                    <span className="text-red-300">{turn.failed}</span>
                  ) : (
                    <>
                      <Badge source={turn.source} page={turn.page} />
                      <div>
                        <RichTextViewer content={turn.text} />
                      </div>
                    </>
                  )}
                </div>
              </div>
            ),
          )}
        </div>

        <form
          id="ask-form"
          className="shrink-0 border-t border-gray-700 p-3 flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="sr-only" htmlFor="ask-input">
            Your question
          </label>
          {/* ⚑ Phase 04: a <textarea rows=1> that grows to 128px, as the legacy's is. The Phase-03
              <input type="text"> stand-in existed only because it was propping up the contract's
              `[type="text"]` entry — whose real owner, #set-model, is now restored in Settings. */}
          <textarea
            id="ask-input"
            ref={inputRef}
            rows={1}
            maxLength={600}
            placeholder="What don't you get?"
            className="flex-1 resize-none rounded-lg bg-gray-900 border border-gray-600 px-3 py-2 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-brand-600 max-h-32"
            value={question}
            onChange={(event) => {
              setQuestion(event.target.value);
              const field = event.currentTarget;
              field.style.height = 'auto';
              field.style.height = `${Math.min(field.scrollHeight, 128)}px`;
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button
            id="ask-send"
            type="submit"
            disabled={busy}
            className="min-h-[44px] px-4 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Ask
          </button>
        </form>
      </section>
  );

  return (
    <>
      <button
        id="ask-fab"
        ref={fabRef}
        type="button"
        aria-label="Ask about this lesson"
        aria-expanded={open}
        aria-controls="ask-panel"
        className={`${reading && !side ? '' : 'hidden-view '}fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full bg-brand-600 text-white shadow-xl flex items-center justify-center transition-transform hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white`}
        onClick={() => setOpen((on) => !on)}
      >
        {/* 01-11-26 (user: "new chat glyph, align exactly middle all around"): lucide message-square-text.
            Its box is exactly 3..21 on both axes, so it centres in the circle; `block` drops the inline
            baseline gap. */}
        <svg className="block w-7 h-7" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 8h8M8 12h8" />
        </svg>
      </button>

      {slot ? createPortal(panel, slot) : side ? null : panel}
    </>
  );
}
