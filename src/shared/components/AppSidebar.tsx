import { Link, useLocation } from "react-router-dom";

import { useAuth } from "@/shared/hooks/useAuth";
import {
  LayoutDashboard,
  Users,
  CheckSquare,
  ShieldCheck,
  ExternalLink,
  ClipboardCheck,
  ClipboardList,
  Calendar,
  Mail,
  FolderOpen,
  PanelLeftClose,
  Megaphone,
  Cpu,
  TrendingUp,
  Receipt,
  ConciergeBell,
  BookOpen,
  Anchor,
  PackagePlus,
  BarChart3,
  Crown,
  Inbox as InboxIcon,
  Briefcase,
  Upload,
  Brain,
  FileSignature,
  ListTodo,
  MoreHorizontal,
  Gauge,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useEffect, useState, createContext, useContext } from "react";
import { supabase } from "@/shared/integrations/supabase/client";
import { withAuthRaceRetry } from "@/shared/lib/authRaceRetry";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/shared/components/ui/tooltip";

// Context for which nav group's panel is showing, and whether it's open at all.
const SidebarNavContext = createContext<{
  selectedGroup: string | null;
  panelOpen: boolean;
  select: (group: string) => void;
}>({
  selectedGroup: null,
  panelOpen: false,
  select: () => {},
});

export function useSidebarNav() {
  return useContext(SidebarNavContext);
}

/** @deprecated Kept only so any stray import doesn't crash; the collapse-boolean model is gone. */
export function useSidebarCollapse() {
  return { collapsed: false, toggle: () => {} };
}

const GROUPS = [
  {
    key: "work",
    label: "Work",
    icon: LayoutDashboard,
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/requests", label: "Client Requests", icon: ClipboardList, badgeKey: "requests" },
      { to: "/inbox", label: "Inbox", icon: InboxIcon, badgeKey: "inbox" },
      { to: "/projects", label: "Projects", icon: ListTodo },
      { to: "/team-capacity", label: "Team Capacity", icon: Gauge },
      { to: "/invoices", label: "Invoices", icon: Receipt },
      { to: "/services", label: "Services", icon: ConciergeBell },
    ],
  },
  {
    key: "people",
    label: "People",
    icon: Users,
    items: [
      { to: "/families", label: "CRM", icon: Users },
      { to: "/pipeline", label: "Pipeline", icon: TrendingUp },
      { to: "/holding-tank", label: "Holding Tank", icon: Anchor },
      { to: "/professionals", label: "Professionals", icon: Briefcase },
    ],
  },
  {
    key: "agents",
    label: "Agents",
    icon: Brain,
    items: [
      { to: "/brain", label: "Second Brain", icon: Brain },
      { to: "/workbench", label: "Workbench", icon: Cpu },
      { to: "/review-queue", label: "Review Queue", icon: ClipboardCheck, badgeKey: "review" },
      { to: "/knowledge-base", label: "Bot Knowledge", icon: BookOpen },
    ],
  },
  {
    key: "strategy",
    label: "Strategy",
    icon: BarChart3,
    items: [
      { to: "/analytics", label: "Analytics", icon: BarChart3 },
      { to: "/marketing-updates", label: "Marketing Updates", icon: Megaphone },
      { to: "/admin/vfo", label: "VFO Roster", icon: Crown },
    ],
  },
  {
    key: "onboarding",
    label: "Onboarding",
    icon: PackagePlus,
    items: [
      { to: "/onboarding", label: "Onboarding", icon: PackagePlus },
      { to: "/importers", label: "Bulk Importers", icon: Upload },
      { to: "/webforms", label: "Web Forms", icon: FileSignature },
    ],
  },
] as const;

const externalLinks = [
  { href: "https://app.asana.com", label: "Asana", icon: CheckSquare },
  { href: "https://iaa.secureweb.inalco.com/MKMWPN23/home", label: "IA Financial", icon: ShieldCheck },
  { href: "https://calendar.google.com", label: "Google Calendar", icon: Calendar },
  { href: "https://mail.google.com", label: "Gmail", icon: Mail },
  { href: "https://drive.google.com", label: "Google Drive", icon: FolderOpen },
];

function isActive(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(to + "/");
}

function groupForPath(pathname: string): string | null {
  for (const group of GROUPS) {
    if (group.items.some((item) => isActive(pathname, item.to))) return group.key;
  }
  return null;
}

export function SidebarCollapseProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [selectedGroup, setSelectedGroup] = useState<string | null>(() => {
    return localStorage.getItem("sidebar-selected-group") || groupForPath(location.pathname) || "work";
  });
  const [panelOpen, setPanelOpen] = useState(() => localStorage.getItem("sidebar-panel-open") !== "false");

  // Auto-follow the route into whichever group actually owns the current page.
  useEffect(() => {
    const owner = groupForPath(location.pathname);
    if (owner && owner !== selectedGroup) setSelectedGroup(owner);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const select = (group: string) => {
    if (group === selectedGroup) {
      setPanelOpen((prev) => {
        const next = !prev;
        localStorage.setItem("sidebar-panel-open", String(next));
        return next;
      });
      return;
    }
    setSelectedGroup(group);
    localStorage.setItem("sidebar-selected-group", group);
    setPanelOpen(true);
    localStorage.setItem("sidebar-panel-open", "true");
  };

  return (
    <SidebarNavContext.Provider value={{ selectedGroup, panelOpen, select }}>{children}</SidebarNavContext.Provider>
  );
}

export function AppSidebar() {
  const { user } = useAuth();
  const location = useLocation();
  const { selectedGroup, panelOpen, select } = useSidebarNav();
  const [pendingReviewCount, setPendingReviewCount] = useState<number | null>(null);
  const [openRequestsCount, setOpenRequestsCount] = useState<number | null>(null);
  const [inboxUnreadCount, setInboxUnreadCount] = useState<number | null>(null);

  useEffect(() => {
    // ProtectedRoute already waits for auth to resolve before this ever
    // mounts, but there's still a brief window right after an OAuth
    // redirect where the Supabase client's session isn't fully settled for
    // outgoing requests yet — see authRaceRetry.ts. Bail out entirely if
    // there's somehow no user yet, and retry once on a transient failure.
    if (!user) return;

    (async () => {
      try {
        const { count } = await withAuthRaceRetry<any>(() =>
          (supabase.from("review_queue" as any) as any)
            .select("id", { count: "exact", head: true })
            .eq("status", "pending")
        );
        setPendingReviewCount(count ?? 0);
      } catch {}
    })();

    (async () => {
      try {
        const { count } = await withAuthRaceRetry<any>(() =>
          (supabase
            .from("portal_requests")
            .select("id", { count: "exact", head: true })
            .in("status", ["submitted", "in_progress"]) as any)
        );
        setOpenRequestsCount(count ?? 0);
      } catch {}
    })();

    const loadInboxUnread = async () => {
      try {
        const { data } = await withAuthRaceRetry(() =>
          supabase.functions.invoke("quo-service", { body: { action: "unreadCount" } })
        );
        setInboxUnreadCount(data?.unread ?? 0);
      } catch {}
    };
    loadInboxUnread();

    const channel = supabase
      .channel("sidebar-quo-unread")
      .on("postgres_changes", { event: "*", schema: "public", table: "quo_messages" }, loadInboxUnread)
      .on("postgres_changes", { event: "*", schema: "public", table: "quo_calls" }, loadInboxUnread)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const badgeFor = (badgeKey: string | undefined): number | null => {
    if (badgeKey === "requests" && openRequestsCount) return openRequestsCount;
    if (badgeKey === "inbox" && inboxUnreadCount) return inboxUnreadCount;
    if (badgeKey === "review" && pendingReviewCount) return pendingReviewCount;
    return null;
  };

  const groupHasBadge = (group: (typeof GROUPS)[number]) =>
    group.items.some((item) => badgeFor((item as any).badgeKey) !== null);

  const activeGroup = GROUPS.find((g) => g.key === selectedGroup) ?? GROUPS[0];

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex h-full">
        {/* Icon rail */}
        <aside className="flex h-full w-[60px] shrink-0 flex-col items-center border-r border-sidebar-border bg-sidebar py-4">
          <nav className="flex flex-1 flex-col items-center gap-1">
            {GROUPS.map((group) => {
              const Icon = group.icon;
              const active = group.key === selectedGroup;
              const hasBadge = groupHasBadge(group);
              return (
                <Tooltip key={group.key}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => select(group.key)}
                      className={cn(
                        "relative flex h-10 w-10 items-center justify-center rounded-md transition-colors",
                        active && panelOpen
                          ? "bg-sidebar-primary/15 text-sidebar-primary"
                          : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      )}
                    >
                      <Icon className="h-5 w-5" />
                      {hasBadge && !(active && panelOpen) && (
                        <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-sidebar-primary" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="font-medium">
                    {group.label}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </nav>

          <div className="mt-auto flex flex-col items-center gap-1 pt-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => select("more")}
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-md transition-colors",
                    selectedGroup === "more" && panelOpen
                      ? "bg-sidebar-primary/15 text-sidebar-primary"
                      : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  <MoreHorizontal className="h-5 w-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="font-medium">
                More
              </TooltipContent>
            </Tooltip>
          </div>
        </aside>

        {/* Group panel */}
        {panelOpen && (
          <aside className="flex h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
            <div className="flex items-center justify-between px-4 pb-3 pt-6">
              <h2 className="font-serif text-lg">{selectedGroup === "more" ? "More" : activeGroup.label}</h2>
              <button
                onClick={() => select(selectedGroup || "work")}
                className="rounded-md p-1 text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>

            <nav className="flex-1 space-y-0.5 overflow-y-auto px-2">
              {selectedGroup === "more"
                ? externalLinks.map(({ href, label, icon: Icon }) => (
                    <a
                      key={href}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {label}
                      <ExternalLink className="ml-auto h-3 w-3 opacity-30" />
                    </a>
                  ))
                : activeGroup.items.map((item) => {
                    const Icon = item.icon;
                    const active = isActive(location.pathname, item.to);
                    const badge = badgeFor((item as any).badgeKey);
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        className={cn(
                          "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                          active
                            ? "bg-sidebar-primary/15 text-sidebar-primary border-l-2 border-sidebar-primary"
                            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {item.label}
                        {badge !== null && (
                          <span
                            className={cn(
                              "ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-mono text-[10px] font-semibold",
                              active
                                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                                : "bg-sidebar-primary/20 text-sidebar-primary",
                            )}
                          >
                            {badge > 99 ? "99+" : badge}
                          </span>
                        )}
                      </Link>
                    );
                  })}
            </nav>
          </aside>
        )}
      </div>
    </TooltipProvider>
  );
}
