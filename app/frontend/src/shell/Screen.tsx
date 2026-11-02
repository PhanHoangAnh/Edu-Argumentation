// Seam 9 (shell), part 1 — THE SCREEN PRIMITIVE.
//
// ⛔⛔ SCREENS STAY **MOUNTED**. Hiding is `.hidden-view` (display:none), never
//     unmounting, never `{visible && <Screen/>}`. Conditional rendering is the obvious
//     React move here and it breaks THREE things at once:
//       1. `[id$="-screen"]` in the frozen DOM contract empties out;
//       2. gates/b15probe.mjs reads `visibleScreens` by enumerating those ids;
//       3. B6 — `#action-container` is fixed-position INSIDE `#quiz-screen`, and
//          `position:fixed` escapes layout but NOT `display:none`. Unmount the screen
//          and the action bar stops hiding with it.
//
// ⛔ A ref callback on a screen NEVER re-fires, because the element is never unmounted.
//    Anything that must run when a screen becomes visible keys on visibility — see
//    ReaderScreen's scroll reset (B7).
import type { ReactNode } from 'react';

export interface ScreenProps {
  /** MUST end in `-screen`. The contract selector is `[id$="-screen"]`. */
  id: string;
  visible: boolean;
  className?: string;
  /** Optional: a screen may be a shell A3 has not filled yet. */
  children?: ReactNode;
}

export function Screen({ id, visible, className, children }: ScreenProps) {
  const classes = [className, visible ? null : 'hidden-view'].filter(Boolean).join(' ');
  return (
    <section id={id} className={classes || undefined}>
      {children}
    </section>
  );
}
