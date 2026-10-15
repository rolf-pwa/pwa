import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Link2, Loader2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { createInvite, getInvite, revokeInvite, type OnboardingInvite } from "@/modules/crm/lib/onboardingAgent";

const when = (iso: string) => new Date(iso).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * An invitation link for the household's head of household, for a personal email from Rolf. When they open it they land on the
 * website, and Georgia emails them (and their spouse, if there is an email) their onboarding link straight away.
 */
export function OnboardingInviteCard({ householdId, embedded = false }: { householdId: string; embedded?: boolean }) {
  const [invite, setInvite] = useState<OnboardingInvite | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setInvite((await getInvite(householdId)).invite); } catch { setInvite(null); }
  }, [householdId]);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<{ invite: OnboardingInvite | null }>, ok?: string) => {
    setBusy(true);
    try { setInvite((await fn()).invite); if (ok) toast.success(ok); }
    catch (e: any) { toast.error(e?.message ?? "Something went wrong"); }
    finally { setBusy(false); }
  };
  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); toast.success("Link copied"); } catch { toast.error("Couldn't copy. Select the link and copy it."); }
  };

  if (invite === undefined) return null;
  const live = invite && (invite.state === "active" || invite.state === "clicked");
  const body = (
    <>
        {!invite && <p className="text-muted-foreground">Make a link for {`the head of household`} to use in your own email. When they open it they land on your website, and Georgia emails them their onboarding link straight away.</p>}
        {live && (
          <>
            <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2">
              <code className="min-w-0 flex-1 truncate text-xs" data-testid="invite-url">{invite.url}</code>
              <Button size="sm" variant="outline" onClick={() => copy(invite.url)} className="gap-1.5"><Copy className="h-3.5 w-3.5" /> Copy</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              For {invite.invitee ?? "the head of household"}{invite.recipients.length > 1 ? ` and ${invite.recipients.slice(1).join(", ")}` : ""}. Tell them an automated email from Georgia will follow shortly. Expires {when(invite.expires_at)}.
            </p>
            {invite.state === "clicked" ? (
              <p className="text-sm">Opened {invite.first_clicked_at ? when(invite.first_clicked_at) : ""}. {invite.started_at ? `Georgia started onboarding${invite.welcome_sent_to ? ` and emailed ${invite.welcome_sent_to} ${invite.welcome_sent_to === 1 ? "person" : "people"}` : ""}.` : "Georgia did not start (she is off or in shadow mode)."}</p>
            ) : (
              <p className="text-sm text-muted-foreground">Not opened yet.</p>
            )}
          </>
        )}
        {invite && !live && <p className="text-muted-foreground">The last link was {invite.state}. Make a new one if you need it.</p>}
        <div className="flex flex-wrap gap-2">
          {(!invite || !live) && <Button size="sm" disabled={busy} onClick={() => run(() => createInvite(householdId, true), "Link made")}>{busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}Make an invitation link</Button>}
          {live && invite.state === "active" && <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => revokeInvite(householdId), "Link revoked")}>Revoke</Button>}
          {live && <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => createInvite(householdId, true), "New link made; the old one no longer works")}>Make a new link</Button>}
        </div>
      </>
  );
  if (embedded) {
    // Prominent on the household information card: a highlighted strip, not a card of its own.
    return (
      <div className="rounded-lg border border-accent/40" style={{ background: "hsl(var(--pw-sand) / 0.35)" }} data-testid="invite-strip">
        <div className="space-y-3 border-l-4 border-accent px-4 py-3 text-sm">
          <h3 className="flex items-center gap-2 font-serif text-base font-semibold text-foreground"><Link2 className="h-4 w-4 text-accent" /> Onboarding link</h3>
          {body}
        </div>
      </div>
    );
  }
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-lg"><Link2 className="h-5 w-5 text-accent" /> Onboarding invitation link</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">{body}</CardContent>
    </Card>
  );
}
