import * as React from "react";
import { SheetContent } from "@/shared/components/ui/sheet";
import { useSwipeDown } from "@/shared/hooks/useSwipeDown";
import { cn } from "@/shared/lib/utils";

/**
 * The phone's sheet that slides up from the bottom: a slightly darker slate than the page behind it (so it reads as a layer), a grab handle at the top, and a swipe down
 * to hide it. Use it inside a <Sheet> in place of SheetContent on a phone.
 */
export function BottomSheetContent({ onClose, className, children, ...props }: { onClose: () => void } & Omit<React.ComponentPropsWithoutRef<typeof SheetContent>, "side">) {
  const swipe = useSwipeDown(onClose);
  const { style, ...touch } = swipe;
  return (
    <SheetContent side="bottom" {...props} {...touch} style={{ ...style, ...props.style }}
      className={cn("max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-2xl border-t-0 bg-slate-100 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_32px_-8px_rgba(15,23,42,0.35)]", className)}>
      <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-300" aria-hidden="true" data-testid="sheet-handle" />
      {children}
    </SheetContent>
  );
}
