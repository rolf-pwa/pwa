import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { Textarea } from "@/shared/components/ui/textarea";
import { publishPortfolioReview, unpublishPortfolioReview, type PortfolioPackResponse, type PortfolioPack } from "@/modules/crm/lib/reviewAgent";
import { buildClientView, type ClientIncludes } from "../../../../supabase/functions/_shared/portfolio-review-client";
import { PortalPortfolioReview } from "@/modules/portal/components/PortalPortfolioReview";

const when = (iso: string) => new Date(iso).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const SECTIONS: { key: keyof ClientIncludes; label: string }[] = [
  { key: "returns", label: "Values and returns by account" }, { key: "mix", label: "Mix against their Investor Profile" },
  { key: "funds", label: "Funds against our model portfolio" }, { key: "rebalancing", label: "What I propose to switch" }, { key: "reset", label: "Death benefit reset" },
];

/** Publish the household's Portfolio Review to their portal. Nothing is shown to the client until Rolf does this. */
export function PublishToClient({ householdId, householdLabel, pack, publication, onChanged }: { householdId: string; householdLabel: string; pack: PortfolioPack; publication: PortfolioPackResponse["publication"]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [includes, setIncludes] = useState<ClientIncludes>({ returns: true, mix: true, funds: true, reset: true, rebalancing: true });
  const [busy, setBusy] = useState(false);

  const start = () => { setNote(publication?.note ?? ""); setIncludes({ returns: true, mix: true, funds: true, reset: true, rebalancing: true, ...(publication?.includes ?? {}) }); setOpen(true); };
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); setOpen(false); onChanged(); } catch (e: any) { toast.error(e?.message ?? "Couldn't update"); } finally { setBusy(false); }
  };
  const view = buildClientView(pack, includes, note, householdLabel);

  return (
    <>
      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-lg"><Send className="h-4 w-4 text-accent" /> What the client sees</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {publication
            ? <p>Published {when(publication.published_at)} by {publication.published_by}. The household can read it on their portal dashboard.</p>
            : <p className="text-muted-foreground">Nothing is shown to the client yet. Prepare it, add a short note, check the preview, then publish.</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={start}>{publication ? "Update what they see" : "Publish to the client…"}</Button>
            {publication && <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => unpublishPortfolioReview(householdId), "Taken back from the portal")}>Take back</Button>}
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Publish the Portfolio Review: {householdLabel}</DialogTitle>
            <DialogDescription>The client sees a plain-language version of this page, frozen as it is now. Georgia emails the household's adults the first time. Choose what to include and add a note.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {SECTIONS.map((s) => (
                <label key={s.key} className="flex items-center gap-2 text-sm"><Checkbox checked={includes[s.key]} onCheckedChange={(c) => setIncludes((i) => ({ ...i, [s.key]: c === true }))} />{s.label}</label>
              ))}
            </div>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} placeholder="A short note from you, in your own words (optional)." />
            <PortalPortfolioReview view={view} preview />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={busy} onClick={() => run(async () => { const r = await publishPortfolioReview(householdId, note, includes); if (r.emailed) toast.message(`Georgia emailed ${r.emailed} ${r.emailed === 1 ? "person" : "people"}`); }, publication ? "Updated" : "Published to the portal")}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : publication ? "Save changes" : "Publish"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
