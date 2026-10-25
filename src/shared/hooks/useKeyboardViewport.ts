import { useEffect, useState } from "react";

/** The part of the screen that is really visible, and whether the on-screen keyboard is up. iOS does not shrink the page for the keyboard, so a page pinned to the bottom is hidden by it. */
export function keyboardIsOpen(layoutHeight: number, visibleHeight: number): boolean { return layoutHeight - visibleHeight > 120; }

export function useKeyboardViewport(): { height: number | null; keyboardOpen: boolean } {
  const [state, setState] = useState<{ height: number | null; keyboardOpen: boolean }>({ height: null, keyboardOpen: false });
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const update = () => {
      const open = keyboardIsOpen(window.innerHeight, vv.height);
      setState((s) => (s.height === vv.height && s.keyboardOpen === open ? s : { height: vv.height, keyboardOpen: open }));
      if (open) window.scrollTo(0, 0); // iOS slides the whole page up to show the field; the shell is already sized to what is visible
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => { vv.removeEventListener("resize", update); vv.removeEventListener("scroll", update); };
  }, []);
  return state;
}
