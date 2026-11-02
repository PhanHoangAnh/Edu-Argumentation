// ⚑ 25-09-26 (user): "I just want the learning to open the current exact lab tab and put in the
//   same browser window … a divider to resize is good."
//
// The WHOLE Lab page (its own header, book/chapter/lesson menus, everything) in an <iframe> beside
// the reading pane. Lab stays its own service (ruling R10 — if Lab breaks, reading still works);
// this only frames it. The src is the reader's own relative `/lab/<module>/<lesson>`:
//   · public door  https://<ip>/lab/...  — same origin, nginx proxies /lab/ to Lab;
//   · VPN door     http://<host>:8767/lab/...  — the study app 302s it to :8798 (Lab's direct door).
// Lab allows exactly these two parents to frame it (CSP frame-ancestors, lab_server.py).
//
// ⚑ 25-09-26 (user, second pass): EVERY screen opens Lab in this window — wide screens beside the
//   lesson with a drag divider, phones as a full-screen layer over it. No bar of our own: Lab's
//   header carries the glyphs (close / open in a new tab), which post a message up to us
//   (see labMessages below; ReaderScreen handles them).
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { setChatSlot } from '../ask/chatDock';

const WIDTH_KEY = 'reader:labWidth';
const MIN_LAB = 360;
const MIN_READER = 360;
const SNAP_PX = 12;

function storedWidth(): number | null {
  try {
    const value = Number(window.localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** ⚑ 22-10-26: the side slot, shared by Lab and the docked chat (same width, divider and snap). */
function SideDock({ kind, children }: { kind: 'lab' | 'chat'; children: ReactNode }) {
  const paneRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | null>(storedWidth);
  const [dragging, setDragging] = useState(false);
  // ⚑ 25-09-26 (user): while dragging, a dashed line marks the exact middle of the row; within
  //   SNAP_PX of it the divider snaps to an exact 50/50.
  const [middle, setMiddle] = useState<{ x: number; top: number; height: number } | null>(null);
  const [snapped, setSnapped] = useState(false);

  // First open with no remembered width: half of the row.
  useEffect(() => {
    if (width !== null) return;
    const row = paneRef.current?.parentElement;
    if (row) setWidth(Math.round(row.getBoundingClientRect().width / 2));
  }, [width]);

  const clamp = (value: number) => {
    const row = paneRef.current?.parentElement;
    const total = row ? row.getBoundingClientRect().width : window.innerWidth;
    return Math.max(MIN_LAB, Math.min(value, total - MIN_READER));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const box = paneRef.current?.parentElement?.getBoundingClientRect();
    if (box) setMiddle({ x: box.left + box.width / 2, top: box.top, height: box.height });
    setDragging(true);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const row = paneRef.current?.parentElement;
    if (!row) return;
    const box = row.getBoundingClientRect();
    const half = box.width / 2;
    const near = Math.abs(event.clientX - (box.left + half)) <= SNAP_PX;
    setSnapped(near);
    setWidth(clamp(near ? half : box.right - event.clientX));
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
    setMiddle(null);
    setSnapped(false);
    try {
      if (width) window.localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
    } catch {
      /* not remembered — fine */
    }
  };

  return (
    <>
      <div
        id={`${kind}-dock-divider`}
        role="separator"
        aria-orientation="vertical"
        aria-label={kind === 'lab' ? 'Drag to resize the Lab panel' : 'Drag to resize the chat panel'}
        title="Drag to resize"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // ⚑ 25-09-26 (user): no gap between the lesson and Lab; the lesson keeps ALL its rounded corners
        //   and the panel has no frame of its own (Lab's boxes carry their borders). The divider takes no
        //   room: zero width, -mx-2 cancels the row's gap-2 on both sides, and a 10 px grab strip
        //   sits over the seam (z-20 so it is above both borders).
        className="group hidden lg:block relative shrink-0 w-0 -mx-2 z-20"
      >
        <div
          // ⚑ 25-09-26 (user): the strip lies ENTIRELY on the Lab side of the seam — reaching into the
          //   lesson put it over the lesson's scrollbar, so grabbing the divider scrolled the lesson.
          className={`absolute inset-y-0 left-0 w-[10px] cursor-col-resize flex items-center justify-start`}
        >
          <span
            className={`h-full w-[3px] rounded-full transition-colors ${snapped ? 'bg-white' : dragging ? 'bg-brand-600' : 'bg-transparent group-hover:bg-brand-600'}`}
            aria-hidden="true"
          />
        </div>
      </div>
      {dragging && middle ? (
        <div
          id={`${kind}-dock-middle`}
          aria-hidden="true"
          className={`pointer-events-none fixed z-[60] w-0 border-l-2 border-dashed ${snapped ? 'border-white' : 'border-brand-600/70'}`}
          style={{ left: middle.x - 1, top: middle.top, height: middle.height }}
        />
      ) : null}
      <div
        id={`${kind}-dock`}
        ref={paneRef}
        style={width ? ({ '--lab-dock-w': `${width}px` } as CSSProperties) : undefined}
        className="fixed inset-0 z-50 flex flex-col bg-gray-900 lg:static lg:inset-auto lg:z-auto lg:shrink-0 lg:min-h-0 lg:w-[var(--lab-dock-w,50%)] lg:rounded-xl lg:overflow-hidden"
      >
        {/* While dragging, the iframe would swallow the pointer; a transparent sheet keeps it here. */}
        <div className="relative flex-1 min-h-0">
          {children}
          {dragging ? <div className="absolute inset-0 cursor-col-resize" aria-hidden="true" /> : null}
        </div>
      </div>
    </>
  );
}

export function LabDock({ src }: { src: string }) {
  return (
    <SideDock kind="lab">
      <iframe id="lab-dock-frame" title="Lab" src={src} className="absolute inset-0 w-full h-full border-0 bg-gray-900" />
    </SideDock>
  );
}

/** ⚑ 22-10-26: the tutor chat docked in Lab's slot; AskPanel portals its panel into the slot div. */
export function ChatDock() {
  return (
    <SideDock kind="chat">
      <div ref={setChatSlot} id="chat-dock-slot" className="absolute inset-0 flex flex-col" />
    </SideDock>
  );
}

/** Where Lab can live: this origin (public door, nginx /lab/) or :8798 on this host (VPN door). */
export function labOrigins(): string[] {
  return [window.location.origin, `http://${window.location.hostname}:8798`];
}

/** A Lab href from a message, reduced to the relative `/lab/...` path this app frames; null if foreign. */
export function labPath(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  try {
    const url = new URL(href, window.location.origin);
    if (!labOrigins().includes(url.origin) || !url.pathname.startsWith('/lab/')) return null;
    return url.pathname + url.search;
  } catch {
    return null;
  }
}
