import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/components/ui/collapsible";

/** A collapsible section for a page's sidebar: a titled bar that opens to show its content. Closed unless defaultOpen. */
export function SidebarSection({ title, meta, children, defaultOpen = false }: { title: string; meta?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border bg-card">
      <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium hover:text-accent">
        <span>{title}</span>
        <span className="flex items-center gap-2">
          {meta !== undefined && <span className="text-xs font-semibold text-muted-foreground">{meta}</span>}
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-2 pb-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}
