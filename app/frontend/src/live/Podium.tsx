// LIVE ROOMS — the final podium + full board (study-rooms-qna P3, 30-09-26). Static: no animation.
import type { BoardRow } from './useRoomSocket';
import { CAPTION, CARD, SECTION_TITLE } from '../shell/ui';

const PLACE = ['1st', '2nd', '3rd'];

export function Podium({ podium, board, me }: { podium: BoardRow[]; board: BoardRow[]; me: string }) {
  return (
    <div id="live-podium" className={CARD}>
      <h2 className={SECTION_TITLE}>Final</h2>
      <ol className="mt-4 grid gap-3 sm:grid-cols-3">
        {podium.map((r, i) => (
          <li key={r.name} className="rounded-xl border border-gray-600 bg-gray-900/60 p-4 text-center">
            <p className={CAPTION}>{PLACE[i]}</p>
            <p className="mt-1 text-lg text-white">{r.name}</p>
            <p className="text-sm tabular-nums text-gray-400">{r.score}</p>
          </li>
        ))}
      </ol>
      {board.length > podium.length ? (
        <ol className="mt-4 space-y-2" start={podium.length + 1}>
          {board.slice(podium.length).map((r) => (
            <li key={r.name} className={r.name === me ? 'flex justify-between rounded-lg border border-brand-600 px-3 py-2 text-white' : 'flex justify-between rounded-lg border border-gray-700 px-3 py-2 text-gray-200'}>
              <span>{`${r.rank}. ${r.name}`}</span>
              <span className="tabular-nums">{r.score}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
