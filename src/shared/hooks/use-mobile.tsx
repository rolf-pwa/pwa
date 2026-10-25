import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  // Known from the first render, so a phone never flashes the desktop layout before switching.
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(() => (typeof window === "undefined" ? undefined : window.innerWidth < MOBILE_BREAKPOINT));

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}
