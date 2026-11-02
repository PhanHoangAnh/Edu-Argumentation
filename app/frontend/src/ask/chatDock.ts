// ⚑ 22-10-26 (user): "allow the chatbot to open in the side, which will replace the lab."
//
// One tiny store shared by AskPanel (AppShell) and ReaderScreen, because they are not parent and
// child. It holds two things:
//   · mode  'popup' | 'side'   — remembered per viewer in localStorage (try/catch; works without).
//   · slot  the element ReaderScreen's side dock offers; AskPanel portals its panel into it.
// While mode === 'side' the Lab cannot open (ReaderScreen disables its button and `]`).
import { useSyncExternalStore } from 'react';

const MODE_KEY = 'reader:askMode';
export type ChatMode = 'popup' | 'side';

function storedMode(): ChatMode {
  try {
    return window.localStorage.getItem(MODE_KEY) === 'side' ? 'side' : 'popup';
  } catch {
    return 'popup';
  }
}

let state: { mode: ChatMode; slot: HTMLElement | null } = { mode: storedMode(), slot: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function setChatMode(mode: ChatMode): void {
  if (state.mode === mode) return;
  state = { ...state, mode };
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* not remembered — fine */
  }
  emit();
}

/** ReaderScreen's side dock calls this with its slot element (and null when it goes away). */
export function setChatSlot(slot: HTMLElement | null): void {
  if (state.slot === slot) return;
  state = { ...state, slot };
  emit();
}

export function useChatDock() {
  return useSyncExternalStore(subscribe, () => state);
}
