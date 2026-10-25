import { useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Check, ChevronDown } from "lucide-react";
import { Sheet, SheetHeader, SheetTitle } from "@/shared/components/ui/sheet";
import { BottomSheetContent } from "@/shared/components/BottomSheet";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import { cn } from "@/shared/lib/utils";

const FORMER = "Former clients";
export const CRM_TABS = [
  { label: "Individuals", to: "/contacts" },
  { label: "Households", to: "/households" },
  { label: "Corporate Holdings", to: "/corporations" },
  { label: "Families", to: "/families" },
  { label: "Pros", to: "/professionals" },
  { label: "Leads", to: "/leads" },
  { label: "General / Vendors", to: "/contacts?view=general" },
];

export function CrmTabs() {
  const { pathname, search } = useLocation();
  const current = `${pathname}${search.includes("view=general") ? "?view=general" : ""}`;

  const isActive = (to: string) => {
    if (to === "/contacts") {
      return pathname === "/contacts" && !search.includes("view=general");
    }
    if (to === "/contacts?view=general") {
      return pathname === "/contacts" && search.includes("view=general");
    }
    return pathname.startsWith(to);
  };

  const phone = useIsMobile();
  const [open, setOpen] = useState(false);
  if (phone) {
    // One button naming where you are; it opens the other sections from the bottom, instead of a strip of tabs to scroll.
    const here = isActive_(CRM_TABS, isActive)?.label ?? (pathname.startsWith("/former-clients") ? FORMER : "CRM");
    const items = [...CRM_TABS.map((t) => ({ label: t.label, to: t.to, on: isActive(t.to) })), { label: FORMER, to: "/former-clients", on: pathname.startsWith("/former-clients") }];
    return (
      <>
        <button type="button" onClick={() => setOpen(true)} data-testid="crm-section-button" className="flex min-h-11 items-center gap-2 rounded-xl border bg-card px-4 text-sm font-semibold active:bg-muted">{here}<ChevronDown className="h-4 w-4 text-muted-foreground" /></button>
        <Sheet open={open} onOpenChange={setOpen}>
          <BottomSheetContent onClose={() => setOpen(false)} data-testid="crm-sections">
            <SheetHeader><SheetTitle>CRM</SheetTitle></SheetHeader>
            <ul className="mt-3 divide-y overflow-hidden rounded-xl border">
              {items.map((i) => <li key={i.to}><Link to={i.to} onClick={() => setOpen(false)} className={cn("flex min-h-12 items-center justify-between px-4 text-sm active:bg-muted", i.on && "font-semibold text-accent")}>{i.label}{i.on && <Check className="h-4 w-4" />}</Link></li>)}
            </ul>
          </BottomSheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
      {CRM_TABS.map((tab) => {
        const active = isActive(tab.to);
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={cn(
              "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </NavLink>
        );
      })}
      <NavLink to="/former-clients" className={cn("ml-2 px-2 py-1.5 text-xs transition-colors", pathname.startsWith("/former-clients") ? "text-foreground underline" : "text-muted-foreground/70 hover:text-foreground")} data-testid="former-clients-link">Former clients</NavLink>
    </div>
  );
}

function isActive_<T extends { to: string }>(tabs: T[], isActive: (to: string) => boolean): T | undefined { return tabs.find((t) => isActive(t.to)); }
