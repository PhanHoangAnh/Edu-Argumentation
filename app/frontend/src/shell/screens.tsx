// ADD-ON SCREEN REGISTRY — components (study-rooms-qna P1, 29-09-26).
//
// ⛔ ADD-ON SCREENS ONLY — see screens.meta.ts. Core screens are not registered here (D1).
// One entry per ADDON_META id. P2: qna. P3: live.
import type { ComponentType } from 'react';
import type { AddonId } from './screens.meta';
import { QnaScreen } from '../qna/QnaScreen';
import { LiveScreen } from '../live/LiveScreen';

export const ADDON_SCREENS: Record<AddonId, ComponentType<{ open: boolean }>> = {
  qna: QnaScreen,   // P2 (29-09-26)
  live: LiveScreen, // P3 (30-09-26)
};

/** Wrapper class for every add-on <Screen>. LITERAL (Tailwind purge) — the Settings/Account frame. */
export const ADDON_SCREEN_CLASS = 'w-full max-w-5xl mx-auto space-y-6';
