import { useState } from "react";
import { CheckCircle2, Scale } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/shared/integrations/supabase/client";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/shared/components/ui/alert-dialog";

export interface RebalancingState {
  label: string;
  summary: string;
  publishedAt: string;
  acknowledgedAt: string | null;
  completedAt: string | null;
  statement: string;
  statementVersion: string;
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" });

/**
 * The family's portfolio rebalancing. It appears only after Rolf has prepared and published it. The client reads what is proposed,
 * and only then acknowledges it (or asks to talk first). Acknowledging records the consent with the wording and proposal shown.
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

  if (rebalancing.completedAt || rebalancing.acknowledgedAt) {
    return (
      <Card>
        <CardContent className="flex items-start gap-2.5 p-4">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <div>
            <h3 className="font-serif text-sm font-semibold text-foreground">Portfolio rebalancing · {rebalancing.label}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {rebalancing.completedAt ? `Completed on ${day(rebalancing.completedAt)}.` : `Acknowledged on ${day(rebalancing.acknowledgedAt!)}. Rolf is carrying it out and you will be told when it is done.`}
            </p>
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
        <p className="text-xs text-muted-foreground">Rolf has prepared a rebalancing of your portfolio for your review. The full proposal is in your Documents.</p>
        {rebalancing.summary && <p className="whitespace-pre-line rounded-md bg-muted/40 p-3 text-sm text-foreground">{rebalancing.summary}</p>}
        <div className="flex flex-col gap-2">
          <Button size="sm" className="bg-accent text-accent-foreground hover:bg-accent/90" disabled={busy} onClick={() => setConfirm(true)}>I've reviewed it: acknowledge</Button>
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
