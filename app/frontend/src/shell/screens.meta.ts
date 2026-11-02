// ADD-ON SCREEN REGISTRY — metadata only (study-rooms-qna P1, 29-09-26).
//
// ⛔ ADD-ON SCREENS ONLY. The 8 core screens (library, welcome, reader, quiz-setup, quiz,
//    result, settings, account), their 3 containers (#landing-dashboard, #content-section,
//    the z-[60] overlay), pop-up screens and class strings are deliberately NOT here and
//    never move here (user decision D1). Nothing about a core screen is derived from this file.
//
// ⛔ PURE DATA — NO COMPONENT IMPORTS. routing/paths.ts and data/writes.ts read this file;
//    importing a screen component here would close an import cycle through them. The
//    components live in shell/screens.tsx, keyed by the same ids.
//
// Adding an add-on screen = its own folder + ONE entry here + ONE entry in screens.tsx
// (+ one backend ADDON_ROUTERS line). With the list empty (P1) every derived type below is
// `never`, so every union widened with it is unchanged and every branch is dead code.

export interface AddonMeta {
  /** Stable screen id; also the NavTab / ScreenName value. */
  readonly id: string;
  /** Header button id. Must match `nav-*`. */
  readonly navId: `nav-${string}`;
  /** Header label, as rendered (the core tabs are upper-case literals). */
  readonly label: string;
  /** ONE path segment, e.g. 'qna' for /qna. Reserved against book slugs. */
  readonly segment: string;
  /** DOM id of the screen wrapper. Must end `-screen`. */
  readonly domId: `${string}-screen`;
  /** POST routes this screen sends through data/writes.ts:postJson. */
  readonly writeRoutes: ReadonlyArray<string>;
}

export const ADDON_META = [
  // P2 (29-09-26): Q&A examiner.
  { id: 'qna', navId: 'nav-qna', label: 'Q&A', segment: 'qna', domId: 'qna-screen', writeRoutes: ['/api/qna/question', '/api/qna/grade', '/api/qna/ask', '/api/qna/hint'] },
  // P3 (30-09-26): live quiz rooms (WebSocket /api/rooms/{code}/ws; the socket is not a write route).
  { id: 'live', navId: 'nav-live', label: 'LIVE', segment: 'live', domId: 'live-screen', writeRoutes: ['/api/rooms'] },
] as const satisfies ReadonlyArray<AddonMeta>;

type AddonEntry = (typeof ADDON_META)[number];
export type AddonId = AddonEntry['id'];
export type AddonWriteRoute = AddonEntry['writeRoutes'][number];

/** The same list, widened for ITERATION. With ADDON_META empty its element type is `never`, so
 *  `.map` bodies over it cannot read a property; render loops use this and cast `id` to AddonId. */
export const ADDON_LIST: ReadonlyArray<AddonMeta> = ADDON_META;
const ALL = ADDON_LIST;

export const ADDON_SEGMENTS: ReadonlySet<string> = new Set(ALL.map((m) => m.segment));

export function isAddonId(x: unknown): x is AddonId {
  return typeof x === 'string' && ALL.some((m) => m.id === x);
}

export function addonBySegment(seg: string): AddonMeta {
  const hit = ALL.find((m) => m.segment === seg);
  if (!hit) throw new Error(`unknown add-on segment: ${seg}`);
  return hit;
}

export function addonById(id: AddonId): AddonMeta {
  const hit = ALL.find((m) => m.id === id);
  if (!hit) throw new Error(`unknown add-on id: ${String(id)}`);
  return hit;
}
