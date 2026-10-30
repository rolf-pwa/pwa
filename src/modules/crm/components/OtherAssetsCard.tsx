import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/shared/integrations/supabase/client";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { OTHER_ASSET_CATEGORIES, categoryLabel, evenSplit, isJoint, ownerSplitError, valueIsStale } from "../lib/otherAssets";

const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }));
const today = () => new Date().toISOString().slice(0, 10);

interface Member { id: string; first_name: string; last_name: string | null; is_minor?: boolean }
interface Owner { contact_id: string; ownership_pct: number }
interface AssetRow {
  id: string; category: string; name: string; description: string | null; current_value: number | null; value_as_of: string | null;
  liability_id: string | null; notes: string | null; owners: Owner[];
}
interface LoanOption { id: string; label: string }
const blank = { name: "", category: "principal_residence", description: "", value: "", asOf: today(), loan: "none", notes: "" };

/**
 * What the household owns apart from investment accounts: principal residence, vehicles, collectibles. Each asset has
 * one or more owners with a % split (individual or joint) and is counted once, at full value, in the Legacy Trust of
 * the Review. Values are entered by hand with an "as of" date; one older than 12 months is flagged.
 */
export function OtherAssetsCard({ householdId, members }: { householdId: string; members: Member[] }) {
  const [rows, setRows] = useState<AssetRow[]>([]);
  const [loans, setLoans] = useState<LoanOption[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(blank);
  const [shares, setShares] = useState<Record<string, string>>({});
  const nameOf = (id: string) => { const m = members.find((x) => x.id === id); return m ? [m.first_name, m.last_name].filter(Boolean).join(" ") : "Former member"; };

  const load = useCallback(async () => {
    const { data: assets } = await supabase.from("other_assets" as never).select("id, category, name, description, current_value, value_as_of, liability_id, notes").eq("household_id", householdId).order("created_at");
    const list = (assets ?? []) as any[];
    const { data: owners } = list.length ? await supabase.from("other_asset_owners" as never).select("asset_id, contact_id, ownership_pct").in("asset_id", list.map((a) => a.id)) : { data: [] };
    setRows(list.map((a) => ({
      ...a, current_value: a.current_value === null ? null : Number(a.current_value),
      owners: ((owners ?? []) as any[]).filter((o) => o.asset_id === a.id).map((o) => ({ contact_id: o.contact_id, ownership_pct: Number(o.ownership_pct) })),
    })));
  }, [householdId]);
  useEffect(() => { load(); }, [load]);

  const openDialog = async (row?: AssetRow) => {
    const ids = members.map((m) => m.id);
    const { data: ls } = ids.length ? await supabase.from("liabilities").select("id, description, liability_type, current_balance").in("contact_id", ids) : { data: [] };
    setLoans(((ls ?? []) as any[]).map((l) => ({ id: l.id, label: `${l.description || l.liability_type} (${money(Number(l.current_balance) || 0)})` })));
    setEditId(row?.id ?? null);
    if (row) {
      setForm({ name: row.name, category: row.category, description: row.description ?? "", value: row.current_value === null ? "" : String(row.current_value), asOf: row.value_as_of ?? "", loan: row.liability_id ?? "none", notes: row.notes ?? "" });
      setShares(Object.fromEntries(row.owners.map((o) => [o.contact_id, String(o.ownership_pct)])));
    } else {
      const adults = members.filter((m) => !m.is_minor);
      const first = (adults[0] ?? members[0])?.id;
      setForm(blank);
      setShares(first ? { [first]: "100" } : {});
    }
    setOpen(true);
  };

  const toggleOwner = (id: string, on: boolean) => {
    const next = { ...shares };
    if (on) next[id] = "0"; else delete next[id];
    const split = evenSplit(Object.keys(next));
    setShares(Object.fromEntries(split.map((s) => [s.contact_id, String(s.ownership_pct)])));
  };

  const ownersFromForm = (): Owner[] => Object.entries(shares).map(([contact_id, pct]) => ({ contact_id, ownership_pct: Number(pct) || 0 }));
  const splitError = open ? ownerSplitError(ownersFromForm()) : null;

  const save = async () => {
    if (!form.name.trim()) { toast.error("Give the asset a name."); return; }
    if (splitError) { toast.error(splitError); return; }
    setSaving(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("You're signed out. Sign in again to save.");
      const value = form.value.trim() === "" ? null : Number(form.value);
      const fields = {
        name: form.name.trim(), category: form.category, description: form.description.trim() || null, current_value: value,
        value_as_of: form.asOf || null, value_source: "Entered by staff", liability_id: form.loan === "none" ? null : form.loan, notes: form.notes.trim() || null,
      };
      let id = editId;
      if (id) {
        const { error } = await supabase.from("other_assets" as never).update(fields as never).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("other_assets" as never).insert({ ...fields, household_id: householdId, created_by: auth.user.id } as never).select("id").single();
        if (error) throw error;
        id = (data as any).id as string;
      }
      const { error: delErr } = await supabase.from("other_asset_owners" as never).delete().eq("asset_id", id!);
      if (delErr) throw delErr;
      const { error: ownErr } = await supabase.from("other_asset_owners" as never).insert(ownersFromForm().map((o) => ({ asset_id: id, ...o })) as never);
      if (ownErr) throw ownErr;
      toast.success(editId ? "Asset updated." : "Asset added.");
      setOpen(false);
      await load();
    } catch (e) {
      toast.error(`Couldn't save the asset: ${e instanceof Error ? e.message : String(e)}`);
    }
    setSaving(false);
  };

  const remove = async (row: AssetRow) => {
    if (!window.confirm(`Remove "${row.name}" from this household's assets?`)) return;
    const { error } = await supabase.from("other_assets" as never).delete().eq("id", row.id);
    if (error) { toast.error(`Couldn't remove it: ${error.message}`); return; }
    await load();
  };

  const total = rows.reduce((a, r) => a + (r.current_value ?? 0), 0);

  return (
    <>
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-lg">Other Assets</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">{rows.length} {rows.length === 1 ? "asset" : "assets"} · {money(total)} · counted in the Legacy Trust</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => openDialog()} disabled={!members.length}><Plus className="mr-1 h-3.5 w-3.5" /> Add asset</Button>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {rows.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">No other assets yet. Add the principal residence, vehicles and anything else owned outside investment accounts, alone or jointly.</p>
          ) : (
            <ul className="border-t border-border">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 border-b border-border px-6 py-2.5 last:border-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{r.name}<span className="ml-2 text-xs font-normal text-muted-foreground">{categoryLabel(r.category)}</span></p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {isJoint(r.owners) ? "Joint: " : "Owner: "}{r.owners.map((o) => `${nameOf(o.contact_id)}${isJoint(r.owners) ? ` ${o.ownership_pct}%` : ""}`).join(", ") || "none set"}
                      {r.liability_id ? " · has a linked loan" : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-right text-sm tabular-nums">
                      {money(r.current_value)}
                      <span className={`block text-[11px] ${valueIsStale(r.value_as_of) ? "text-brick" : "text-muted-foreground"}`}>
                        {r.value_as_of ? `as of ${r.value_as_of}` : "no date"}{valueIsStale(r.value_as_of) ? " · update" : ""}
                      </span>
                    </span>
                    <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Edit ${r.name}`} onClick={() => openDialog(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Remove ${r.name}`} onClick={() => remove(r)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? "Edit asset" : "Add asset"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Name</Label><Input placeholder="e.g. Family home, 2022 Tacoma" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{OTHER_ASSET_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Estimated value ($)</Label><Input type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Value as of</Label><Input type="date" value={form.asOf} onChange={(e) => setForm({ ...form, asOf: e.target.value })} /></div>
            </div>
            <div className="space-y-1"><Label className="text-xs">Details (address, VIN, anything useful)</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="space-y-1">
              <Label className="text-xs">Owners and shares</Label>
              <div className="space-y-1.5 rounded-md border border-border p-2">
                {members.map((m) => {
                  const on = m.id in shares;
                  return (
                    <div key={m.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" id={`oa-${m.id}`} checked={on} onChange={(e) => toggleOwner(m.id, e.target.checked)} />
                      <label htmlFor={`oa-${m.id}`} className="flex-1">{nameOf(m.id)}</label>
                      {on && <><Input className="h-7 w-20" type="number" value={shares[m.id]} onChange={(e) => setShares({ ...shares, [m.id]: e.target.value })} aria-label={`${nameOf(m.id)} share`} /><span className="text-xs text-muted-foreground">%</span></>}
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
                  <SelectContent><SelectItem value="none">None</SelectItem>{loans.map((l) => <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1"><Label className="text-xs">Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !!splitError}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
