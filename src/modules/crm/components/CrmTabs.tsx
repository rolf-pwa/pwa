import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/shared/lib/utils";

const TABS = [
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

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
      {TABS.map((tab) => {
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
