import { useEffect, useRef } from "react";

/**
 * Runs `reset` when the dependencies change, but not on the first render: the form already starts from the right values. Resetting on mount raced with the first
 * thing the user typed (a late effect would put the old values back over it).
 */
export function useResetOnChange(reset: () => void, deps: unknown[]) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
