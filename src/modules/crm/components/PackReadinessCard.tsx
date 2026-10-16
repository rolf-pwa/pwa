import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, TriangleAlert } from "lucide-react";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { getPackReadiness, type PackReadinessRow } from "@/modules/crm/lib/reviewAgent";

const tierLabel = (t: string | null) => (t ? t.replace("tier_", "Tier ").replace("2a", "2A").replace("2b", "2B").toUpperCase().replace("TIER ", "Tier ") : "No tier");

/** Which households with an open Portfolio Review or rebalancing are ready to prepare, and what each still needs from Rolf. */
export function PackReadinessCard() {
  const [rows, setRows] = useState<PackReadinessRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const run = async () => {
    setBusy(true);
    try { setRows((await getPackReadiness()).rows); setOpen(true); } catch (e: any) { toast.error(e?.message ?? "Couldn't check the packs"); } finally { setBusy(false); }
  };
  const waiting = rows?.filter((r) => !r.ready) ?? [];
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-1.5 text-left">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}<CardTitle className="text-lg">Pack readiness</CardTitle></button>
          <Button size="sm" variant="outline" disabled={busy} onClick={run}>{busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}{rows ? "Check again" : "Check the packs"}</Button>
        </div>
        {open && <p className="text-sm text-muted-foreground">What each household with an open Portfolio Review or rebalancing still needs before you prepare it: a date of birth, an Investor Profile, a last reset date or a statement scan.</p>}
      </CardHeader>
      {open && rows && (
        <CardContent className="space-y-1">
          <p className="pb-2 text-sm" data-testid="readiness-summary">{rows.length - waiting.length} of {rows.length} ready{waiting.length ? `, ${waiting.length} need something` : ""}.</p>
          {rows.map((r) => (
            <div key={r.householdId} className="border-b border-border py-2 text-sm last:border-0">
              <div className="flex flex-wrap items-center gap-2">
                {r.ready ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <TriangleAlert className="h-4 w-4 text-amber-600" />}
                <Link to={`/households/${r.householdId}/portfolio-review`} className="font-medium hover:underline">{r.family ?? r.household}{r.family && r.household && r.household !== r.family ? `: ${r.household}` : ""}</Link>
                <Badge variant="outline" className="text-[10px]">{tierLabel(r.tier)}</Badge>
                {r.needs.map((n) => <Badge key={n} variant="secondary" className="text-[10px]">{n}</Badge>)}
                {r.ready && <span className="text-xs text-muted-foreground">Ready</span>}
              </div>
              {r.todo.length > 0 && <ul className="ml-6 mt-1 list-disc space-y-0.5 text-xs text-muted-foreground">{r.todo.map((t) => <li key={t}>{t}</li>)}</ul>}
              {r.notes.length > 0 && <ul className="ml-6 mt-1 list-disc space-y-0.5 text-xs">{r.notes.map((t) => <li key={t}>{t}</li>)}</ul>}
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}
