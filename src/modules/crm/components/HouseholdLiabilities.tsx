import { useCallback, useEffect, useMemo, useState } from "react";
import { Landmark, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/shared/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/shared/components/ui/alert-dialog";
import {
  CATEGORIES, TYPE_LABELS, creditAvailable, isRevolving, limitOf, liabilityTotals, type LiabilityType,
} from "../lib/liabilities";

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 2 });

interface Row {
  id: string;
  contact_id: string | null;
  liability_type: LiabilityType;
  description: string;
  current_balance: number;
  credit_limit: number | null;
  original_amount: number | null;
  interest_rate_pct: number | null;
  due_date: string | null;
}

interface Member { id: string; name: string }

const EMPTY = { id: "", type: "mortgage" as LiabilityType, owner: "", description: "", limit: "", balance: "", rate: "", due: "" };
const FORM_TYPES: LiabilityType[] = ["mortgage", "heloc", "credit_card", "personal_loan", "line_of_credit", "other_debt"];

const toNum = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * The household's personal liabilities (Mortgage, HELOC, Credit Cards, Personal Loans): limit, balance and, for
 * revolving credit, credit available. Rows belong to a household member; the Sovereignty Review's Liabilities and
 * net worth read the same records.
 */
export function HouseholdLiabilities({ householdId, onChanged }: { householdId: string; onChanged?: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data: contacts } = await supabase.from("contacts").select("id, first_name, last_name").eq("household_id", householdId);
    const people = (contacts ?? []).map((c) => ({ id: c.id, name: [c.first_name, c.last_name].filter(Boolean).join(" ") }));
    setMembers(people);
    if (!people.length) { setRows([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from("liabilities")
      .select("id, contact_id, liability_type, description, current_balance, credit_limit, original_amount, interest_rate_pct, due_date")
      .eq("holder_type", "contact").in("contact_id", people.map((p) => p.id)).order("created_at");
    if (error) { toast.error("Failed to load liabilities."); setLoading(false); return; }
    setRows((data ?? []).map((r) => ({
      id: r.id, contact_id: r.contact_id, liability_type: r.liability_type as LiabilityType, description: r.description,
      current_balance: Number(r.current_balance) || 0, credit_limit: toNum(r.credit_limit),
      original_amount: toNum(r.original_amount), interest_rate_pct: toNum(r.interest_rate_pct), due_date: r.due_date,
    })));
    setLoading(false);
  }, [householdId]);

  useEffect(() => { load(); }, [load]);

  const nameOf = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);
  const totals = useMemo(() => liabilityTotals(rows), [rows]);

  const startAdd = () => setForm({ ...EMPTY, owner: members[0]?.id ?? "" });
  const startEdit = (r: Row) => setForm({
    id: r.id, type: r.liability_type, owner: r.contact_id ?? "", description: r.description,
    limit: String(limitOf(r) ?? ""), balance: String(r.current_balance), rate: r.interest_rate_pct === null ? "" : String(r.interest_rate_pct),
    due: r.due_date ?? "",
  });

  const save = async () => {
    if (!form) return;
    setSaving(true);
    const revolving = isRevolving(form.type);
    // The table requires created_by and its insert policy only allows created_by = the signed-in user.
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setSaving(false); toast.error("You're signed out. Sign in again to save."); return; }
    const payload: Database["public"]["Tables"]["liabilities"]["Insert"] = {
      created_by: auth.user.id,
      holder_type: "contact", contact_id: form.owner || null, corporation_id: null, liability_type: form.type,
      description: form.description.trim(), current_balance: toNum(form.balance) ?? 0,
      credit_limit: revolving ? toNum(form.limit) : null,
      original_amount: revolving ? null : toNum(form.limit),
      interest_rate_pct: toNum(form.rate), due_date: form.due || null,
    };
    const { error } = form.id
      ? await supabase.from("liabilities").update({ ...payload, created_by: undefined }).eq("id", form.id)
      : await supabase.from("liabilities").insert(payload);
    setSaving(false);
    if (error) { toast.error("Failed to save liability."); return; }
    toast.success(form.id ? "Liability updated." : "Liability added.");
    setForm(null);
    await load();
    onChanged?.();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("liabilities").delete().eq("id", id);
    if (error) { toast.error("Failed to delete liability."); return; }
    toast.success("Liability removed.");
    await load();
    onChanged?.();
  };

  const revolving = form ? isRevolving(form.type) : false;
  const formAvailable = form && revolving && toNum(form.limit) !== null
    ? Math.max(0, (toNum(form.limit) as number) - (toNum(form.balance) ?? 0)) : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Landmark className="h-4 w-4 text-sanctuary-bronze" /> Liabilities
        </CardTitle>
        <Button size="sm" variant="outline" onClick={startAdd} disabled={!members.length}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add liability
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            ["Total balance", totals.balance],
            ["Revolving credit limits", totals.revolvingLimit],
            ["Credit available", totals.creditAvailable],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-md border bg-muted/30 px-3 py-2">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="text-lg font-semibold tabular-nums">{money(value as number)}</div>
            </div>
          ))}
        </div>

        {form && (
          <div className="space-y-3 rounded-md border p-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as LiabilityType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{FORM_TYPES.map((t) => <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Owner</Label>
                <Select value={form.owner} onValueChange={(v) => setForm({ ...form, owner: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Description</Label>
                <Input placeholder="e.g. RBC Mortgage, Vernon HELOC" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{revolving ? "Limit ($)" : "Original amount ($)"}</Label>
                <Input type="number" value={form.limit} onChange={(e) => setForm({ ...form, limit: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Balance ($)</Label>
                <Input type="number" value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Credit available ($)</Label>
                <Input value={revolving ? (formAvailable === null ? "" : formAvailable.toFixed(2)) : "n/a"} disabled />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Interest rate % (optional)</Label>
                <Input type="number" step="0.01" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{form.type === "mortgage" ? "Renewal / maturity date (optional)" : "Due date (optional)"}</Label>
                <Input type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={saving || !form.description.trim() || !form.owner}>{form.id ? "Save" : "Add"}</Button>
              <Button size="sm" variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 && !form ? (
          <p className="text-sm text-muted-foreground">No liabilities on file. Add the household's mortgage, HELOC, credit cards and loans so its net worth is complete.</p>
        ) : (
          CATEGORIES.map((cat) => {
            const list = rows.filter((r) => cat.types.includes(r.liability_type));
            if (!list.length) return null;
            const sub = liabilityTotals(list);
            const showAvail = list.some((r) => isRevolving(r.liability_type));
            return (
              <section key={cat.key} className="space-y-1">
                <div className="flex items-baseline justify-between border-b pb-1">
                  <h4 className="text-sm font-medium">{cat.title}</h4>
                  <span className="text-sm font-semibold tabular-nums">{money(sub.balance)}</span>
                </div>
                <div className="hidden grid-cols-[1fr_7rem_7rem_7rem_4.5rem] gap-2 px-3 text-[10px] uppercase tracking-wide text-muted-foreground md:grid">
                  <span />
                  <span className="text-right">{cat.limitLabel}</span>
                  <span className="text-right">Balance</span>
                  <span className="text-right">{showAvail ? "Credit available" : ""}</span>
                  <span />
                </div>
                {list.map((r) => (
                  <div key={r.id} className="grid grid-cols-1 items-center gap-2 rounded-md bg-muted/40 px-3 py-2 md:grid-cols-[1fr_7rem_7rem_7rem_4.5rem]">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{r.description}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {TYPE_LABELS[r.liability_type]}{r.contact_id && nameOf.get(r.contact_id) ? ` · ${nameOf.get(r.contact_id)}` : ""}
                        {r.interest_rate_pct !== null ? ` · ${r.interest_rate_pct}%` : ""}{r.due_date ? ` · ${r.due_date}` : ""}
                      </div>
                    </div>
                    <div className="text-sm tabular-nums md:text-right">{money(limitOf(r))}</div>
                    <div className="text-sm font-medium tabular-nums md:text-right">{money(r.current_balance)}</div>
                    <div className="text-sm tabular-nums md:text-right">{isRevolving(r.liability_type) ? money(creditAvailable(r)) : ""}</div>
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-7 w-7"><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove this liability?</AlertDialogTitle>
                            <AlertDialogDescription>"{r.description}" will be permanently removed. This can't be undone.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => remove(r.id)}>Remove</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                ))}
              </section>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
