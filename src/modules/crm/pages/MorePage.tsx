import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, LogOut, PenLine, Smartphone } from "lucide-react";
import { AppLayout } from "@/shared/components/AppLayout";
import { GROUPS } from "@/shared/components/AppSidebar";
import { PushSettings } from "@/modules/crm/components/PushSettings";
import { EmailSignatureDialog } from "@/shared/components/EmailSignatureDialog";
import { Card, CardContent } from "@/shared/components/ui/card";
import { useAuth } from "@/shared/hooks/useAuth";
import { signOut } from "@/shared/lib/auth";

/** Whether the app is running from the home screen (no browser bar) rather than in a browser tab. */
const installed = () => { try { return window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true; } catch { return false; } };

/** The phone's "More": everything that is not on the bottom bar (the sidebar's groups, as lists), the account, and how to put the app on the home screen. */
export default function MorePage() {
  const { user } = useAuth();
  const [signature, setSignature] = useState(false);
  return (
    <AppLayout>
      <div className="space-y-6 pb-4" data-testid="more-page">
        {!installed() && (
          <Card className="border-accent/40"><CardContent className="flex gap-3 p-4 text-sm">
            <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
            <div><p className="font-medium">Put ProsperWise on your home screen</p><p className="text-xs text-muted-foreground">In Safari, tap Share, then Add to Home Screen. It then opens full screen like an app.</p></div>
          </CardContent></Card>
        )}
        <PushSettings />
        {GROUPS.map((g) => (
          <section key={g.key} aria-label={g.label}>
            <h2 className="mb-1.5 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">{g.label}</h2>
            <ul className="divide-y overflow-hidden rounded-xl border bg-card">
              {g.items.map((i) => (
                <li key={i.to}><Link to={i.to} className="flex min-h-12 items-center gap-3 px-4 text-sm font-medium active:bg-muted"><i.icon className="h-5 w-5 text-accent" /><span className="flex-1">{i.label}</span><ChevronRight className="h-4 w-4 text-muted-foreground" /></Link></li>
              ))}
            </ul>
          </section>
        ))}
        <section aria-label="Account">
          <h2 className="mb-1.5 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">{user?.email ?? "Account"}</h2>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            <li><button type="button" onClick={() => setSignature(true)} className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-sm font-medium active:bg-muted"><PenLine className="h-5 w-5 text-accent" />Email signature</button></li>
            <li><button type="button" onClick={() => signOut()} className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-sm font-medium text-destructive active:bg-muted"><LogOut className="h-5 w-5" />Sign out</button></li>
          </ul>
        </section>
      </div>
      {user && <EmailSignatureDialog open={signature} onOpenChange={setSignature} userId={user.id} email={user.email} />}
    </AppLayout>
  );
}
