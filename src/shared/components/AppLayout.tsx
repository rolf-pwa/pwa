import { AppSidebar, SidebarCollapseProvider } from "./AppSidebar";
import { AssistantSidebar } from "@/shared/components/AssistantSidebar";
import { CommandPalette } from "@/shared/components/CommandPalette";
import { useAuth } from "@/shared/hooks/useAuth";
import { signOut } from "@/shared/lib/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/shared/components/ui/avatar";
import { LogOut } from "lucide-react";
import { format } from "date-fns";
import { NotificationBell } from "@/shared/components/NotificationBell";
import prosperwiseWordmark from "@/assets/prosperwise-logo-full.png";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const today = format(new Date(), "EEEE, MMMM d, yyyy");

  return (
    <SidebarCollapseProvider>
      <div className="advisor-app flex h-screen flex-col overflow-hidden bg-background print:h-auto print:overflow-visible">
        {/* Header — full width, above the sidebar and the content. Hidden on print: a page
            rendered through AppLayout (e.g. CharterIntake) that also builds its own print
            document must not have this app chrome bleeding into the printed/PDF output —
            every other print-aware page in this app (SovereigntyCharter, StabilizationMap,
            QuarterlySystemReview, GovernanceAudit) renders standalone, outside AppLayout
            entirely, so they never had this problem; this is the one exception. */}
        <header className="print:hidden flex shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-4 py-2.5">
          <img src={prosperwiseWordmark} alt="ProsperWise" className="h-6 shrink-0" />
          <div className="flex items-center gap-4 min-w-0">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground shrink-0">
              {today}
            </span>
            <div className="flex items-center gap-3 shrink-0">
              <NotificationBell />
              <div className="h-6 w-px bg-border" />
              <Avatar className="h-8 w-8 border border-border">
                <AvatarImage src={user?.user_metadata?.avatar_url} />
                <AvatarFallback className="bg-primary text-xs text-primary-foreground">
                  {user?.email?.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="hidden sm:block overflow-hidden">
                <p className="truncate text-xs font-medium text-foreground">
                  {user?.user_metadata?.full_name || user?.email}
                </p>
              </div>
              <button
                onClick={() => signOut()}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden print:block print:overflow-visible">
          <div className="print:hidden">
            <AppSidebar />
          </div>
          <main className="flex-1 overflow-y-auto print:overflow-visible">
            <div className="max-w-screen-2xl px-6 py-8 print:max-w-none print:p-0">{children}</div>
          </main>
        </div>
        <div className="print:hidden">
          <AssistantSidebar />
        </div>
        <CommandPalette />
      </div>
    </SidebarCollapseProvider>
  );
}
