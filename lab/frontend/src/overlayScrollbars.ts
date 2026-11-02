/**
 * OVERLAY SCROLLBARS, APP-WIDE — ported 25-09-26 (user) from the CoreX console
 * (platform/console/frontend/src/lib/overlayScrollbars.ts). No library: CSS + this listener.
 *
 * The thumb is INVISIBLE at rest. It fades in (brand red; grey on code) PER AXIS:
 *   · while that axis is being scrolled          -> .is-scrolling-y / .is-scrolling-x
 *   · while the pointer is over that bar's strip -> .is-scroll-hover-y / .is-scroll-hover-x
 *     (the right-edge strip for the vertical bar, the bottom-edge strip for the horizontal one)
 * ⚑ 25-09-26 (user): hovering INSIDE a panel must not light its bars — only the bar's own position
 *   does, and a panel that scrolls both ways (the Lab editor) shows only the axis in use.
 * The stylesheet reacts to these classes only (`::-webkit-scrollbar-thumb:vertical|:horizontal`).
 * Only the thumb's COLOUR changes, so revealing a bar never shifts layout.
 * Same code in: app/frontend, lab/frontend (TS) and doc-importer/static/js (plain JS).
 */
const IDLE_MS = 800;
const EDGE_PX = 14; // how close to the right/bottom edge counts as "on the scrollbar"

function scrollAxes(el: Element): { y: boolean; x: boolean } {
  if (!(el instanceof HTMLElement)) return { y: false, x: false };
  const cs = getComputedStyle(el);
  return {
    y: (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight,
    x: (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth,
  };
}

let installed = false;

export function initOverlayScrollbars(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const idleTimers = new WeakMap<HTMLElement, number>();
  const lastPos = new WeakMap<HTMLElement, [number, number]>();
  let hovered: HTMLElement | null = null;

  // `scroll` does not bubble: a CAPTURE listener sees every container. The axis is whichever
  // offset changed since the last event.
  document.addEventListener(
    'scroll',
    (event) => {
      const target = event.target;
      const el =
        target === document || target === document.documentElement
          ? (document.scrollingElement as HTMLElement | null)
          : (target as HTMLElement | null);
      if (!(el instanceof HTMLElement)) return;
      const [top, left] = lastPos.get(el) ?? [el.scrollTop, el.scrollLeft];
      lastPos.set(el, [el.scrollTop, el.scrollLeft]);
      const movedX = el.scrollLeft !== left;
      const movedY = el.scrollTop !== top || !movedX;
      if (movedY) el.classList.add('is-scrolling-y');
      if (movedX) el.classList.add('is-scrolling-x');
      const previous = idleTimers.get(el);
      if (previous !== undefined) window.clearTimeout(previous);
      idleTimers.set(
        el,
        window.setTimeout(() => {
          el.classList.remove('is-scrolling-y', 'is-scrolling-x');
          idleTimers.delete(el);
        }, IDLE_MS),
      );
    },
    { capture: true, passive: true },
  );

  const clearHover = () => {
    hovered?.classList.remove('is-scroll-hover-y', 'is-scroll-hover-x');
    hovered = null;
  };

  // The nearest scrollable ancestor under the pointer, and only when the pointer is on ITS bar strip.
  document.addEventListener(
    'pointermove',
    (event) => {
      let node = event.target as Element | null;
      while (node && node !== document.documentElement) {
        const axes = scrollAxes(node);
        if (axes.y || axes.x) {
          const box = node.getBoundingClientRect();
          const onY = axes.y && event.clientX >= box.right - EDGE_PX && event.clientX <= box.right;
          const onX = axes.x && event.clientY >= box.bottom - EDGE_PX && event.clientY <= box.bottom;
          const el = node as HTMLElement;
          // Seed the scroll position so the FIRST scroll of this box knows its axis.
          if (!lastPos.has(el)) lastPos.set(el, [el.scrollTop, el.scrollLeft]);
          if (hovered && hovered !== el) clearHover();
          el.classList.toggle('is-scroll-hover-y', onY);
          el.classList.toggle('is-scroll-hover-x', onX);
          hovered = onY || onX ? el : null;
          return;
        }
        node = node.parentElement;
      }
      clearHover();
    },
    { capture: true, passive: true },
  );

  document.addEventListener('pointerleave', clearHover, { capture: true, passive: true });
}
