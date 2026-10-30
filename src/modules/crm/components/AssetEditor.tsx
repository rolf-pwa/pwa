import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/shared/integrations/supabase/client";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { OTHER_ASSET_CATEGORIES, evenSplit, ownerSplitError, type OwnerShare } from "../lib/otherAssets";

export const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }));
const today = () => new Date().toISOString().slice(0, 10);

export interface AssetMember { id: string; name: string; isMinor: boolean }
export interface AssetLoan { id: string; label: string; balance: number }
export interface AssetRow {
  id: string; category: string; name: string; description: string | null; current_value: number | null; value_as_of: string | null;
  liability_id: string | null; notes: string | null; owners: OwnerShare[];
}

/** Loads a household's members, assets (with owners) and loans. Shared by the household Assets tab and the contact card. */
export async function loadHouseholdAssets(householdId: string) {
  const { data: contacts } = await supabase.from("contacts").select("id, first_name, last_name, is_minor").eq("household_id", householdId);
  const members: AssetMember[] = ((contacts ?? []) as any[]).map((c) => ({ id: c.id as string, name: [c.first_name, c.last_name].filter(Boolean).join(" "), isMinor: !!c.is_minor }));
  const { data: assets } = await supabase.from("other_assets" as never).select("id, category, name, description, current_value, value_as_of, liability_id, notes").eq("household_id", householdId).order("created_at");
  const list = (assets ?? []) as any[];
  const [{ data: owners }, { data: ls }] = await Promise.all([
    list.length ? supabase.from("other_asset_owners" as never).select("asset_id, contact_id, ownership_pct").in("asset_id", list.map((a) => a.id)) : Promise.resolve({ data: [] }),
    members.length ? supabase.from("liabilities").select("id, description, liability_type, current_balance").in("contact_id", members.map((p) => p.id)) : Promise.resolve({ data: [] }),
  ]);
  const loans: AssetLoan[] = ((ls ?? []) as any[]).map((l) => ({ id: l.id, label: l.description || l.liability_type, balance: Number(l.current_balance) || 0 }));
  const rows: AssetRow[] = list.map((a) => ({
    ...a, current_value: a.current_value === null ? null : Number(a.current_value),
    owners: ((owners ?? []) as any[]).filter((o) => o.asset_id === a.id).map((o) => ({ contact_id: o.contact_id, ownership_pct: Number(o.ownership_pct) })),
  }));
  return { members, rows, loans };
}

/** The add/edit form for one asset: details, owners with % shares, linked loan. Saves the asset and its owners. */
export function AssetEditor({ householdId, members, loans, initial, defaultOwnerId, onSaved, onCancel }: {
  householdId: string; members: AssetMember[]; loans: AssetLoan[]; initial: AssetRow | null; defaultOwnerId?: string; onSaved: () => void; onCancel: () => void;
}) {
  const [form, setForm] = useState(() => initial
    ? { name: initial.name, category: initial.category, description: initial.description ?? "", value: initial.current_value === null ? "" : String(initial.current_value), asOf: initial.value_as_of ?? "", loan: initial.liability_id ?? "none", notes: initial.notes ?? "" }
    : { name: "", category: "principal_residence", description: "", value: "", asOf: today(), loan: "none", notes: "" });
  const [shares, setShares] = useState<Record<string, string>>(() => {
    if (initial) return Object.fromEntries(initial.owners.map((o) => [o.contact_id, String(o.ownership_pct)]));
    const first = defaultOwnerId ?? (members.find((m) => !m.isMinor) ?? members[0])?.id;
    return first ? { [first]: "100" } : {};
  });
  const [saving, setSaving] = useState(false);

  const owners = (): OwnerShare[] => Object.entries(shares).map(([contact_id, pct]) => ({ contact_id, ownership_pct: Number(pct) || 0 }));
  const splitError = ownerSplitError(owners());
  const toggleOwner = (id: string, on: boolean) => {
    const next = { ...shares };
    if (on) next[id] = "0"; else delete next[id];
    setShares(Object.fromEntries(evenSplit(Object.keys(next)).map((s) => [s.contact_id, String(s.ownership_pct)])));
  };

  const save = async () => {
    if (!form.name.trim() || splitError) return;
    setSaving(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("You're signed out. Sign in again to save.");
      const fields = {
        name: form.name.trim(), category: form.category, description: form.description.trim() || null,
        current_value: form.value.trim() === "" ? null : Number(form.value), value_as_of: form.asOf || null, value_source: "Entered by staff",
        liability_id: form.loan === "none" ? null : form.loan, notes: form.notes.trim() || null,
      };
      let id = initial?.id;
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
      const { error: ownErr } = await supabase.from("other_asset_owners" as never).insert(owners().map((o) => ({ asset_id: id, ...o })) as never);
      if (ownErr) throw ownErr;
      toast.success(initial ? "Asset updated." : "Asset added.");
      onSaved();
    } catch (e) {
      toast.error(`Couldn't save the asset: ${e instanceof Error ? e.message : String(e)}`);
    }
    setSaving(false);
  };

  return (
    <div className="space-y-3">
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
        <Button size="sm" onClick={save} disabled={saving || !form.name.trim() || !!splitError}>{initial ? "Save" : "Add"}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
