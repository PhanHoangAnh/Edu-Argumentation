// LIVE ROOMS — the room socket (study-rooms-qna P3, 30-09-26).
//
// The URL is built from `location`, so the same code works through BOTH doors: wss:// behind the
// public nginx (https), ws:// on the VPN door (http, :8767 direct to uvicorn).
//
// Close codes (backend addons/rooms.py): 4403 origin/session -> sign-in prompt · 4404 unknown room
// -> "Room ended" (also what a server restart looks like) · 4429 a cap is full · 1011 account store
// down. Anything else (a network drop, 1006) reconnects with backoff, 3 tries, then gives up.
//
// ⛔ Identity is the SESSION's. `join` carries nothing — the server ignores its content.
import { useCallback, useEffect, useRef, useState } from 'react';

export interface LobbyPlayer { name: string; online: boolean }
export interface BoardRow { name: string; score: number; rank: number }
export interface PerQuestionRow { name: string; points: number; answered: boolean; score: number }

export type RoomFrame =
  | { type: 'lobby'; code: string; owner: string; qCount: number; secs: number; mode?: 'speed' | 'accuracy'; state: string; players: LobbyPlayer[] }
  | { type: 'question'; qIdx: number; total: number; question: string; options: string[]; secs: number; deadline: number }
  | { type: 'answered'; qIdx: number }
  | { type: 'reveal'; qIdx: number; total: number; correct: number; explanations: string[]; perQuestionBoard: PerQuestionRow[]; board: BoardRow[] }
  | { type: 'final'; podium: BoardRow[]; board: BoardRow[] }
  | { type: 'ended'; reason: string }
  | { type: 'ping' };

export type SocketStatus = 'connecting' | 'open' | 'reconnecting' | 'ended' | 'signin' | 'full' | 'unavailable' | 'lost';

export interface RoomState {
  status: SocketStatus;
  lobby: Extract<RoomFrame, { type: 'lobby' }> | null;
  question: Extract<RoomFrame, { type: 'question' }> | null;
  answeredQ: number | null;
  reveal: Extract<RoomFrame, { type: 'reveal' }> | null;
  final: Extract<RoomFrame, { type: 'final' }> | null;
  endedReason: string | null;
}

const EMPTY: RoomState = { status: 'connecting', lobby: null, question: null, answeredQ: null, reveal: null, final: null, endedReason: null };
const MAX_TRIES = 3;
const BACKOFF_MS = [1000, 2000, 4000];

export function roomSocketUrl(code: string): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}/api/rooms/${encodeURIComponent(code)}/ws`;
}

/** `attempt` re-opens the socket ("Try again" after the 3 automatic tries are spent). */
export function useRoomSocket(code: string | null, attempt = 0) {
  const [state, setState] = useState<RoomState>(EMPTY);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!code) {
      setState(EMPTY);
      return undefined;
    }
    let stopped = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState(EMPTY);

    const connect = () => {
      const ws = new WebSocket(roomSocketUrl(code));
      socketRef.current = ws;
      ws.onopen = () => {
        tries = 0;
        setState((s) => ({ ...s, status: 'open' }));
        ws.send(JSON.stringify({ type: 'join' }));
      };
      ws.onmessage = (event) => {
        let frame: RoomFrame;
        try {
          frame = JSON.parse(String(event.data)) as RoomFrame;
        } catch {
          return;
        }
        if (frame.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }
        setState((s) => {
          switch (frame.type) {
            case 'lobby':
              return { ...s, lobby: frame };
            case 'question':
              return { ...s, question: frame, reveal: s.reveal && s.reveal.qIdx === frame.qIdx ? s.reveal : null, answeredQ: s.answeredQ === frame.qIdx ? s.answeredQ : null, final: null };
            case 'answered':
              return { ...s, answeredQ: frame.qIdx };
            case 'reveal':
              return { ...s, reveal: frame };
            case 'final':
              return { ...s, final: frame };
            case 'ended':
              return { ...s, status: 'ended', endedReason: frame.reason };
            default:
              return s;
          }
        });
        if (frame.type === 'ended') stopped = true;
      };
      ws.onclose = (event) => {
        if (socketRef.current === ws) socketRef.current = null;
        if (stopped) {
          setState((s) => (s.status === 'ended' ? s : { ...s, status: 'ended' }));
          return;
        }
        if (event.code === 4404) { stopped = true; setState((s) => ({ ...s, status: 'ended', endedReason: s.endedReason ?? 'gone' })); return; }
        if (event.code === 4403) { stopped = true; setState((s) => ({ ...s, status: 'signin' })); return; }
        if (event.code === 4429) { stopped = true; setState((s) => ({ ...s, status: 'full' })); return; }
        if (event.code === 1011) { stopped = true; setState((s) => ({ ...s, status: 'unavailable' })); return; }
        if (tries >= MAX_TRIES) { stopped = true; setState((s) => ({ ...s, status: 'lost' })); return; }
        const wait = BACKOFF_MS[tries] ?? 4000;
        tries += 1;
        setState((s) => ({ ...s, status: 'reconnecting' }));
        timer = setTimeout(connect, wait);
      };
    };
    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      const ws = socketRef.current;
      socketRef.current = null;
      if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000);
    };
  }, [code, attempt]);

  const send = useCallback((message: Record<string, unknown>) => {
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }, []);

  return { state, send };
}
