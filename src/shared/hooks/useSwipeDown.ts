import { useRef, useState } from "react";

/**
 * Swipe a bottom sheet down to hide it. Put the handlers on the sheet itself: a downward drag follows the finger, and letting go past the distance (or after a quick flick)
 * calls `onClose`; otherwise it springs back. A drag only starts when the sheet's own scrolling is at the top, so scrolling a long list is never mistaken for it.
 */
export function useSwipeDown(onClose: () => void, distance = 90) {
  const start = useRef<{ y: number; t: number } | null>(null);
  const [dy, setDy] = useState(0);
  const [dragging, setDragging] = useState(false);

  const onTouchStart = (e: React.TouchEvent<HTMLElement>) => {
    if (e.currentTarget.scrollTop > 0) { start.current = null; return; }
    start.current = { y: e.touches[0].clientY, t: Date.now() };
  };
  const onTouchMove = (e: React.TouchEvent<HTMLElement>) => {
    if (!start.current) return;
    const d = e.touches[0].clientY - start.current.y;
    if (d <= 0 || e.currentTarget.scrollTop > 0) { if (dy) setDy(0); setDragging(false); return; }
    setDragging(true); setDy(d);
  };
  const onTouchEnd = () => {
    const s = start.current;
    start.current = null;
    const flick = !!s && Date.now() - s.t < 250 && dy > 40;
    const close = dy > distance || flick;
    setDy(0); setDragging(false);
    if (close) onClose();
  };
  // `translate` is its own CSS property, so following the finger does not fight the slide-in and slide-out animations (which use `transform`).
  const style: React.CSSProperties = { translate: dy ? `0 ${dy}px` : undefined, transition: dragging ? "none" : "translate 200ms ease-out" };
  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd, style };
}
