// localStorage can throw (private mode, quota, disabled storage). Lab must keep working
// without it — every access goes through these three and never lets an error escape.
export function readStore(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStore(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the edit simply is not remembered */
  }
}

export function removeStore(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* nothing to do */
  }
}

/** Edited code for one lesson. Removed again by "Reset". */
export const codeKey = (book: string, lesson: string) => `lab:code:${book}:${lesson}`;
