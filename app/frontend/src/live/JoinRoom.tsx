// LIVE ROOMS — join by code (study-rooms-qna P3, 30-09-26). The code is checked with a GET
// (data/client.ts) before the socket opens, so a wrong code says so instead of "Room ended".
import { useState } from 'react';
import { ApiError, getJson } from '../data/client';
import { CARD, FIELD, LABEL, OUTLINE_BTN, SECTION_TITLE } from '../shell/ui';

const CODE_RE = /^[A-Z0-9]{6}$/;

export function JoinRoom({ onRoom }: { onRoom: (code: string) => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const join = async () => {
    const wanted = code.trim().toUpperCase();
    if (!CODE_RE.test(wanted)) { setError('A code is 6 letters or digits.'); return; }
    setBusy(true);
    setError('');
    try {
      await getJson(`/api/rooms/${wanted}`);
      onRoom(wanted);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? 'No room with that code.' : 'Could not join.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={CARD}>
      <h2 className={SECTION_TITLE}>Join</h2>
      <div className="mt-4">
        <label htmlFor="live-join-code" className={LABEL}>Room code</label>
        <input
          id="live-join-code"
          type="text"
          inputMode="text"
          autoComplete="off"
          maxLength={6}
          className={`${FIELD} uppercase tracking-widest`}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === 'Enter') void join(); }}
        />
      </div>
      {error ? <p id="live-join-error" className="mt-4 text-sm text-brand-400">{error}</p> : null}
      <div className="mt-6">
        <button id="live-join-btn" type="button" className={OUTLINE_BTN} disabled={busy || code.trim().length !== 6} onClick={() => void join()}>
          Join
        </button>
      </div>
    </div>
  );
}
