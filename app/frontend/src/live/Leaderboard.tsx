// LIVE ROOMS — the per-question board shown at each reveal (study-rooms-qna P3, 30-09-26).
import type { PerQuestionRow } from './useRoomSocket';
import { CAPTION, CARD } from '../shell/ui';

export function Leaderboard({ rows, me }: { rows: PerQuestionRow[]; me: string }) {
  const ranked = [...rows].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return (
    <div id="live-board" className={CARD}>
      <p className={CAPTION}>Leaderboard</p>
      <ol className="mt-3 space-y-2">
        {ranked.map((r, i) => (
          <li key={r.name} className={r.name === me ? 'flex items-center justify-between rounded-lg border border-brand-600 px-3 py-2 text-white' : 'flex items-center justify-between rounded-lg border border-gray-700 px-3 py-2 text-gray-200'}>
            <span>{`${i + 1}. ${r.name}`}</span>
            <span className="tabular-nums">{r.answered ? `+${r.points}` : '—'} · {r.score}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
