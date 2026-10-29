import { useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Bot, ChevronLeft, Menu, MessageSquare, Sparkles, Users } from "lucide-react";
import { NotificationBell } from "@/shared/components/NotificationBell";
import { setAppBadge } from "@/shared/lib/push";
import { useAttentionCounts } from "@/shared/hooks/useAttentionCounts";
import { useKeyboardViewport } from "@/shared/hooks/useKeyboardViewport";
import { cn } from "@/shared/lib/utils";

/** The five places on the phone's bottom bar. A page under one of them lights its tab; any other page lights More. */
export const MOBILE_TABS = [
  { key: "today", label: "Today", to: "/briefing", icon: Sparkles, under: ["/briefing"] },
  // Messages opens the same list as Today's Messages tile, sliding up from the bottom; the full inbox is one tap inside it.
  { key: "messages", label: "Messages", to: "/briefing?tab=messages", icon: MessageSquare, under: ["/inbox"] },
  { key: "clients", label: "Clients", to: "/contacts", icon: Users, under: ["/contacts", "/households", "/families", "/corporations", "/properties", "/former-clients"] },
  { key: "georgia", label: "Georgia", to: "/georgia", icon: Bot, under: ["/georgia"] },
  { key: "more", label: "More", to: "/more", icon: Menu, under: ["/more"] },
] as const;

const underPath = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + "/");
/** Which tab a page belongs to: its own, or More. */
export const tabFor = (pathname: string, search = ""): (typeof MOBILE_TABS)[number]["key"] => {
  if (pathname === "/briefing") return new URLSearchParams(search).get("tab") === "messages" ? "messages" : "today";
  return MOBILE_TABS.find((t) => t.under.some((p) => underPath(pathname, p)))?.key ?? "more";
};
/** A tab's own front page has no Back arrow; anything deeper does. */
export const isTabRoot = (pathname: string) => MOBILE_TABS.some((t) => t.to.split("?")[0] === pathname);
const TITLE: Record<string, string> = { "/briefing": "Today", "/inbox": "Messages", "/contacts": "Clients", "/georgia": "Georgia", "/more": "More" };

/**
 * The advisor app on a phone: a slim navy bar on top (Back on inner pages), the page in the middle, and a bottom tab bar, with the notch and home bar kept clear.
 * It replaces the desktop sidebar and header below the tablet breakpoint.
 */
export function MobileShell({ children }: { children: React.ReactNode }) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { inbox, requests, alerts } = useAttentionCounts();
  const iconBadge = (inbox ?? 0) + (alerts ?? 0);
  useEffect(() => { if (inbox !== null && alerts !== null) setAppBadge(iconBadge); }, [inbox, alerts, iconBadge]);
  const active = tabFor(pathname, search);
  const root = isTabRoot(pathname);
  // The chat is the one page that fills the screen: no padding, and it scrolls inside itself. With the keyboard up the shell is as tall as what shows, and the bottom bar steps aside.
  const chat = pathname === "/georgia";
  const { height, keyboardOpen } = useKeyboardViewport();
  // iOS colours the status bar from the page's own background, not from our top bar, so while the phone shell is showing the page behind everything is navy (the shell
  // paints its own light background over it). Only while it is showing: other pages, and the client portals, keep theirs.
  useEffect(() => { document.documentElement.classList.add("advisor-shell"); return () => document.documentElement.classList.remove("advisor-shell"); }, []);
  const badge = (key: string): number => (key === "messages" ? inbox ?? 0 : key === "today" ? requests ?? 0 : 0);

  return (
    <div className="advisor-app flex h-[100dvh] flex-col overflow-hidden bg-background" style={keyboardOpen && height ? { height } : undefined} data-testid="mobile-shell">
      <header className="sticky top-0 z-30 shrink-0 bg-[#0a192f] pt-[env(safe-area-inset-top)] text-white" data-testid="mobile-top-bar">
        <div className="flex h-12 items-center gap-1 px-2">
          {root ? <span className="px-2 font-serif text-lg font-semibold tracking-tight">{TITLE[pathname]}</span> : (
            <button type="button" onClick={() => navigate(-1)} aria-label="Back" className="flex h-11 items-center gap-0.5 rounded-md pl-1 pr-3 text-sm font-medium active:bg-white/10"><ChevronLeft className="h-6 w-6" />Back</button>
          )}
          <span className="flex-1" />
          <div className="text-white [&_button]:text-white"><NotificationBell /></div>
        </div>
      </header>

      <main className={chat ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4"} data-testid="mobile-main">{children}</main>

      {!keyboardOpen && <nav className="shrink-0 border-t bg-card pb-[env(safe-area-inset-bottom)]" aria-label="Main" data-testid="mobile-tabs">
        <ul className="grid grid-cols-5">
          {MOBILE_TABS.map(({ key, label, to, icon: Icon }) => {
            const on = active === key, n = badge(key);
            return (
              <li key={key}>
                <Link to={to} aria-label={label} aria-current={on ? "page" : undefined} data-testid={`tab-${key}`} className={cn("relative flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors active:bg-muted", on ? "text-accent" : "text-muted-foreground")}>
                  <Icon className="h-6 w-6" strokeWidth={on ? 2.4 : 1.8} />{label}
                  {n > 0 && <span className="absolute right-[calc(50%-1.4rem)] top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 font-mono text-[10px] font-semibold text-white" data-testid={`badge-${key}`}>{n > 99 ? "99+" : n}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>}
    </div>
  );
}
