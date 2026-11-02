import { readStore, writeStore } from './storage';

// Plan D6: side-by-side <-> stacked, and where the three selectors sit. Remembered in localStorage.
// ⚑ 25-09-26 (user): the Both / Code only / Result only switch was removed — both panels always show.
export type Arrangement = 'side' | 'stacked';
/** 'top' = one short row of three dropdowns above the workspace; 'sidebar' = a left column. */
export type SelectorPlace = 'top' | 'sidebar';
export interface Layout {
  arrangement: Arrangement;
  selector: SelectorPlace;
}

const KEY = 'lab:layout';
export const DEFAULT_LAYOUT: Layout = { arrangement: 'side', selector: 'top' };

export function loadLayout(): Layout {
  const raw = readStore(KEY);
  if (!raw) return DEFAULT_LAYOUT;
  try {
    const parsed = JSON.parse(raw) as Partial<Layout>;
    return {
      arrangement: parsed.arrangement === 'stacked' ? 'stacked' : 'side',
      selector: parsed.selector === 'sidebar' ? 'sidebar' : 'top',
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function saveLayout(layout: Layout): void {
  writeStore(KEY, JSON.stringify(layout));
}
