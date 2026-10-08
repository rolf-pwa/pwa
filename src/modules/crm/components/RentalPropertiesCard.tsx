import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/shared/integrations/supabase/client";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { emptyYear, netRentalIncome, type YearLines } from "../lib/rentalProperty";

export const REAL_ESTATE_ASSET_TYPE = "Primary Residence & Protected Legacy Accounts";
const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }));

interface Member { id: string; first_name: string; last_name: string | null; is_minor?: boolean }
interface PropRow { id: string; name: string; address: string | null; city: string | null; current_value: number | null; net: number | null; netYear: number | null }

/**
 * The household's rental properties, listed like its corporations: value and net rental income for the latest year on
 * file, each linking to the property's own page. Adding one also creates (or links) the real-estate entry in the Legacy
 * Trust, so the property's value is counted once.
 */
export function RentalPropertiesCard({ householdId, members }: { householdId: string; members: Member[] }) {
  const [rows, setRows] = useState<PropRow[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [free, setFree] = useState<{ id: string; label: string; current_value: number | null }[]>([]);
  const [form, setForm] = useState({ name: "", address: "", city: "", value: "", owner: "", link: "new" });

  const load = useCallback(async () => {
    const { data: props } = await supabase.from("rental_properties").select("id, name, address, city, current_value").eq("household_id", householdId).order("created_at");
    const ids = (props ?? []).map((p) => p.id);
    const { data: years } = ids.length ? await supabase.from("rental_property_years").select("*").in("property_id", ids) : { data: [] };
    setRows((props ?? []).map((p) => {
      const mine = ((years ?? []) as any[]).filter((y) => y.property_id === p.id).sort((a, b) => b.tax_year - a.tax_year);
      const latest = mine[0];
      return { id: p.id, name: p.name, address: p.address, city: p.city, current_value: p.current_value === null ? null : Number(p.current_value),
        net: latest ? netRentalIncome(Object.fromEntries(Object.keys(emptyYear()).map((k) => [k, Number(latest[k]) || 0])) as YearLines) : null, netYear: latest?.tax_year ?? null };
    }));
  }, [householdId]);
  useEffect(() => { load(); }, [load]);

  const openDialog = async () => {
    const memberIds = members.map((m) => m.id);
    const [{ data: st }, { data: used }] = await Promise.all([
      memberIds.length ? supabase.from("storehouses").select("id, label, current_value").in("contact_id", memberIds).eq("asset_type", REAL_ESTATE_ASSET_TYPE) : { data: [] },
      supabase.from("rental_properties").select("storehouse_id").eq("household_id", householdId),
    ]);
    const taken = new Set((used ?? []).map((u) => u.storehouse_id).filter(Boolean));
    setFree(((st ?? []) as any[]).filter((s) => !taken.has(s.id)).map((s) => ({ id: s.id, label: s.label, current_value: s.current_value === null ? null : Number(s.current_value) })));
    const adults = members.filter((m) => !m.is_minor);
    setForm({ name: "", address: "", city: "", value: "", owner: (adults[0] ?? members[0])?.id ?? "", link: "new" });
    setOpen(true);
  };

  const create = async () => {
    setSaving(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("You're signed out. Sign in again to save.");
      const value = form.value.trim() === "" ? null : Number(form.value);
      let storehouseId: string | null = form.link !== "new" ? form.link : null;
      if (!storehouseId) {
        // Counted once: the property's value lives in a real-estate row of the Legacy Trust.
        const { data: st, error: stErr } = await supabase.from("storehouses").insert({
          contact_id: form.owner, storehouse_number: 4, label: form.name.trim(), asset_type: REAL_ESTATE_ASSET_TYPE, current_value: value,
        } as never).select("id").single();
        if (stErr) throw stErr;
        storehouseId = st.id;
      }
      const linked = free.find((f) => f.id === storehouseId);
      const { data: prop, error } = await supabase.from("rental_properties").insert({
        household_id: householdId, created_by: auth.user.id, name: form.name.trim(), address: form.address.trim() || null, city: form.city.trim() || null,
        current_value: value ?? linked?.current_value ?? null, value_as_of: new Date().toISOString().slice(0, 10), storehouse_id: storehouseId,
      }).select("id").single();
      if (error) throw error;
      const { error: ownErr } = await supabase.from("rental_property_owners").insert({ property_id: prop.id, contact_id: form.owner, ownership_pct: 100 });
      if (ownErr) throw ownErr;
      toast.success("Rental property added. Open it to enter ownership, the mortgage and the income and expenses.");
      setOpen(false);
      await load();
    } catch (e) {
      toast.error(`Couldn't add the property: ${e instanceof Error ? e.message : String(e)}`);
    }
    setSaving(false);
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-lg">Rental Properties</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">{rows.length} {rows.length === 1 ? "property" : "properties"} · {money(rows.reduce((a, r) => a + (r.current_value ?? 0), 0))}</p>
            </div>
            <Button size="sm" variant="outline" onClick={openDialog} disabled={!members.length}><Plus className="mr-1 h-3.5 w-3.5" /> Add property</Button>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {rows.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">No rental properties yet. Add the household's income properties to track their value, income and expenses.</p>
          ) : (
            <ul className="border-t border-border">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 border-b border-border px-6 py-2.5 last:border-0">
                  <Link to={`/properties/${r.id}`} className="min-w-0 truncate text-sm font-medium text-foreground hover:underline">
                    {r.name}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">{[r.address, r.city].filter(Boolean).join(", ")}</span>
                  </Link>
                  <span className="shrink-0 text-right text-sm tabular-nums">
                    {money(r.current_value)}
                    <span className="block text-[11px] text-muted-foreground">{r.net === null ? "no income entered" : `${money(r.net)} net · ${r.netYear}`}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add rental property</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label className="text-xs">Name</Label><Input placeholder="e.g. Hardie Rd duplex" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">City</Label><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Current value ($)</Label><Input type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></div>
              <div className="space-y-1">
                <Label className="text-xs">Owner (change shares on the property page)</Label>
                <Select value={form.owner} onValueChange={(v) => setForm({ ...form, owner: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{members.map((m) => <SelectItem key={m.id} value={m.id}>{[m.first_name, m.last_name].filter(Boolean).join(" ")}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Legacy Trust entry</Label>
              <Select value={form.link} onValueChange={(v) => setForm({ ...form, link: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">Create a new real-estate entry</SelectItem>
                  {free.map((f) => <SelectItem key={f.id} value={f.id}>Use existing: {f.label} ({money(f.current_value)})</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">The property's value is kept in this entry so it is counted once in the Legacy Trust and Net Worth.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={create} disabled={saving || !form.name.trim() || !form.owner}>Add property</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
