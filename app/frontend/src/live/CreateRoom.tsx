// LIVE ROOMS — create a room (study-rooms-qna P3, 30-09-26). The shared ScopePicker picks the
// book + lessons; 5-30 questions; 10/20/30 s per question. POST goes through data/writes.ts (E3).
import { useEffect, useState } from 'react';
import { postJson } from '../data/writes';
import { useLibrary } from '../state/LibraryProvider';
import { useBookContext } from '../state/BookProvider';
import { ScopePicker } from '../scope/ScopePicker';
import type { ScopeValue } from '../scope/ScopePicker';
import { CARD, FIELD, LABEL, OUTLINE_BTN, PRIMARY_BTN, SECTION_TITLE } from '../shell/ui';

const Q_COUNTS = [5, 10, 15, 20, 25, 30];
const SECS = [10, 20, 30];
const MODES: { id: 'speed' | 'accuracy'; label: string }[] = [
  { id: 'speed', label: 'Speed — faster correct answers score more' },
  { id: 'accuracy', label: 'Accuracy — 1 point per correct answer, speed does not count' },
];

export function CreateRoom({ onRoom }: { onRoom: (code: string) => void }) {
  const { ordered } = useLibrary();
  const { activeBookFile } = useBookContext();
  const [scope, setScope] = useState<ScopeValue>({ bookId: '', blocks: [] });
  const [qCount, setQCount] = useState(10);
  const [secs, setSecs] = useState(20);
  const [mode, setMode] = useState<'speed' | 'accuracy'>('speed');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mine, setMine] = useState<string | null>(null);

  useEffect(() => {
    if (!scope.bookId && activeBookFile && ordered.some((b) => b.file === activeBookFile)) setScope({ bookId: activeBookFile, blocks: [] });
  }, [activeBookFile, ordered, scope.bookId]);

  const create = async () => {
    setBusy(true);
    setError('');
    setMine(null);
    try {
      const response = await postJson('/api/rooms', { bookId: scope.bookId, blocks: scope.blocks, qCount, secs, mode });
      const body = (await response.json().catch(() => ({}))) as { code?: string; error?: string };
      if (response.ok && body.code) onRoom(body.code);
      else if (response.status === 409 && body.code) { setMine(body.code); setError('You already have an open room.'); }
      else setError(body.error || 'Could not create the room.');
    } catch {
      setError('Could not create the room.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={CARD}>
      <h2 className={SECTION_TITLE}>Host</h2>
      <div className="mt-4">
        <ScopePicker books={ordered} value={scope} onChange={setScope} allowBookPick idBase="live" />
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="live-qcount" className={LABEL}>Questions</label>
          <select id="live-qcount" className={FIELD} value={qCount} onChange={(e) => setQCount(Number(e.target.value))}>
            {Q_COUNTS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="live-secs" className={LABEL}>Seconds per question</label>
          <select id="live-secs" className={FIELD} value={secs} onChange={(e) => setSecs(Number(e.target.value))}>
            {SECS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>
      <div className="mt-4">
        <label htmlFor="live-mode" className={LABEL}>Scoring</label>
        <select id="live-mode" className={FIELD} value={mode} onChange={(e) => setMode(e.target.value === 'accuracy' ? 'accuracy' : 'speed')}>
          {MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </div>
      {error ? <p id="live-create-error" className="mt-4 text-sm text-brand-400">{error}</p> : null}
      <div className="mt-6 flex flex-wrap gap-3">
        <button id="live-create-btn" type="button" className={PRIMARY_BTN} disabled={busy || !scope.bookId || scope.blocks.length === 0} onClick={() => void create()}>
          Create room
        </button>
        {mine ? (
          <button id="live-rejoin-btn" type="button" className={OUTLINE_BTN} onClick={() => onRoom(mine)}>
            Rejoin {mine}
          </button>
        ) : null}
      </div>
    </div>
  );
}
