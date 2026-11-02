// LIVE ROOMS — the lobby (study-rooms-qna P3, 30-09-26). Everyone sees the code and who is in;
// only the owner gets Start.
import type { LobbyPlayer } from './useRoomSocket';
import { CAPTION, CARD, PRIMARY_BTN } from '../shell/ui';

export function Lobby(props: { code: string; players: LobbyPlayer[]; qCount: number; secs: number; mode?: 'speed' | 'accuracy'; isOwner: boolean; onStart: () => void }) {
  const { code, players, qCount, secs, mode, isOwner, onStart } = props;
  return (
    <div className={CARD}>
      <p className={CAPTION}>Room code</p>
      <p id="live-code" className="mt-1 text-4xl font-bold tracking-[0.3em] text-white">{code}</p>
      <p className="mt-2 text-sm text-gray-400">{`${qCount} questions · ${secs} s each · ${mode === 'accuracy' ? '1 point per correct answer' : 'faster answers score more'}`}</p>
      <p className={`${CAPTION} mt-6`}>{`Players (${players.length})`}</p>
      <ul id="live-players" className="mt-2 flex flex-wrap gap-2">
        {players.map((p) => (
          <li key={p.name} className={p.online ? 'rounded-lg border border-gray-600 px-3 py-2 text-white' : 'rounded-lg border border-gray-700 px-3 py-2 text-gray-500'}>
            {p.name}
          </li>
        ))}
      </ul>
      {isOwner ? (
        <div className="mt-6">
          <button id="live-start-btn" type="button" className={PRIMARY_BTN} disabled={players.length === 0} onClick={onStart}>
            Start
          </button>
        </div>
      ) : (
        <p className="mt-6 text-sm text-gray-400">Waiting for the host.</p>
      )}
    </div>
  );
}
