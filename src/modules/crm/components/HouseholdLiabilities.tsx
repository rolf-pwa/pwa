import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/shared/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Switch } from "@/shared/components/ui/switch";
import { SidebarSection } from "@/shared/components/SidebarSection";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/shared/components/ui/alert-dialog";
import {
  CATEGORIES, TYPE_LABELS, annualInterest, creditAvailable, interestTotals, isRevolving, limitOf, liabilityTotals, utilisationPct, type LiabilityType,
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
  credit_in_strategic: boolean;
}

interface Member { id: string; name: string }

const EMPTY = { id: "", type: "mortgage" as LiabilityType, owner: "", description: "", limit: "", balance: "", rate: "", due: "" };
const FORM_TYPES: LiabilityType[] = ["mortgage", "heloc", "credit_card", "personal_loan", "line_of_credit", "other_debt"];

const toNum = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * The household's personal liabilities: balance, limit and, for revolving credit, credit available and how much of the
 * limit is used, with the estimated interest for the year. Unused credit on a revolving line can be assigned to the
 * Strategic Reserve (reserve capacity, never an asset). Corporate liabilities are shown read-only from the corporate
 * records. The Sovereignty Review, Stabilization Map and Governance Audit read the same records.
 */
export function HouseholdLiabilities({ householdId, onChanged }: { householdId: string; onChanged?: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [corp, setCorp] = useState<{ corporation: string; rows: Row[] }[]>([]);
  const [budget, setBudget] = useState<{ label: string; amount: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [saving, setSaving] = useState(false);

  const mapRow = (r: any): Row => ({
    id: r.id, contact_id: r.contact_id, liability_type: r.liability_type as LiabilityType, description: r.description,
    current_balance: Number(r.current_balance) || 0, credit_limit: toNum(r.credit_limit),
    original_amount: toNum(r.original_amount), interest_rate_pct: toNum(r.interest_rate_pct), due_date: r.due_date,
    credit_in_strategic: !!r.credit_in_strategic,
  });

  const load = useCallback(async () => {
    const { data: contacts } = await supabase.from("contacts").select("id, first_name, last_name").eq("household_id", householdId);
    const people = (contacts ?? []).map((c) => ({ id: c.id, name: [c.first_name, c.last_name].filter(Boolean).join(" ") }));
    setMembers(people);
    if (!people.length) { setRows([]); setCorp([]); setLoading(false); return; }
    const cols = "id, contact_id, corporation_id, liability_type, description, current_balance, credit_limit, original_amount, interest_rate_pct, due_date, credit_in_strategic";
    const { data, error } = await supabase.from("liabilities").select(cols as never)
      .eq("holder_type", "contact").in("contact_id", people.map((p) => p.id)).order("created_at");
    if (error) { toast.error("Failed to load liabilities."); setLoading(false); return; }
    setRows(((data ?? []) as any[]).map(mapRow));

    // Corporate liabilities of the corporations the household's members hold shares in (read only).
    const { data: sh } = await supabase.from("shareholders").select("corporation_id").in("contact_id", people.map((p) => p.id)).eq("is_active", true);
    const corpIds = [...new Set((sh ?? []).map((x) => x.corporation_id))];
    if (corpIds.length) {
      const [{ data: corps }, { data: cl }] = await Promise.all([
        supabase.from("corporations").select("id, name").in("id", corpIds),
        supabase.from("liabilities").select(cols as never).eq("holder_type", "corporation").in("corporation_id", corpIds).order("created_at"),
      ]);
      const names = new Map((corps ?? []).map((c) => [c.id, c.name]));
      const byCorp = new Map<string, Row[]>();
      for (const r of (cl ?? []) as any[]) byCorp.set(r.corporation_id, [...(byCorp.get(r.corporation_id) ?? []), mapRow(r)]);
      setCorp([...byCorp.entries()].map(([id, list]) => ({ corporation: names.get(id) ?? "Corporation", rows: list })));
    } else setCorp([]);

    // The Charter's yearly debt-service budget, as read for the latest Sovereignty Review.
    const { data: rev } = await supabase.from("quarterly_system_reviews").select("diagnostics").eq("household_id", householdId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const targets = ((rev?.diagnostics as any)?.charter_extract?.targets ?? []) as any[];
    const t = targets.find((x) => x.area === "liabilities" && (x.metric === "annual_amount" || x.metric === "monthly_amount") && typeof x.value === "number");
    setBudget(t ? { label: String(t.label), amount: t.metric === "monthly_amount" ? t.value * 12 : t.value } : null);
    setLoading(false);
  }, [householdId]);

  useEffect(() => { load(); }, [load]);

  const nameOf = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);
  const totals = useMemo(() => liabilityTotals(rows), [rows]);
  const interest = useMemo(() => interestTotals(rows), [rows]);
  const strategicCredit = useMemo(() => rows.filter((r) => r.credit_in_strategic).reduce((a, r) => a + (creditAvailable(r) ?? 0), 0), [rows]);

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

  const setInStrategic = async (r: Row, on: boolean) => {
    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, credit_in_strategic: on } : x)));
    const { error } = await supabase.from("liabilities").update({ credit_in_strategic: on } as never).eq("id", r.id);
    if (error) {
      setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, credit_in_strategic: !on } : x)));
      toast.error("Couldn't update the Strategic Reserve setting.");
      return;
    }
    toast.success(on ? "Available credit now counts toward the Strategic Reserve." : "Available credit removed from the Strategic Reserve.");
    onChanged?.();
  };

  const revolving = form ? isRevolving(form.type) : false;
  const formAvailable = form && revolving && toNum(form.limit) !== null
    ? Math.max(0, (toNum(form.limit) as number) - (toNum(form.balance) ?? 0)) : null;

  const Line = ({ r, readOnly }: { r: Row; readOnly?: boolean }) => {
    const util = utilisationPct(r);
    const yearly = annualInterest(r);
    return (
      <div className="grid grid-cols-1 items-center gap-x-3 gap-y-0.5 border-b py-2 last:border-0 md:grid-cols-[1fr_6.5rem_6.5rem_6.5rem_6.5rem_4.5rem]">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{r.description}</div>
          <div className="text-[11px] text-muted-foreground">
            {TYPE_LABELS[r.liability_type]}{!readOnly && r.contact_id && nameOf.get(r.contact_id) ? ` · ${nameOf.get(r.contact_id)}` : ""}
            {r.interest_rate_pct !== null ? ` · ${r.interest_rate_pct}%` : " · no rate"}{r.due_date ? ` · ${r.due_date}` : ""}
          </div>
          {util !== null && (
            <div className="mt-1 flex items-center gap-2" title={`${util}% of the limit is used`}>
              <div className="h-1 w-32 rounded bg-muted"><div className="h-1 rounded bg-primary/60" style={{ width: `${util}%` }} /></div>
              <span className="text-[10px] text-muted-foreground">{util}% used</span>
            </div>
          )}
        </div>
        <div className="text-sm tabular-nums md:text-right">{money(limitOf(r))}</div>
        <div className="text-sm font-medium tabular-nums md:text-right">{money(r.current_balance)}</div>
        <div className="text-sm tabular-nums md:text-right">{isRevolving(r.liability_type) ? money(creditAvailable(r)) : ""}</div>
        <div className="text-sm tabular-nums text-muted-foreground md:text-right">{yearly === null ? "—" : money(yearly)}</div>
        <div className="flex justify-end gap-1">
          {!readOnly && (
            <>
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
            </>
          )}
        </div>
        {!readOnly && isRevolving(r.liability_type) && creditAvailable(r) !== null && (
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground md:col-span-6" title="Counts the unused credit in the Strategic Reserve and Total Assets, with an equal undrawn-credit line in liabilities, so Net Worth is unchanged.">
            <Switch checked={r.credit_in_strategic} onCheckedChange={(v) => setInStrategic(r, v)} />
            Count available credit ({money(creditAvailable(r))}) toward the Strategic Reserve
          </label>
        )}
      </div>
    );
  };

  const Header = ({ limitLabel, showAvail }: { limitLabel: string; showAvail: boolean }) => (
    <div className="hidden grid-cols-[1fr_6.5rem_6.5rem_6.5rem_6.5rem_4.5rem] gap-x-3 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground md:grid">
      <span />
      <span className="text-right">{limitLabel}</span>
      <span className="text-right">Balance</span>
      <span className="text-right">{showAvail ? "Credit available" : ""}</span>
      <span className="text-right">Interest / yr</span>
      <span />
    </div>
  );

  const corpTotal = corp.reduce((a, c) => a + c.rows.reduce((b, r) => b + r.current_balance, 0), 0);
  const budgetShare = budget && interest.unratedCount === 0 && budget.amount > 0 ? Math.round((interest.interest / budget.amount) * 100) : null;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-5">
        <div className="flex items-center justify-between">
          <div className="grid flex-1 grid-cols-2 gap-6 sm:grid-cols-4">
            {([
              ["Total balance", money(totals.balance), ""],
              ["Interest / yr (estimated)", money(interest.interest), interest.unratedCount > 0 ? `${interest.unratedCount} with no rate (${money(interest.unratedBalance)})` : "all debts costed"],
              ["Credit available", money(totals.creditAvailable), `of ${money(totals.revolvingLimit)} in limits`],
              ["In Strategic Reserve", money(strategicCredit), "available credit assigned"],
            ] as const).map(([label, value, note]) => (
              <div key={label}>
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="text-lg font-semibold tabular-nums">{value}</div>
                {note && <div className="text-[11px] text-muted-foreground">{note}</div>}
              </div>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={startAdd} disabled={!members.length}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add liability
          </Button>
        </div>

        {budget && (
          <p className="text-sm text-muted-foreground">
            Charter {budget.label.toLowerCase()}: <span className="font-medium text-foreground">{money(budget.amount)} a year</span>
            {budgetShare !== null ? <> · estimated interest is {budgetShare}% of it{interest.interest > budget.amount ? <span className="text-destructive"> (over the budget)</span> : null}</> : " · record a rate on every debt to compare it with the interest"}.
          </p>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No liabilities on file. Add the household's mortgage, HELOC, credit cards and loans so its net worth is complete.</p>
        ) : (
          CATEGORIES.map((cat) => {
            const list = rows.filter((r) => cat.types.includes(r.liability_type));
            if (!list.length) return null;
            const sub = liabilityTotals(list);
            return (
              <section key={cat.key} className="space-y-1">
                <div className="flex items-baseline justify-between border-b pb-1">
                  <h4 className="text-sm font-medium">{cat.title}</h4>
                  <span className="text-sm font-semibold tabular-nums">{money(sub.balance)}</span>
                </div>
                <Header limitLabel={cat.limitLabel} showAvail={list.some((r) => isRevolving(r.liability_type))} />
                {list.map((r) => <Line key={r.id} r={r} />)}
              </section>
            );
          })
        )}
      </div>

      <aside className="min-w-0 space-y-3">
        {form && (
          <div className="space-y-3 rounded-lg border bg-card p-4">
            <h4 className="text-sm font-medium">{form.id ? "Edit liability" : "Add liability"}</h4>
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{revolving ? "Limit ($)" : "Original ($)"}</Label>
                <Input type="number" value={form.limit} onChange={(e) => setForm({ ...form, limit: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Balance ($)</Label>
                <Input type="number" value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Credit available</Label>
                <Input value={revolving ? (formAvailable === null ? "" : formAvailable.toFixed(2)) : "n/a"} disabled />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Interest rate %</Label>
                <Input type="number" step="0.01" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{form.type === "mortgage" ? "Renewal / maturity date (optional)" : "Due date (optional)"}</Label>
              <Input type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={saving || !form.description.trim() || !form.owner}>{form.id ? "Save" : "Add"}</Button>
              <Button size="sm" variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
            </div>
          </div>
        )}

        <SidebarSection title="Corporate liabilities" meta={money(corpTotal)}>
          <p className="px-2 text-[11px] text-muted-foreground">Read only, from the corporate records. They count toward net worth but are managed with the corporation.</p>
          {corp.length === 0 ? (
            <p className="px-2 pb-2 text-sm text-muted-foreground">No corporate liabilities on file.</p>
          ) : corp.map((c) => (
            <div key={c.corporation} className="px-2 pb-2">
              <div className="flex items-baseline justify-between border-b pb-1">
                <span className="text-sm font-medium">{c.corporation}</span>
                <span className="text-sm font-semibold tabular-nums">{money(c.rows.reduce((a, r) => a + r.current_balance, 0))}</span>
              </div>
              {c.rows.map((r) => (
                <div key={r.id} className="flex items-baseline justify-between py-1 text-sm">
                  <span className="min-w-0 truncate text-muted-foreground">{r.description}<span className="text-[11px]"> · {TYPE_LABELS[r.liability_type]}{r.interest_rate_pct !== null ? ` · ${r.interest_rate_pct}%` : ""}</span></span>
                  <span className="tabular-nums">{money(r.current_balance)}</span>
                </div>
              ))}
            </div>
          ))}
        </SidebarSection>
      </aside>
    </div>
  );
}
