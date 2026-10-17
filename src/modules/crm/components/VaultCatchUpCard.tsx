import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { getVaultCatchUp, type VaultCatchUpDone, type VaultCatchUpPlan } from "@/modules/crm/lib/reviewAgent";

/** One-time catch-up: Drive Vaults for existing tiered households, then personal drawers for adults who lack one. */
export function VaultCatchUpCard() {
  const [plan, setPlan] = useState<VaultCatchUpPlan | null>(null);
  const [done, setDone] = useState<VaultCatchUpDone[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const preview = async () => {
    setBusy(true);
    try { setPlan((await getVaultCatchUp(false)).plan); setDone([]); setOpen(true); } catch (e: any) { toast.error(e?.message ?? "Couldn't check the Vaults"); } finally { setBusy(false); }
  };
  const run = async () => {
    setBusy(true);
    try {
      // A few households per call; keep going until the plan is empty or a household fails (so a failure is not retried forever).
      for (let i = 0; i < 80; i++) {
        const r = await getVaultCatchUp(true);
        setPlan(r.plan);
        setDone((d) => [...d, ...(r.done ?? [])]);
        if (!r.done?.length || r.done.some((x) => !x.ok)) break;
      }
    } catch (e: any) { toast.error(e?.message ?? "The catch-up stopped"); } finally { setBusy(false); }
  };
  const left = plan ? plan.provision.length + plan.legacy.length + plan.drawers.length + plan.familyVaults.length : 0;
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-1.5 text-left">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}<CardTitle className="text-lg">Vault catch-up</CardTitle></button>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={preview}>{plan ? "Check again" : "Check the Vaults"}</Button>
            {plan && left > 0 && <Button size="sm" disabled={busy} onClick={() => { if (window.confirm(`Create new Vaults for ${plan.provision.length} household${plan.provision.length === 1 ? "" : "s"}, a new structure beside the older Vault for ${plan.legacy.length}, ${plan.familyVaults.length} Family Vault${plan.familyVaults.length === 1 ? "" : "s"}, and personal drawers for ${plan.drawers.length} more? Nothing already in Drive is changed or deleted.`)) run(); }}>{busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Run catch-up</Button>}
          </div>
        </div>
        {open && <p className="text-sm text-muted-foreground">Existing households that have a tier but no Drive Vault, households still on the older Vault layout, and adults who have no personal drawer. Folders are created only: nothing is renamed, moved or deleted, and no one is emailed.</p>}
      </CardHeader>
      {open && plan && (
        <CardContent className="space-y-3 text-sm">
          {left === 0 && <p className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-600" />Nothing left to catch up.</p>}
          {plan.provision.length > 0 && <div><p className="font-medium">Need a Vault ({plan.provision.length})</p><ul className="ml-5 list-disc text-xs text-muted-foreground">{plan.provision.map((h) => <li key={h.id}>{h.name}</li>)}</ul></div>}
          {plan.familyVaults.length > 0 && <div><p className="font-medium">Need a Family Vault ({plan.familyVaults.length})</p><p className="text-xs text-muted-foreground">Virtual Family Office families: a shared Family Docs folder inside the Family folder, beside the household Vaults.</p><ul className="ml-5 list-disc text-xs text-muted-foreground">{plan.familyVaults.map((h) => <li key={h.id}>{h.name}</li>)}</ul></div>}
          {plan.legacy.length > 0 && <div><p className="font-medium">On the older Vault layout ({plan.legacy.length})</p><p className="text-xs text-muted-foreground">A new structure is built and linked. The old folder and its files stay in Drive untouched; move what you want across by hand. The report links each old folder. Until then the client's portal Vault shows the new, empty folders.</p><ul className="ml-5 list-disc text-xs text-muted-foreground">{plan.legacy.map((h) => <li key={h.id}>{h.name}</li>)}</ul></div>}
          {plan.drawers.length > 0 && <div><p className="font-medium">Need personal drawers ({plan.drawers.length})</p><ul className="ml-5 list-disc text-xs text-muted-foreground">{plan.drawers.map((h) => <li key={h.id}>{h.name}: {h.missing}</li>)}</ul></div>}
          {done.length > 0 && (
            <div><p className="font-medium">Done so far</p>
              <ul className="space-y-0.5 text-xs">{done.map((d, i) => <li key={i} className="flex items-center gap-1.5">{d.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <TriangleAlert className="h-3.5 w-3.5 text-destructive" />}<span className="font-medium">{d.name}</span> {d.detail}</li>)}</ul>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
