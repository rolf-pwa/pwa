import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/shared/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/shared/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/shared/components/ui/alert-dialog";
import { Badge } from "@/shared/components/ui/badge";
import { Shield, Plus, Pencil, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { POLICY_TYPES, groupPolicies } from "@/shared/lib/insurance";

type OwnerScope =
  | { kind: "contact"; contactId: string }
  | { kind: "corporation"; corporationId: string };

interface Storehouse {
  id: string;
  storehouse_number: number;
  label: string;
}

interface Policy {
  id: string;
  contact_id: string | null;
  corporation_id: string | null;
  carrier: string;
  policy_number: string | null;
  policy_type: string;
  insured_name: string | null;
  coverage_amount: number | null;
  cash_value: number | null;
  premium_amount: number | null;
  premium_frequency: string | null;
  issue_date: string | null;
  renewal_date: string | null;
  paid_up_date: string | null;
  primary_beneficiary: string | null;
  contingent_beneficiary: string | null;
  coverage_storehouse_id: string | null;
  cash_value_storehouse_id: string | null;
  vault_folder_id: string | null;
  notes: string | null;
  visibility_scope: string | null;
}

const FREQUENCIES = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "semi_annual", label: "Semi-Annual" },
  { value: "annual", label: "Annual" },
  { value: "single", label: "Single Premium" },
];

const STOREHOUSE_NAMES: Record<number, string> = {
  1: "Liquidity Reserve", 2: "Strategic Reserve", 3: "Philanthropic Trust", 4: "Legacy Trust",
};

const SCOPE_LABELS: Record<string, string> = {
  private: "Private",
  household_shared: "Household",
  family_shared: "Family",
};

const SCOPE_COLORS: Record<string, string> = {
  private: "border-muted-foreground/30 text-muted-foreground",
  household_shared: "border-accent/30 text-accent",
  family_shared: "border-primary/30 text-primary",
};

const currency = (n: number | null | undefined) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(Number(n) || 0);

const blank: Partial<Policy> = {
  carrier: "",
  policy_number: "",
  policy_type: "whole_life",
  insured_name: "",
  coverage_amount: 0,
  cash_value: 0,
  premium_amount: null,
  premium_frequency: null,
  issue_date: null,
  renewal_date: null,
  paid_up_date: null,
  primary_beneficiary: "",
  contingent_beneficiary: "",
  visibility_scope: "household_shared",
  coverage_storehouse_id: null,
  cash_value_storehouse_id: null,
  notes: "",
};

export function InsurancePanel({ scope, storehouses, onStorehousesChanged }: { scope: OwnerScope; storehouses: Storehouse[]; onStorehousesChanged?: () => void }) {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Policy> | null>(null);
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const q = supabase.from("insurance_policies" as any).select("*");
    const { data, error } = scope.kind === "contact"
      ? await q.eq("contact_id", scope.contactId).order("created_at")
      : await q.eq("corporation_id", scope.corporationId).order("created_at");
    if (error) toast.error("Failed to load insurance policies");
    setPolicies(((data as any) || []) as Policy[]);
    setLoading(false);
  }, [scope]);

  useEffect(() => { load(); }, [load]);

  const startNew = () => { setEditing({ ...blank }); setOpen(true); };
  const startEdit = (p: Policy) => { setEditing({ ...p }); setOpen(true); };

  const save = async () => {
    if (!editing) return;
    if (!editing.carrier?.trim()) { toast.error("Carrier is required"); return; }
    const payload: any = {
      ...editing,
      coverage_amount: Number(editing.coverage_amount) || 0,
      cash_value: Number(editing.cash_value) || 0,
      premium_amount: editing.premium_amount ? Number(editing.premium_amount) : null,
      contact_id: scope.kind === "contact" ? scope.contactId : null,
      corporation_id: scope.kind === "corporation" ? scope.corporationId : null,
    };
    // Clean empty strings on optional fields
    ["policy_number","insured_name","primary_beneficiary","contingent_beneficiary","notes",
     "issue_date","renewal_date","paid_up_date","premium_frequency",
     "coverage_storehouse_id","cash_value_storehouse_id"].forEach((k) => {
      if (payload[k] === "" || payload[k] === undefined) payload[k] = null;
    });

    const { error } = editing.id
      ? await supabase.from("insurance_policies" as any).update(payload).eq("id", editing.id)
      : await supabase.from("insurance_policies" as any).insert(payload);

    if (error) { toast.error(error.message); return; }
    toast.success(editing.id ? "Policy updated" : "Policy added");
    setOpen(false); setEditing(null);
    load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("insurance_policies" as any).delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Policy deleted");
    load();
  };

  const totalCoverage = policies.reduce((s, p) => s + (Number(p.coverage_amount) || 0), 0);
  const totalCash = policies.reduce((s, p) => s + (Number(p.cash_value) || 0), 0);
  const shName = (id: string | null) => {
    const sh = storehouses.find((s) => s.id === id);
    return sh ? `${STOREHOUSE_NAMES[sh.storehouse_number] || "Storehouse"} · ${sh.label}` : "—";
  };

  // Ensure all 4 canonical storehouse types appear in the dropdown, even if a row
  // doesn't yet exist for this owner. Missing ones use a sentinel value; on select
  // we create the row, then set the policy's storehouse id to the new row's id.
  const canonicalNums = [1, 2, 3, 4];
  const missingCanonical = canonicalNums.filter(
    (n) => !storehouses.some((s) => s.storehouse_number === n),
  );

  const ensureCanonicalStorehouse = async (num: number): Promise<string | null> => {
    const payload: any = {
      storehouse_number: num,
      label: STOREHOUSE_NAMES[num] || "",
      contact_id: scope.kind === "contact" ? scope.contactId : null,
      corporation_id: scope.kind === "corporation" ? scope.corporationId : null,
    };
    const { data, error } = await supabase
      .from("storehouses")
      .insert(payload)
      .select("id")
      .single();
    if (error) {
      toast.error(`Failed to create ${STOREHOUSE_NAMES[num]}: ${error.message}`);
      return null;
    }
    onStorehousesChanged?.();
    return (data as any)?.id ?? null;
  };

  const handleStorehouseSelect = async (
    v: string,
    field: "coverage_storehouse_id" | "cash_value_storehouse_id",
  ) => {
    if (!editing) return;
    if (v === "none") {
      setEditing({ ...editing, [field]: null });
      return;
    }
    if (v.startsWith("create:")) {
      const num = Number(v.split(":")[1]);
      const newId = await ensureCanonicalStorehouse(num);
      if (newId) setEditing({ ...editing, [field]: newId });
      return;
    }
    setEditing({ ...editing, [field]: v });
  };

  return (
    <Card>
      <CardHeader
        className="flex flex-row items-center justify-between space-y-0 cursor-pointer select-none"
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          <CardTitle className="text-base">Insurance</CardTitle>
        </div>
        <div className="flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
          <div className="text-right text-xs text-muted-foreground">
            <div>Coverage <span className="font-semibold text-foreground">{currency(totalCoverage)}</span></div>
            <div>Cash Value <span className="font-semibold text-foreground">{currency(totalCash)}</span></div>
          </div>
          <Button size="sm" onClick={startNew}><Plus className="h-4 w-4 mr-1" /> Add Policy</Button>
          {collapsed ? (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </CardHeader>
      {!collapsed && (
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : policies.length === 0 ? (
          <p className="text-sm text-muted-foreground">No policies on file.</p>
        ) : (
          <div className="space-y-2">
            {groupPolicies(policies).map((g) => {
              const p = g.base;
              return (
              <div key={g.key} className="border rounded-md p-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{p.carrier}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {POLICY_TYPES.find((t) => t.value === p.policy_type)?.label || p.policy_type}
                    </Badge>
                    <Badge variant="outline" className={`text-[10px] ${SCOPE_COLORS[p.visibility_scope || "household_shared"] || ""}`}>
                      {SCOPE_LABELS[p.visibility_scope || "household_shared"] || "Household"}
                    </Badge>
                    {p.policy_number && (
                      <span className="text-xs text-muted-foreground">#{p.policy_number}</span>
                    )}
                    {p.insured_name && (
                      <span className="text-xs text-muted-foreground">· Insured: {p.insured_name}</span>
                    )}
                  </div>
                  <div className="mt-1 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <div>Coverage: <span className="text-foreground font-medium">{currency(p.coverage_amount)}</span></div>
                    <div>Cash Value: <span className="text-foreground font-medium">{currency(p.cash_value)}</span></div>
                    <div>Coverage → {shName(p.coverage_storehouse_id)}</div>
                    <div>Cash → Strategic Reserve</div>
                    {p.premium_amount ? (
                      <div>Premium: {currency(p.premium_amount)} {p.premium_frequency || ""}</div>
                    ) : null}
                    {p.renewal_date && <div>Renewal: {p.renewal_date}</div>}
                    {p.paid_up_date && <div>Paid-Up: {p.paid_up_date}</div>}
                    {p.primary_beneficiary && <div className="col-span-2">Beneficiary: {p.primary_beneficiary}</div>}
                    {g.riders.length > 0 && (
                      <div className="col-span-2">Total with riders: <span className="text-foreground font-medium">{currency(g.totalCoverage)}</span></div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="ghost" onClick={() => startEdit(p)}><Pencil className="h-4 w-4" /></Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="icon" variant="ghost"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete policy?</AlertDialogTitle>
                        <AlertDialogDescription>This removes {p.carrier} {p.policy_number ? `#${p.policy_number}` : ""}. This cannot be undone.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => remove(p.id)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
              {g.riders.length > 0 && (
                <div className="mt-2 ml-2 space-y-1 border-l pl-3">
                  {g.riders.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 text-xs">
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5 text-muted-foreground">
                        <Badge variant="outline" className="text-[10px]">
                          {POLICY_TYPES.find((t) => t.value === r.policy_type)?.label || r.policy_type} rider
                        </Badge>
                        <span>Coverage: <span className="font-medium text-foreground">{currency(r.coverage_amount)}</span></span>
                        {r.renewal_date && <span>Renewal: {r.renewal_date}</span>}
                        {r.premium_amount ? <span>Premium: {currency(r.premium_amount)} {r.premium_frequency || ""}</span> : null}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-7 w-7"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete policy?</AlertDialogTitle>
                        <AlertDialogDescription>This removes {r.carrier} rider {r.policy_number ? `#${r.policy_number}` : ""}. This cannot be undone.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => remove(r.id)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              </div>
              );
            })}
          </div>
        )}
      </CardContent>
      )}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editing?.id ? "Edit Policy" : "New Insurance Policy"}</DialogTitle>
            </DialogHeader>
            {editing && (
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 grid grid-cols-2 gap-3">
                  <div>
                    <Label>Carrier *</Label>
                    <Input value={editing.carrier || ""} onChange={(e) => setEditing({ ...editing, carrier: e.target.value })} />
                  </div>
                  <div>
                    <Label>Policy Number</Label>
                    <Input value={editing.policy_number || ""} onChange={(e) => setEditing({ ...editing, policy_number: e.target.value })} />
                  </div>
                </div>
                <div>
                  <Label>Policy Type</Label>
                  <Select value={editing.policy_type} onValueChange={(v) => setEditing({ ...editing, policy_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {POLICY_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Insured Name</Label>
                  <Input value={editing.insured_name || ""} onChange={(e) => setEditing({ ...editing, insured_name: e.target.value })} />
                </div>

                <div>
                  <Label>Coverage Amount</Label>
                  <Input type="number" value={editing.coverage_amount ?? 0} onChange={(e) => setEditing({ ...editing, coverage_amount: Number(e.target.value) })} />
                </div>
                <div>
                  <Label>Cash Value</Label>
                  <Input type="number" value={editing.cash_value ?? 0} onChange={(e) => setEditing({ ...editing, cash_value: Number(e.target.value) })} />
                </div>

                <div>
                  <Label>Coverage → Storehouse</Label>
                  <Select
                    value={editing.coverage_storehouse_id || "none"}
                    onValueChange={(v) => handleStorehouseSelect(v, "coverage_storehouse_id")}
                  >
                    <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Unassigned</SelectItem>
                      {storehouses.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {STOREHOUSE_NAMES[s.storehouse_number] || "Storehouse"} · {s.label}
                        </SelectItem>
                      ))}
                      {missingCanonical.map((n) => (
                        <SelectItem key={`create-${n}`} value={`create:${n}`}>
                          + Create {STOREHOUSE_NAMES[n]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Cash Value → Storehouse</Label>
                  <Input value="Strategic Reserve" disabled className="text-muted-foreground" />
                </div>
                <div>
                  <Label>Visibility</Label>
                  <Select
                    value={editing.visibility_scope || "household_shared"}
                    onValueChange={(v) => setEditing({ ...editing, visibility_scope: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="private">Private</SelectItem>
                      <SelectItem value="household_shared">Household</SelectItem>
                      <SelectItem value="family_shared">Family</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Premium Amount</Label>
                  <Input type="number" value={editing.premium_amount ?? ""} onChange={(e) => setEditing({ ...editing, premium_amount: e.target.value === "" ? null : Number(e.target.value) })} />
                </div>
                <div>
                  <Label>Premium Frequency</Label>
                  <Select value={editing.premium_frequency || "none"} onValueChange={(v) => setEditing({ ...editing, premium_frequency: v === "none" ? null : v })}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {FREQUENCIES.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Issue Date</Label>
                  <Input type="date" value={editing.issue_date || ""} onChange={(e) => setEditing({ ...editing, issue_date: e.target.value || null })} />
                </div>
                <div>
                  <Label>Renewal Date</Label>
                  <Input type="date" value={editing.renewal_date || ""} onChange={(e) => setEditing({ ...editing, renewal_date: e.target.value || null })} />
                </div>
                <div>
                  <Label>Paid-Up Date</Label>
                  <Input type="date" value={editing.paid_up_date || ""} onChange={(e) => setEditing({ ...editing, paid_up_date: e.target.value || null })} />
                </div>
                <div>
                  <Label>Vault Folder ID</Label>
                  <Input value={editing.vault_folder_id || ""} onChange={(e) => setEditing({ ...editing, vault_folder_id: e.target.value || null })} />
                </div>

                <div className="col-span-2">
                  <Label>Primary Beneficiary</Label>
                  <Input value={editing.primary_beneficiary || ""} onChange={(e) => setEditing({ ...editing, primary_beneficiary: e.target.value })} />
                </div>
                <div className="col-span-2">
                  <Label>Contingent Beneficiary</Label>
                  <Input value={editing.contingent_beneficiary || ""} onChange={(e) => setEditing({ ...editing, contingent_beneficiary: e.target.value })} />
                </div>
                <div className="col-span-2">
                  <Label>Notes</Label>
                  <Textarea rows={2} value={editing.notes || ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={save}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </Card>
  );
}
