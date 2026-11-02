// Seam 8c (routing/paths) — READABLE PATHS. Phase 06a, ruling R25 (23-09-26).
//
// The user: "can you make it to /name_of_the_book/chapter or part or any separator/which block".
// The grammar, agreed:
//     /                                          the library (home)
//     /<book>/                                   one book's landing
//     /<book>/<unit>-<n>/                        chapter n, first lesson
//     /<book>/<unit>-<n>/<m>-<title-slug>        chapter n, lesson m
//     /<book>/<unit>-<n>/<m>-<title-slug>/quiz   that lesson's assessment
//     /account · /settings · /login
//
// ⛔ THE NUMBERS RESOLVE, THE WORDS ARE COSMETIC. `<unit>` and `<title-slug>` are read back for
//    nothing — a stale or mistyped slug still opens lesson m of chapter n, and the app then REPLACES
//    the URL with the canonical one. A lesson retitled next month therefore never breaks a bookmark.
// ⛔ BOOK SLUGS ARE A FIXED MAP, and the internal module ids are UNCHANGED: progress is keyed by
//    module id (and positional block id, ch01-b03), so renaming a URL must never move progress.
//    A book not in the map gets a slug derived from its file name.
// ⛔ NO ROUTER LIBRARY — same reasoning as the hash era (A3d): pushState + popstate + a parser.
// ⚠ THE OLD `#chapter=N&block=N` LINKS still work: they are rewritten to the path of the default
//   book on load (legacyHashCursor below). The server never sees a hash, so this is client-side.

import type { TheoryCursor } from '../data/types';
import { ADDON_SEGMENTS, addonBySegment } from '../shell/screens.meta';
import type { AddonId } from '../shell/screens.meta';

/** book file (packaged folder name, or legacy data/*.json name) -> URL slug. Short, readable, STABLE. */
export const BOOK_SLUGS: Readonly<Record<string, string>> = {
  'geron-homl3': 'geron-homl3',
  'openintro-statistics-2019-1045f2f5': 'openintro-stats',
  'Deployment-MLOps.json': 'mlops-deployment',
  'SageMakerClarifyBiasMastery.json': 'sagemaker-bias-mastery',
  'SageMaker_Clarify.json': 'sagemaker-clarify',
};

/** Paths that are app screens, never a book slug. */
const RESERVED = new Set(['account', 'settings', 'login', 'api', 'book', 'data', 'assets', 'favicon.svg', 'lab', ...ADDON_SEGMENTS]);  // 'lab': the Lab add-on at /lab/ (R27, 24-09-26) · add-on segments (study-rooms-qna P1): a book slug can never shadow an add-on

export function slugify(text: string, max = 60): string {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

export function slugForBook(file: string): string {
  return BOOK_SLUGS[file] ?? (slugify(file.replace(/\.json$/i, ''), 64) || 'book');
}

/** Resolve a slug against the known files (the fixed map first, then derived slugs). */
export function fileForSlug(slug: string, knownFiles: readonly string[] = []): string | null {
  for (const [file, s] of Object.entries(BOOK_SLUGS)) if (s === slug) return file;
  for (const file of knownFiles) if (slugForBook(file) === slug) return file;
  return null;
}

/**
 * The unit word, from the book's OWN structure: "Chapter 1: …" -> chapter, "Part 2 …" -> part.
 * Sections titled "1. Something" carry no word, so they are "section". Géron -> chapter.
 */
export function unitWordFor(firstSectionTitle: string | undefined): string {
  const match = /^\s*(chapter|part|unit|module|domain|section|lesson|week)\b/i.exec(firstSectionTitle || '');
  return match ? match[1].toLowerCase() : 'section';
}

export type Route =
  | { kind: 'library' }
  | { kind: 'book'; slug: string }
  | { kind: 'lesson'; slug: string; chapter: number; lesson: number | null; quiz: boolean }
  | { kind: 'account' }
  | { kind: 'settings' }
  | { kind: 'addon'; id: AddonId }
  | { kind: 'login' }
  | { kind: 'unknown'; path: string };

/** Parse a pathname. Numbers are 1-based in the URL. */
export function parseRoute(pathname: string = window.location.pathname): Route {
  const parts = pathname.split('/').filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  if (!parts.length) return { kind: 'library' };
  const [head, unit, lesson, tail, ...rest] = parts;
  if (parts.length === 1 && head === 'account') return { kind: 'account' };
  if (parts.length === 1 && head === 'settings') return { kind: 'settings' };
  if (parts.length === 1 && ADDON_SEGMENTS.has(head)) return { kind: 'addon', id: addonBySegment(head).id as AddonId };
  if (parts.length === 1 && head === 'login') return { kind: 'login' };
  if (RESERVED.has(head)) return { kind: 'unknown', path: pathname };
  if (parts.length === 1) return { kind: 'book', slug: head };
  const unitMatch = /^(?:[a-z]+-)?(\d{1,3})$/i.exec(unit);
  if (!unitMatch || rest.length) return { kind: 'unknown', path: pathname };
  const chapter = Number(unitMatch[1]);
  if (lesson === undefined) return { kind: 'lesson', slug: head, chapter, lesson: null, quiz: false };
  const lessonMatch = /^(\d{1,3})(?:-.*)?$/.exec(lesson);
  if (!lessonMatch) return { kind: 'unknown', path: pathname };
  if (tail !== undefined && tail !== 'quiz') return { kind: 'unknown', path: pathname };
  return { kind: 'lesson', slug: head, chapter, lesson: Number(lessonMatch[1]), quiz: tail === 'quiz' };
}

export interface LessonNames {
  unitWord: string;
  lessonTitle: (cursor: TheoryCursor) => string;
}

export function bookPath(file: string): string {
  return `/${slugForBook(file)}/`;
}

export function chapterPath(file: string, chapterIndex: number, names: LessonNames): string {
  return `/${slugForBook(file)}/${names.unitWord}-${chapterIndex + 1}/`;
}

export function lessonPath(file: string, cursor: TheoryCursor, names: LessonNames, quiz = false): string {
  const title = slugify(names.lessonTitle(cursor));
  const lesson = `${cursor.blockIndex + 1}${title ? `-${title}` : ''}`;
  return `/${slugForBook(file)}/${names.unitWord}-${cursor.chapterIndex + 1}/${lesson}${quiz ? '/quiz' : ''}`;
}

/** The cursor a lesson route points at (0-based). A chapter-only route means its first lesson. */
export function cursorForRoute(route: Route): TheoryCursor | null {
  if (route.kind !== 'lesson') return null;
  return { chapterIndex: Math.max(route.chapter, 1) - 1, blockIndex: Math.max(route.lesson ?? 1, 1) - 1 };
}

/** `#chapter=N&block=N` — the hash form every earlier version of the app wrote. */
export function legacyHashCursor(hash: string = window.location.hash): TheoryCursor | null {
  if (!/(^#|&)(chapter|block)=/.test(hash)) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const chapter = Number(params.get('chapter'));
  const block = Number(params.get('block'));
  if (!(chapter > 0)) return null;
  return { chapterIndex: chapter - 1, blockIndex: (block > 0 ? block : 1) - 1 };
}

/** Same place, ignoring the cosmetic words — decides replaceState (canonicalise) vs pushState. */
export function sameRoute(a: Route, b: Route): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'book' && b.kind === 'book') return a.slug === b.slug;
  if (a.kind === 'addon' && b.kind === 'addon') return a.id === b.id;
  if (a.kind === 'lesson' && b.kind === 'lesson') {
    return a.slug === b.slug && a.chapter === b.chapter && (a.lesson ?? 1) === (b.lesson ?? 1) && a.quiz === b.quiz;
  }
  return true;
}
