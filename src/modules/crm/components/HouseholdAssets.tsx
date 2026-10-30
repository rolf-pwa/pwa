import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/shared/integrations/supabase/client";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { SidebarSection } from "@/shared/components/SidebarSection";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/shared/components/ui/alert-dialog";
import { OTHER_ASSET_CATEGORIES, assetTotals, categoryLabel, evenSplit, isJoint, ownerSplitError, valueByOwner, valueIsStale, type OwnerShare } from "../lib/otherAssets";

const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }));
const today = () => new Date().toISOString().slice(0, 10);

interface Member { id: string; name: string; isMinor: boolean }
interface Row {
  id: string; category: string; name: string; description: string | null; current_value: number | null; value_as_of: string | null;
  liability_id: string | null; notes: string | null; owners: OwnerShare[];
}
interface Loan { id: string; label: string; balance: number }
const BLANK = { id: "", name: "", category: "principal_residence", description: "", value: "", asOf: today(), loan: "none", notes: "" };

/**
 * Everything the household owns apart from investment accounts: principal residence, vehicles, collectibles. Each asset
 * has one or more owners with a % split (individual or joint) and is counted once, at full value, in the Legacy Trust
 * of the Sovereignty Review, Transition Map and Governance Audit. Values are entered by hand with an "as of" date and
 * flagged when more than 12 months old.
 */
export function HouseholdAssets({ householdId, onChanged }: { householdId: string; onChanged?: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<typeof BLANK | null>(null);
  const [shares, setShares] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data: contacts } = await supabase.from("contacts").select("id, first_name, last_name, is_minor").eq("household_id", householdId);
    const people = ((contacts ?? []) as any[]).map((c) => ({ id: c.id as string, name: [c.first_name, c.last_name].filter(Boolean).join(" "), isMinor: !!c.is_minor }));
    setMembers(people);
    const { data: assets } = await supabase.from("other_assets" as never).select("id, category, name, description, current_value, value_as_of, liability_id, notes").eq("household_id", householdId).order("created_at");
    const list = (assets ?? []) as any[];
    const [{ data: owners }, { data: ls }] = await Promise.all([
      list.length ? supabase.from("other_asset_owners" as never).select("asset_id, contact_id, ownership_pct").in("asset_id", list.map((a) => a.id)) : Promise.resolve({ data: [] }),
      people.length ? supabase.from("liabilities").select("id, description, liability_type, current_balance").in("contact_id", people.map((p) => p.id)) : Promise.resolve({ data: [] }),
    ]);
    setLoans(((ls ?? []) as any[]).map((l) => ({ id: l.id, label: l.description || l.liability_type, balance: Number(l.current_balance) || 0 })));
    setRows(list.map((a) => ({
      ...a, current_value: a.current_value === null ? null : Number(a.current_value),
      owners: ((owners ?? []) as any[]).filter((o) => o.asset_id === a.id).map((o) => ({ contact_id: o.contact_id, ownership_pct: Number(o.ownership_pct) })),
    })));
    setLoading(false);
  }, [householdId]);
  useEffect(() => { load(); }, [load]);

  const nameOf = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);
  const loanOf = useMemo(() => new Map(loans.map((l) => [l.id, l])), [loans]);
  const totals = assetTotals(rows);
  const byOwner = valueByOwner(rows);

  const startAdd = () => {
    const first = (members.find((m) => !m.isMinor) ?? members[0])?.id;
    setForm({ ...BLANK, asOf: today() });
    setShares(first ? { [first]: "100" } : {});
  };
  const startEdit = (r: Row) => {
    setForm({ id: r.id, name: r.name, category: r.category, description: r.description ?? "", value: r.current_value === null ? "" : String(r.current_value), asOf: r.value_as_of ?? "", loan: r.liability_id ?? "none", notes: r.notes ?? "" });
    setShares(Object.fromEntries(r.owners.map((o) => [o.contact_id, String(o.ownership_pct)])));
  };
  const toggleOwner = (id: string, on: boolean) => {
    const next = { ...shares };
    if (on) next[id] = "0"; else delete next[id];
    setShares(Object.fromEntries(evenSplit(Object.keys(next)).map((s) => [s.contact_id, String(s.ownership_pct)])));
  };
  const formOwners = (): OwnerShare[] => Object.entries(shares).map(([contact_id, pct]) => ({ contact_id, ownership_pct: Number(pct) || 0 }));
  const splitError = form ? ownerSplitError(formOwners()) : null;

  const save = async () => {
    if (!form || !form.name.trim() || splitError) return;
    setSaving(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("You're signed out. Sign in again to save.");
      const fields = {
        name: form.name.trim(), category: form.category, description: form.description.trim() || null,
        current_value: form.value.trim() === "" ? null : Number(form.value), value_as_of: form.asOf || null, value_source: "Entered by staff",
        liability_id: form.loan === "none" ? null : form.loan, notes: form.notes.trim() || null,
      };
      let id = form.id;
      if (id) {
        const { error } = await supabase.from("other_assets" as never).update(fields as never).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("other_assets" as never).insert({ ...fields, household_id: householdId, created_by: auth.user.id } as never).select("id").single();
        if (error) throw error;
        id = (data as any).id as string;
      }
      const { error: delErr } = await supabase.from("other_asset_owners" as never).delete().eq("asset_id", id);
      if (delErr) throw delErr;
      const { error: ownErr } = await supabase.from("other_asset_owners" as never).insert(formOwners().map((o) => ({ asset_id: id, ...o })) as never);
      if (ownErr) throw ownErr;
      toast.success(form.id ? "Asset updated." : "Asset added.");
      setForm(null);
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(`Couldn't save the asset: ${e instanceof Error ? e.message : String(e)}`);
    }
    setSaving(false);
  };

  const remove = async (r: Row) => {
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

  const Line = ({ r }: { r: Row }) => {
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
          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Edit ${r.name}`} onClick={() => startEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
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
          <Button size="sm" variant="outline" onClick={startAdd} disabled={!members.length}><Plus className="mr-1 h-3.5 w-3.5" /> Add asset</Button>
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
        {form && (
          <div className="space-y-3 rounded-lg border bg-card p-4">
            <h4 className="text-sm font-medium">{form.id ? "Edit asset" : "Add asset"}</h4>
            <div className="space-y-1"><Label className="text-xs">Name</Label><Input placeholder="e.g. Family home, 2022 Tacoma" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-1">
              <Label className="text-xs">Type</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{OTHER_ASSET_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Estimated value ($)</Label><Input type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Value as of</Label><Input type="date" value={form.asOf} onChange={(e) => setForm({ ...form, asOf: e.target.value })} /></div>
            </div>
            <div className="space-y-1"><Label className="text-xs">Details (address, VIN, anything useful)</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="space-y-1">
              <Label className="text-xs">Owners and shares</Label>
              <div className="space-y-1.5 rounded-md border p-2">
                {members.map((m) => {
                  const on = m.id in shares;
                  return (
                    <div key={m.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" id={`asset-owner-${m.id}`} checked={on} onChange={(e) => toggleOwner(m.id, e.target.checked)} />
                      <label htmlFor={`asset-owner-${m.id}`} className="min-w-0 flex-1 truncate">{m.name}</label>
                      {on && <><Input className="h-7 w-20" type="number" value={shares[m.id]} onChange={(e) => setShares({ ...shares, [m.id]: e.target.value })} aria-label={`${m.name} share`} /><span className="text-xs text-muted-foreground">%</span></>}
                    </div>
                  );
                })}
              </div>
              {splitError && <p className="text-xs text-brick">{splitError}</p>}
            </div>
            {loans.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">Linked loan (mortgage, car loan)</Label>
                <Select value={form.loan} onValueChange={(v) => setForm({ ...form, loan: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">None</SelectItem>{loans.map((l) => <SelectItem key={l.id} value={l.id}>{l.label} ({money(l.balance)})</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1"><Label className="text-xs">Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={saving || !form.name.trim() || !!splitError}>{form.id ? "Save" : "Add"}</Button>
              <Button size="sm" variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
            </div>
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
