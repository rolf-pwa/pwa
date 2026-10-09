import { AppSidebar, SidebarCollapseProvider } from "./AppSidebar";
import { AssistantSidebar } from "@/shared/components/AssistantSidebar";
import { CommandPalette } from "@/shared/components/CommandPalette";
import { useAuth } from "@/shared/hooks/useAuth";
import { signOut } from "@/shared/lib/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/shared/components/ui/avatar";
import { useState } from "react";
import { ChevronDown, LogOut, PenLine } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/shared/components/ui/dropdown-menu";
import { EmailSignatureDialog } from "@/shared/components/EmailSignatureDialog";
import { format } from "date-fns";
import { NotificationBell } from "@/shared/components/NotificationBell";
import prosperwiseWordmark from "@/assets/prosperwise-logo-full.png";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [signatureOpen, setSignatureOpen] = useState(false);
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
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-2 rounded-md p-0.5 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-8 w-8 border border-border">
                    <AvatarImage src={user?.user_metadata?.avatar_url} />
                    <AvatarFallback className="bg-primary text-xs text-primary-foreground">
                      {user?.email?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <p className="hidden sm:block max-w-[12rem] truncate text-xs font-medium text-foreground">
                    {user?.user_metadata?.full_name || user?.email}
                  </p>
                  <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground sm:block" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem onSelect={() => setSignatureOpen(true)}>
                    <PenLine className="mr-2 h-4 w-4" />
                    Email signature
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => signOut()}>
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
        {user && <EmailSignatureDialog open={signatureOpen} onOpenChange={setSignatureOpen} userId={user.id} email={user.email} />}
      </div>
    </SidebarCollapseProvider>
  );
}
