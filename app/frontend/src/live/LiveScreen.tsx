// LIVE quiz rooms — the second add-on screen (study-rooms-qna P3, 30-09-26).
//
// Rendered by the add-on registry inside <Screen id="live-screen"> (shell/screens.tsx). Host a room
// (book + lessons, 5-30 questions, 10/20/30 s) or join one by its 6-character code; lobby; timed
// questions; speed points; a board after every question; a podium at the end.
//
// ⚑ The current room code survives a reload (localStorage `live:<accountId>`) until Leave — the
//   socket rejoins with the same account and the score is kept.
// ⚑ ONE live region: #live-status (role=status, atomic) — question number, your score, your rank.
// ⚠ D2 (accepted limitation): any signed-in reader can look an answer up in /book/<id>/module.json.
//   The room protocol still never sends `correct` before the reveal.
// ⛔ Class strings are complete literals (Tailwind purge). Copy stays terse.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAccount } from '../account/AccountContext';
import { loginUrl } from '../data/client';
import { askConfirm } from '../shell/dialog';
import { BODY_MUTED, CARD, EYEBROW, OUTLINE_BTN, PAGE_TITLE, PRIMARY_BTN } from '../shell/ui';
import { CreateRoom } from './CreateRoom';
import { JoinRoom } from './JoinRoom';
import { Lobby } from './Lobby';
import { LiveQuestion } from './LiveQuestion';
import { Leaderboard } from './Leaderboard';
import { Podium } from './Podium';
import { useRoomSocket } from './useRoomSocket';

const ROOT = 'space-y-6 motion-reduce:[&_*]:transition-none motion-reduce:[&_*]:transform-none';

const ENDED_TEXT: Record<string, string> = {
  owner_left: 'Room ended — the host left.',
  expired: 'Room ended — it was idle too long.',
  replaced: 'Room opened in another tab.',
};

function readCode(key: string): string | null {
  try {
    const value = window.localStorage.getItem(key);
    return value && /^[A-Z0-9]{6}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function LiveScreen({ open }: { open: boolean }) {
  const account = useAccount();
  const storeKey = `live:${account.id}`;
  const me = account.displayName || account.username;
  const [code, setCodeState] = useState<string | null>(() => readCode(storeKey));
  const [attempt, setAttempt] = useState(0);
  const { state, send } = useRoomSocket(code, attempt);
  const [chosen, setChosen] = useState<Record<number, number>>({});
  const [endsAt, setEndsAt] = useState<number>(0);

  const setCode = useCallback((next: string | null) => {
    try {
      if (next) window.localStorage.setItem(storeKey, next);
      else window.localStorage.removeItem(storeKey);
    } catch { /* storage full or blocked: the room still works this tab */ }
    setChosen({});
    setCodeState(next);
  }, [storeKey]);

  const question = state.question;
  useEffect(() => {
    if (!question) return;
    // Clock skew: trust the server's remaining time, but never more than the question's length.
    const remaining = Math.max(0, Math.min(question.secs * 1000, question.deadline - Date.now()));
    setEndsAt(Date.now() + remaining);
  }, [question]);

  const answer = useCallback((choice: number) => {
    if (!question || state.reveal?.qIdx === question.qIdx || chosen[question.qIdx] !== undefined) return;
    setChosen((c) => ({ ...c, [question.qIdx]: choice }));
    send({ type: 'answer', qIdx: question.qIdx, choice });
  }, [question, state.reveal, chosen, send]);

  // The in-app dialog (shell/dialog.tsx), never the browser's (gate-r-ro R-RO4).
  const leave = async () => {
    if (state.status !== 'ended' && !(await askConfirm({ title: 'Leave this room?', body: 'Your score stays; you can rejoin with the code.', confirmLabel: 'Leave' }))) return;
    setCode(null);
  };

  const lobby = state.lobby;
  const isOwner = Boolean(lobby && lobby.owner === me && lobby.code === code);
  const reveal = question && state.reveal && state.reveal.qIdx === question.qIdx ? state.reveal : null;
  const myRow = useMemo(() => (state.final?.board ?? state.reveal?.board ?? []).find((r) => r.name === me), [state.final, state.reveal, me]);

  let status = '';
  if (!code) status = '';
  else if (state.status === 'ended') status = ENDED_TEXT[state.endedReason ?? ''] ?? 'Room ended.';
  else if (state.status === 'signin') status = 'Sign in again to play.';
  else if (state.status === 'full') status = 'Room is full.';
  else if (state.status === 'unavailable') status = 'Accounts are unavailable — try again shortly.';
  else if (state.status === 'lost') status = 'Connection lost.';
  else if (state.status === 'reconnecting') status = 'Reconnecting…';
  else if (state.final) status = myRow ? `Final — you placed ${myRow.rank} with ${myRow.score}` : 'Final.';
  else if (reveal && question) status = myRow ? `Question ${question.qIdx + 1} — score ${myRow.score}, rank ${myRow.rank}` : `Question ${question.qIdx + 1} revealed.`;
  else if (question) status = `Question ${question.qIdx + 1} of ${question.total}`;
  else if (lobby) status = `Lobby — ${lobby.players.length} player${lobby.players.length === 1 ? '' : 's'}`;
  else status = 'Connecting…';

  const stopped = ['ended', 'signin', 'full', 'unavailable', 'lost'].includes(state.status);

  return (
    <div className={ROOT}>
      <div className={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={EYEBROW}>{code ? `Room ${code}` : 'Quiz rooms'}</p>
            <h1 className={PAGE_TITLE}>Live</h1>
          </div>
          {code ? (
            <button id="live-leave-btn" type="button" className={OUTLINE_BTN} onClick={() => void leave()}>
              Leave
            </button>
          ) : null}
        </div>
        <p id="live-status" role="status" aria-live="polite" aria-atomic="true" className={BODY_MUTED}>
          {status}
        </p>
      </div>

      {!code ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <CreateRoom onRoom={setCode} />
          <JoinRoom onRoom={setCode} />
        </div>
      ) : stopped ? (
        <div id="live-stopped" className={CARD}>
          <p className="text-lg text-white">{status}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            {state.status === 'signin' ? (
              <a id="live-signin-link" className={PRIMARY_BTN + ' inline-flex items-center'} href={loginUrl()}>Sign in</a>
            ) : null}
            {state.status === 'lost' || state.status === 'unavailable' ? (
              <button id="live-retry-btn" type="button" className={PRIMARY_BTN} onClick={() => setAttempt((n) => n + 1)}>Try again</button>
            ) : null}
            <button id="live-back-btn" type="button" className={OUTLINE_BTN} onClick={() => setCode(null)}>Back</button>
          </div>
        </div>
      ) : state.final ? (
        <Podium podium={state.final.podium} board={state.final.board} me={me} />
      ) : question ? (
        <>
          <LiveQuestion
            open={open}
            qIdx={question.qIdx}
            total={question.total}
            question={question.question}
            options={question.options}
            secs={question.secs}
            endsAt={endsAt}
            chosen={chosen[question.qIdx] ?? null}
            locked={chosen[question.qIdx] !== undefined || state.answeredQ === question.qIdx}
            reveal={reveal ? { correct: reveal.correct, explanations: reveal.explanations } : null}
            onAnswer={answer}
          />
          {reveal ? (
            <>
              <Leaderboard rows={reveal.perQuestionBoard} me={me} />
              {isOwner ? (
                <div>
                  <button id="live-next-btn" type="button" className={PRIMARY_BTN} onClick={() => send({ type: 'next' })}>
                    {question.qIdx + 1 < question.total ? 'Next' : 'Finish'}
                  </button>
                </div>
              ) : (
                <p className="text-sm text-gray-400">Waiting for the host.</p>
              )}
            </>
          ) : null}
        </>
      ) : lobby ? (
        <Lobby code={lobby.code} players={lobby.players} qCount={lobby.qCount} secs={lobby.secs} mode={lobby.mode} isOwner={isOwner} onStart={() => send({ type: 'start' })} />
      ) : (
        <div className={CARD}><p className="text-gray-400">Connecting…</p></div>
      )}
    </div>
  );
}
