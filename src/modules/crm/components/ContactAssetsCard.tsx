import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { categoryLabel, isJoint, shareOfValue, valueIsStale } from "../lib/otherAssets";
import { AssetEditor, loadHouseholdAssets, money, type AssetLoan, type AssetMember, type AssetRow } from "./AssetEditor";

/**
 * The assets one person owns a share of: principal residence, vehicles and so on. Joint assets show their share and who
 * else owns them. Assets belong to the household, so adding one here starts with this person as owner and the same
 * records appear on the household's Assets tab.
 */
export function ContactAssetsCard({ contactId, householdId }: { contactId: string; householdId: string | null }) {
  const [members, setMembers] = useState<AssetMember[]>([]);
  const [rows, setRows] = useState<AssetRow[]>([]);
  const [loans, setLoans] = useState<AssetLoan[]>([]);
  const [editing, setEditing] = useState<{ row: AssetRow | null } | null>(null);

  const load = useCallback(async () => {
    if (!householdId) return;
    const d = await loadHouseholdAssets(householdId);
    setMembers(d.members); setRows(d.rows); setLoans(d.loans);
  }, [householdId]);
  useEffect(() => { load(); }, [load]);

  const nameOf = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);
  const mine = rows.filter((r) => r.owners.some((o) => o.contact_id === contactId));
  const shareOf = (r: AssetRow) => r.owners.find((o) => o.contact_id === contactId)!.ownership_pct;
  const total = mine.reduce((s, r) => s + (shareOfValue(r.current_value, shareOf(r)) ?? 0), 0);

  if (!householdId) return <p className="px-2 py-2 text-sm text-muted-foreground">Add this contact to a household to record assets.</p>;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-2">
        <span className="text-xs text-muted-foreground">{mine.length} {mine.length === 1 ? "asset" : "assets"} · {money(total)} their share</span>
        <Button size="sm" variant="outline" onClick={() => setEditing({ row: null })} disabled={!members.length}><Plus className="mr-1 h-3.5 w-3.5" /> Add</Button>
      </div>
      {mine.length === 0 ? (
        <p className="px-2 pb-2 text-sm text-muted-foreground">No assets owned. Add a residence, vehicle or other asset.</p>
      ) : mine.map((r) => {
        const others = r.owners.filter((o) => o.contact_id !== contactId);
        const stale = valueIsStale(r.value_as_of);
        return (
          <div key={r.id} className="flex items-start justify-between gap-2 border-b px-2 pb-2 last:border-0">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{r.name}</div>
              <div className="text-[11px] text-muted-foreground">
                {categoryLabel(r.category)}
                {isJoint(r.owners) ? ` · ${shareOf(r)}% with ${others.map((o) => `${nameOf.get(o.contact_id) ?? "Former member"} ${o.ownership_pct}%`).join(", ")}` : ""}
              </div>
              <div className={`text-[11px] ${stale ? "text-brick" : "text-muted-foreground"}`}>{r.value_as_of ? `as of ${r.value_as_of}` : "no date"}{stale ? " · update" : ""}</div>
            </div>
            <div className="flex shrink-0 items-start gap-1">
              <span className="text-right text-sm tabular-nums">
                {money(shareOfValue(r.current_value, shareOf(r)))}
                {isJoint(r.owners) && <span className="block text-[11px] text-muted-foreground">of {money(r.current_value)}</span>}
              </span>
              <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Edit ${r.name}`} onClick={() => setEditing({ row: r })}><Pencil className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        );
      })}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.row ? "Edit asset" : "Add asset"}</DialogTitle></DialogHeader>
          {editing && <AssetEditor key={editing.row?.id ?? "new"} householdId={householdId} members={members} loans={loans} initial={editing.row} defaultOwnerId={contactId}
            onSaved={async () => { setEditing(null); await load(); }} onCancel={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
