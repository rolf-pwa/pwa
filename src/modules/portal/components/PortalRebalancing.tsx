import { useState } from "react";
import { CheckCircle2, Scale } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/shared/integrations/supabase/client";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/shared/components/ui/alert-dialog";

export interface RebalancingState { label: string; windowEnd: string; acknowledgedAt: string | null; statement: string; statementVersion: string }

const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-CA", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });

/**
 * The family's portfolio rebalancing for the quarter: review your accounts, then acknowledge it, or ask to talk first.
 * Acknowledging records the client's consent with the exact wording shown, and tells Rolf to do the rebalance.
 */
export function PortalRebalancing({ rebalancing, portalToken, onChanged, onTalkFirst }: { rebalancing: RebalancingState; portalToken: string; onChanged: () => void; onTalkFirst: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const send = async (action: "acknowledge" | "talk_first") => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("portal-rebalance", { body: { portal_token: portalToken, action } });
      if (error || data?.error) throw new Error(data?.error ?? "Something went wrong. Please try again.");
      if (action === "acknowledge") toast.success("Thank you. Your rebalancing is acknowledged.");
      onChanged();
      if (action === "talk_first") onTalkFirst();
    } catch (e: any) {
      toast.error(e?.message ?? "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  if (rebalancing.acknowledgedAt) {
    return (
      <Card>
        <CardContent className="flex items-start gap-2.5 p-4">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <div>
            <h3 className="font-serif text-sm font-semibold text-foreground">Portfolio rebalancing · {rebalancing.label}</h3>
            <p className="mt-1 text-xs text-muted-foreground">Acknowledged on {day(rebalancing.acknowledgedAt)}. Rolf will take it from here.</p>
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="border-accent/40">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 text-accent" />
          <h3 className="font-serif text-sm font-semibold text-foreground">Portfolio rebalancing · {rebalancing.label}</h3>
        </div>
        <p className="text-xs text-muted-foreground">Your portfolio is ready to be rebalanced back to its target allocation. Review your accounts under Financials, then acknowledge it by {day(rebalancing.windowEnd)}.</p>
        <div className="flex flex-col gap-2">
          <Button size="sm" className="bg-accent text-accent-foreground hover:bg-accent/90" disabled={busy} onClick={() => setConfirm(true)}>Review and acknowledge</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => send("talk_first")}>I'd like to talk first</Button>
        </div>
      </CardContent>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Acknowledge your {rebalancing.label} rebalancing</AlertDialogTitle>
            <AlertDialogDescription>{rebalancing.statement}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Not yet</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void send("acknowledge"); }}>I acknowledge and approve</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
