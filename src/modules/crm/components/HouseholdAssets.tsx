import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/shared/integrations/supabase/client";
import { Button } from "@/shared/components/ui/button";
import { SidebarSection } from "@/shared/components/SidebarSection";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/shared/components/ui/alert-dialog";
import { OTHER_ASSET_CATEGORIES, assetTotals, isJoint, valueByOwner, valueIsStale } from "../lib/otherAssets";
import { AssetEditor, loadHouseholdAssets, money, type AssetLoan, type AssetMember, type AssetRow } from "./AssetEditor";


/**
 * Everything the household owns apart from investment accounts: principal residence, vehicles, collectibles. Each asset
 * has one or more owners with a % split (individual or joint) and is counted once, at full value, in the Legacy Trust
 * of the Sovereignty Review, Transition Map and Governance Audit. Values are entered by hand with an "as of" date and
 * flagged when more than 12 months old.
 */
export function HouseholdAssets({ householdId, onChanged }: { householdId: string; onChanged?: () => void }) {
  const [members, setMembers] = useState<AssetMember[]>([]);
  const [rows, setRows] = useState<AssetRow[]>([]);
  const [loans, setLoans] = useState<AssetLoan[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ row: AssetRow | null } | null>(null);

  const load = useCallback(async () => {
    const d = await loadHouseholdAssets(householdId);
    setMembers(d.members); setRows(d.rows); setLoans(d.loans); setLoading(false);
  }, [householdId]);
  useEffect(() => { load(); }, [load]);

  const nameOf = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);
  const loanOf = useMemo(() => new Map(loans.map((l) => [l.id, l])), [loans]);
  const totals = assetTotals(rows);
  const byOwner = valueByOwner(rows);

  const remove = async (r: AssetRow) => {
    const { error } = await supabase.from("other_assets" as never).delete().eq("id", r.id);
    if (error) { toast.error(`Couldn't remove it: ${error.message}`); return; }
    toast.success("Asset removed.");
    await load();
    onChanged?.();
  };

  const Header = () => (
    <div className="hidden grid-cols-[1fr_6.5rem_6.5rem_4.5rem] gap-x-3 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground md:grid">
      <span /><span className="text-right">Value</span><span className="text-right">Loan</span><span />
    </div>
  );

  const Line = ({ r }: { r: AssetRow }) => {
    const loan = r.liability_id ? loanOf.get(r.liability_id) : undefined;
    const stale = valueIsStale(r.value_as_of);
    return (
      <div className="grid grid-cols-1 items-center gap-x-3 gap-y-0.5 border-b py-2 last:border-0 md:grid-cols-[1fr_6.5rem_6.5rem_4.5rem]">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{r.name}</div>
          <div className="text-[11px] text-muted-foreground">
            {isJoint(r.owners) ? "Joint" : "Owner"}: {r.owners.map((o) => `${nameOf.get(o.contact_id) ?? "Former member"}${isJoint(r.owners) ? ` ${o.ownership_pct}%` : ""}`).join(", ") || "none set"}
            {r.description ? ` · ${r.description}` : ""}
          </div>
        </div>
        <div className="text-sm font-medium tabular-nums md:text-right">
          {money(r.current_value)}
          <div className={`text-[11px] font-normal ${stale ? "text-brick" : "text-muted-foreground"}`}>{r.value_as_of ? `as of ${r.value_as_of}` : "no date"}{stale ? " · update" : ""}</div>
        </div>
        <div className="text-sm tabular-nums text-muted-foreground md:text-right">{loan ? <>{money(loan.balance)}<div className="truncate text-[11px]">{loan.label}</div></> : ""}</div>
        <div className="flex justify-end gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Edit ${r.name}`} onClick={() => setEditing({ row: r })}><Pencil className="h-3.5 w-3.5" /></Button>
          <AlertDialog>
            <AlertDialogTrigger asChild><Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Remove ${r.name}`}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {r.name}?</AlertDialogTitle>
                <AlertDialogDescription>It leaves the household's assets and the next Review. A linked loan stays on the Liabilities tab.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => remove(r)}>Remove</AlertDialogAction></AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    );
  };

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-5">
        <div className="flex items-center justify-between">
          <div className="grid flex-1 grid-cols-2 gap-6 sm:grid-cols-4">
            {([
              ["Total value", money(totals.value), "counted once, in the Legacy Trust"],
              ["Assets", String(totals.count), ""],
              ["Joint", String(totals.joint), "owned by more than one person"],
              ["Need a new value", String(totals.stale), "none dated in the last 12 months"],
            ] as const).map(([label, value, note]) => (
              <div key={label}>
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="text-lg font-semibold tabular-nums">{value}</div>
                {note && <div className="text-[11px] text-muted-foreground">{note}</div>}
              </div>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={() => setEditing({ row: null })} disabled={!members.length}><Plus className="mr-1 h-3.5 w-3.5" /> Add asset</Button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No assets on file. Add the principal residence, vehicles and anything else owned outside investment accounts, alone or jointly, so the household's net worth is complete.</p>
        ) : (
          OTHER_ASSET_CATEGORIES.map((cat) => {
            const list = rows.filter((r) => r.category === cat.value);
            if (!list.length) return null;
            return (
              <section key={cat.value} className="space-y-1">
                <div className="flex items-baseline justify-between border-b pb-1">
                  <h4 className="text-sm font-medium">{cat.label}</h4>
                  <span className="text-sm font-semibold tabular-nums">{money(list.reduce((a, r) => a + (r.current_value ?? 0), 0))}</span>
                </div>
                <Header />
                {list.map((r) => <Line key={r.id} r={r} />)}
              </section>
            );
          })
        )}
      </div>

      <aside className="min-w-0 space-y-3">
        {editing && (
          <div className="space-y-3 rounded-lg border bg-card p-4">
            <h4 className="text-sm font-medium">{editing.row ? "Edit asset" : "Add asset"}</h4>
            <AssetEditor key={editing.row?.id ?? "new"} householdId={householdId} members={members} loans={loans} initial={editing.row}
              onSaved={async () => { setEditing(null); await load(); onChanged?.(); }} onCancel={() => setEditing(null)} />
          </div>
        )}

        <SidebarSection title="By owner" meta={money(totals.value)}>
          <p className="px-2 text-[11px] text-muted-foreground">Each person's share of the assets. Joint assets are split by their percentages, so the shares add up to the household total.</p>
          {Object.keys(byOwner).length === 0 ? (
            <p className="px-2 pb-2 text-sm text-muted-foreground">No assets yet.</p>
          ) : (
            <div className="px-2 pb-2">
              {Object.entries(byOwner).sort((a, b) => b[1] - a[1]).map(([id, v]) => (
                <div key={id} className="flex items-baseline justify-between py-1 text-sm">
                  <span className="min-w-0 truncate text-muted-foreground">{nameOf.get(id) ?? "Former member"}</span>
                  <span className="tabular-nums">{money(v)}</span>
                </div>
              ))}
            </div>
          )}
        </SidebarSection>
      </aside>
    </div>
  );
}
