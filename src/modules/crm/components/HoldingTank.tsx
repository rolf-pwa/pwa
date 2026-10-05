import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/shared/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import { Anchor, Grape, Castle, Sword, Wheat, Lock, ArrowRight, Loader2, Trash2, Eye, Users, Home, CalendarDays, Plus, X, ChevronDown, ChevronRight, FileSignature } from "lucide-react";
import { format } from "date-fns";
import { Input } from "@/shared/components/ui/input";
import { toast } from "sonner";
import { CUSTODIAN_OPTIONS } from "@/shared/lib/custodians";
import { WithdrawalAvailableLine } from "@/shared/components/WithdrawalAvailableLine";
import { WebFormDialog } from "./WebFormDialog";
import type { WebFormRecord } from "./WebFormEditorDialog";

interface HoldingTankAccount {
  id: string;
  contact_id: string;
  household_id: string | null;
  account_name: string;
  account_number: string | null;
  account_type: string;
  account_owner: string | null;
  custodian: string | null;
  book_value: number | null;
  current_value: number | null;
  notes: string | null;
  source_file: string | null;
  status: string;
  visibility_scope: string;
  created_at: string;
  expected_deposit_date: string | null;
  beneficiary_designation: string | null;
  /** Income-type holdings per the last approved V2 statement review (null = not recorded). */
  income_funds_value?: number | null;
  income_funds_as_of?: string | null;
}

const SCOPE_OPTIONS = [
  { value: "private", label: "Private", icon: Eye },
  { value: "household_shared", label: "Household", icon: Home },
  { value: "family_shared", label: "Family", icon: Users },
];

interface HoldingTankProps {
  contactId?: string;
  householdId?: string;
  onAccountMoved?: () => void;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

const STOREHOUSE_CONFIG = [
  { num: 1, name: "Liquidity Reserve", icon: Castle },
  { num: 2, name: "Strategic Reserve", icon: Sword },
  { num: 3, name: "Philanthropic Trust", icon: Wheat },
  { num: 4, name: "Legacy Trust", icon: Lock },
];

export function HoldingTank({ contactId, householdId, onAccountMoved }: HoldingTankProps) {
  const [accounts, setAccounts] = useState<HoldingTankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [moveTarget, setMoveTarget] = useState<{ id: string; destination: string; storehouseNum?: number } | null>(null);
  const [moving, setMoving] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const [addForm, setAddForm] = useState({ account_name: "", account_type: "Portfolio", current_value: "", expected_deposit_date: "", custodian: "", beneficiary_designation: "" });
  // Custodian input is constrained to the canonical list to prevent the
  // "iA Financial Group" / "IA Financial" / "IAG Financial Group" casing
  // drift found in production — "Other" reveals free text for genuinely
  // different custodians (TD Bank, Royal Bank, etc.).
  const [custodianMode, setCustodianMode] = useState<string>("");
  const [adding, setAdding] = useState(false);
  const [webforms, setWebforms] = useState<WebFormRecord[]>([]);

  useEffect(() => {
    (supabase.from("adobe_webforms" as any) as any)
      .select("*")
      .eq("is_active", true)
      .then(({ data }: any) => setWebforms((data as WebFormRecord[]) || []));
  }, []);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    let query = (supabase.from("holding_tank" as any) as any)
      .select("*")
      .eq("status", "holding")
      .order("created_at", { ascending: false });

    if (contactId) {
      query = query.eq("contact_id", contactId);
    } else if (householdId) {
      // Roll up: include rows tagged to the household OR belonging to any contact in the household
      const { data: members } = await (supabase.from("contacts") as any)
        .select("id")
        .eq("household_id", householdId);
      const memberIds = (members || []).map((c: any) => c.id);
      if (memberIds.length > 0) {
        query = query.or(`household_id.eq.${householdId},contact_id.in.(${memberIds.join(",")})`);
      } else {
        query = query.eq("household_id", householdId);
      }
    }

    const { data, error } = await query;
    if (!error && data) setAccounts(data as HoldingTankAccount[]);
    setLoading(false);
  }, [contactId, householdId]);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  const handleMove = async () => {
    if (!moveTarget) return;
    setMoving(true);

    const account = accounts.find(a => a.id === moveTarget.id);
    if (!account) { setMoving(false); return; }

    try {
      const scope = account.visibility_scope || "household_shared";
      let newRowId: string | null = null;
      let newRowTable: "vineyard_accounts" | "storehouses" | null = null;
      if (moveTarget.destination === "vineyard") {
        const { data: inserted, error } = await supabase.from("vineyard_accounts").insert({
          contact_id: account.contact_id,
          account_name: account.account_name,
          account_number: account.account_number,
          account_type: account.account_type,
          current_value: account.current_value,
          book_value: account.book_value,
          notes: account.notes,
          visibility_scope: scope,
          custodian: account.custodian,
          beneficiary_designation: account.beneficiary_designation,
          // carry the remembered income funds over so the line survives the move
          income_funds_value: account.income_funds_value ?? null,
          income_funds_as_of: account.income_funds_as_of ?? null,
        } as any).select("id").single();
        if (error) throw error;
        newRowId = (inserted as any).id;
        newRowTable = "vineyard_accounts";
      } else if (moveTarget.destination === "storehouse" && moveTarget.storehouseNum) {
        const { data: inserted, error } = await supabase.from("storehouses").insert({
          contact_id: account.contact_id,
          storehouse_number: moveTarget.storehouseNum,
          label: account.account_name,
          current_value: account.current_value,
          book_value: account.book_value,
          notes: account.notes,
          asset_type: account.account_type,
          visibility_scope: scope,
          account_number: account.account_number,
          custodian: account.custodian,
          beneficiary_designation: account.beneficiary_designation,
        } as any).select("id").single();
        if (error) throw error;
        newRowId = (inserted as any).id;
        newRowTable = "storehouses";
      }

      // Re-point historical snapshots from the holding_tank row to the new account row
      if (newRowId && newRowTable) {
        const updateCol = newRowTable === "vineyard_accounts" ? "vineyard_account_id" : "storehouse_id";
        await (supabase.from("account_harvest_snapshots") as any)
          .update({ holding_tank_id: null, [updateCol]: newRowId })
          .eq("holding_tank_id", moveTarget.id);
      }

      // Mark holding tank account as moved
      await (supabase.from("holding_tank" as any) as any)
        .update({ status: "moved" })
        .eq("id", moveTarget.id);

      toast.success(`Account moved to ${moveTarget.destination === "vineyard" ? "The Vineyard" : STOREHOUSE_CONFIG.find(s => s.num === moveTarget.storehouseNum)?.name}`);
      setMoveTarget(null);
      fetchAccounts();
      onAccountMoved?.();
    } catch (err: any) {
      toast.error("Failed to move account: " + err.message);
    } finally {
      setMoving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await (supabase.from("holding_tank" as any) as any).delete().eq("id", id);
    toast.success("Account removed from Holding Tank");
    fetchAccounts();
  };

  const handleScopeChange = async (id: string, scope: string) => {
    await (supabase.from("holding_tank" as any) as any)
      .update({ visibility_scope: scope })
      .eq("id", id);
    setAccounts(prev => prev.map(a => a.id === id ? { ...a, visibility_scope: scope } : a));
  };

  const handleDateChange = async (accountId: string, date: string) => {
    const val = date || null;
    await (supabase.from("holding_tank" as any) as any)
      .update({ expected_deposit_date: val })
      .eq("id", accountId);
    setAccounts(prev => prev.map(a => a.id === accountId ? { ...a, expected_deposit_date: val } : a));

    // Auto-create/update pipeline entry for this deposit
    const account = accounts.find(a => a.id === accountId);
    if (account && val && account.current_value) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Check if pipeline entry already exists for this holding tank account
        const { data: existing } = await supabase
          .from("business_pipeline")
          .select("id")
          .eq("contact_id", account.contact_id)
          .eq("category", "new_aum" as any)
          .eq("notes", `holding_tank:${accountId}`)
          .maybeSingle();

        if (existing) {
          await supabase
            .from("business_pipeline")
            .update({ amount: account.current_value, expected_close_date: val })
            .eq("id", existing.id);
        } else {
          await supabase.from("business_pipeline").insert({
            contact_id: account.contact_id,
            category: "new_aum" as any,
            status: "pending" as any,
            amount: account.current_value,
            expected_close_date: val,
            created_by: user.id,
            notes: `holding_tank:${accountId}`,
          });
        }
        toast.success("Pipeline updated with expected deposit");
      }
    }
  };

  const handleAddAccount = async () => {
    if (!addForm.account_name || !contactId) return;
    setAdding(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Get contact's household_id
      const { data: contact } = await supabase
        .from("contacts")
        .select("household_id")
        .eq("id", contactId)
        .single();

      const { error } = await (supabase.from("holding_tank" as any) as any).insert({
        contact_id: contactId,
        household_id: contact?.household_id || null,
        account_name: addForm.account_name,
        account_type: addForm.account_type,
        current_value: addForm.current_value ? parseFloat(addForm.current_value) : null,
        expected_deposit_date: addForm.expected_deposit_date || null,
        custodian: addForm.custodian || null,
        beneficiary_designation: addForm.beneficiary_designation || null,
        status: "holding",
        visibility_scope: "household_shared",
        source_file: "manual_entry",
      });
      if (error) throw error;

      // Sync to pipeline if amount and date provided
      if (addForm.current_value && addForm.expected_deposit_date) {
        await supabase.from("business_pipeline").insert({
          contact_id: contactId,
          category: "new_aum" as any,
          status: "pending" as any,
          amount: parseFloat(addForm.current_value),
          expected_close_date: addForm.expected_deposit_date,
          created_by: user.id,
          notes: `holding_tank:manual_deposit`,
        });
      }

      toast.success("Account added to Holding Tank");
      setAddForm({ account_name: "", account_type: "Portfolio", current_value: "", expected_deposit_date: "", custodian: "", beneficiary_designation: "" });
      setCustodianMode("");
      setShowAddForm(false);
      fetchAccounts();
      onAccountMoved?.();
    } catch (err: any) {
      toast.error("Failed to add account: " + err.message);
    } finally {
      setAdding(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const showCard = accounts.length > 0 || showAddForm;

  const totalValue = accounts.reduce((sum, a) => sum + (a.current_value || 0), 0);
  const totalBookValue = accounts.reduce((sum, a) => sum + (a.book_value || 0), 0);

  if (!showCard && !contactId) return null;

  return (
    <>
      <Card className="border-amber-500/30 bg-amber-50/5">
        <CardHeader className="pb-2 cursor-pointer select-none" onClick={() => setCollapsed((c) => !c)}>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Anchor className="h-5 w-5 text-amber-600" />
            The Holding Tank
            <div className="ml-auto flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              {accounts.length > 0 && (
                <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-800">
                  {accounts.length} account{accounts.length !== 1 ? "s" : ""}
                </Badge>
              )}
              {contactId && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setShowAddForm(!showAddForm)}
                >
                  {showAddForm ? <X className="h-3.5 w-3.5 mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                  {showAddForm ? "Cancel" : "Add Account"}
                </Button>
              )}
              {collapsed ? (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Newly parsed accounts awaiting Charter ratification. Move to The Vineyard or Storehouses when ready.
          </p>
          {totalValue > 0 && (
            <div className="flex gap-4 mt-1">
              <span className="text-sm font-medium">Current: {formatCurrency(totalValue)}</span>
              {totalBookValue > 0 && (
                <span className="text-sm text-muted-foreground">Beginning of Year: {formatCurrency(totalBookValue)}</span>
              )}
            </div>
          )}
        </CardHeader>
        {(!collapsed || showAddForm) && (
        <CardContent className="space-y-2">
          {showAddForm && (
            <div className="rounded-md border border-dashed border-amber-500/40 bg-amber-50/10 p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">New Manual Deposit</p>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Account name *"
                  className="h-8 text-xs"
                  value={addForm.account_name}
                  onChange={(e) => setAddForm(f => ({ ...f, account_name: e.target.value }))}
                />
                <Select
                  value={custodianMode}
                  onValueChange={(val) => {
                    setCustodianMode(val);
                    setAddForm(f => ({ ...f, custodian: val === "Other" ? "" : val }));
                  }}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Custodian" />
                  </SelectTrigger>
                  <SelectContent>
                    {CUSTODIAN_OPTIONS.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {custodianMode === "Other" && (
                  <Input
                    placeholder="Custodian name"
                    className="h-8 text-xs col-span-2"
                    value={addForm.custodian}
                    onChange={(e) => setAddForm(f => ({ ...f, custodian: e.target.value }))}
                  />
                )}
                <Input
                  placeholder="Expected amount"
                  type="number"
                  className="h-8 text-xs"
                  value={addForm.current_value}
                  onChange={(e) => setAddForm(f => ({ ...f, current_value: e.target.value }))}
                />
                <Input
                  type="date"
                  className="h-8 text-xs"
                  value={addForm.expected_deposit_date}
                  onChange={(e) => setAddForm(f => ({ ...f, expected_deposit_date: e.target.value }))}
                />
                <Input
                  placeholder="Beneficiary designation (e.g. Estate, or a named person)"
                  className="h-8 text-xs col-span-2"
                  value={addForm.beneficiary_designation}
                  onChange={(e) => setAddForm(f => ({ ...f, beneficiary_designation: e.target.value }))}
                />
              </div>
              <div className="flex items-center gap-2">
                <Select value={addForm.account_type} onValueChange={(val) => setAddForm(f => ({ ...f, account_type: val }))}>
                  <SelectTrigger className="h-8 text-xs flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Portfolio">Portfolio</SelectItem>
                    <SelectItem value="RRSP">RRSP</SelectItem>
                    <SelectItem value="TFSA">TFSA</SelectItem>
                    <SelectItem value="RESP">RESP</SelectItem>
                    <SelectItem value="RRIF">RRIF</SelectItem>
                    <SelectItem value="Non-Registered">Non-Registered</SelectItem>
                    <SelectItem value="Corporate">Corporate</SelectItem>
                    <SelectItem value="LIRA">LIRA</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  disabled={!addForm.account_name || adding}
                  onClick={handleAddAccount}
                >
                  {adding && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add
                </Button>
              </div>
            </div>
          )}
          {accounts.map((account) => (
            <HoldingTankRow
              key={account.id}
              account={account}
              webforms={webforms}
              onMove={(destination, storehouseNum) =>
                setMoveTarget({ id: account.id, destination, storehouseNum })
              }
              onDelete={() => handleDelete(account.id)}
              onScopeChange={handleScopeChange}
              onDateChange={handleDateChange}
            />
          ))}
          {accounts.length === 0 && !showAddForm && (
            <p className="text-xs text-muted-foreground text-center py-4">No staged accounts. Click "Add Account" to manually enter a deposit.</p>
          )}
        </CardContent>
        )}
      </Card>

      <AlertDialog open={!!moveTarget} onOpenChange={(open) => !open && setMoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Account Move</AlertDialogTitle>
            <AlertDialogDescription>
              Move "{accounts.find(a => a.id === moveTarget?.id)?.account_name}" to{" "}
              {moveTarget?.destination === "vineyard"
                ? "The Vineyard"
                : STOREHOUSE_CONFIG.find(s => s.num === moveTarget?.storehouseNum)?.name}
              ? This action can be reversed by your advisor team.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={moving}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleMove} disabled={moving}>
              {moving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Move Account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface SnapshotSummary {
  snapshot_date: string;
  boy_value: number | null;
  current_value: number | null;
  current_harvest: number | null;
  ytd_value: number | null;
  ror_ytd: number | null;
  ror_6m: number | null;
  ror_1y: number | null;
  ror_3y: number | null;
  ror_5y: number | null;
  ror_since_inception: number | null;
}

function HoldingTankRow({
  account,
  webforms,
  onMove,
  onDelete,
  onScopeChange,
  onDateChange,
}: {
  account: HoldingTankAccount;
  webforms: WebFormRecord[];
  onMove: (destination: string, storehouseNum?: number) => void;
  onDelete: () => void;
  onScopeChange: (id: string, scope: string) => void;
  onDateChange: (id: string, date: string) => void;
}) {
  const [destination, setDestination] = useState<string>("");
  const [openWebformId, setOpenWebformId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState(false);
  const [valueDraft, setValueDraft] = useState<string>("");
  const [savingValue, setSavingValue] = useState(false);
  const [snapshot, setSnapshot] = useState<SnapshotSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    (supabase.from("account_harvest_snapshots") as any)
      .select("snapshot_date, boy_value, current_value, current_harvest, ytd_value, ror_ytd, ror_6m, ror_1y, ror_3y, ror_5y, ror_since_inception")
      .eq("holding_tank_id", account.id)
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }: any) => {
        if (!cancelled && data) setSnapshot(data as SnapshotSummary);
      });
    return () => { cancelled = true; };
  }, [account.id]);

  const saveValue = async () => {
    const parsed = valueDraft.trim() === "" ? null : Number(valueDraft.replace(/[^0-9.\-]/g, ""));
    if (parsed !== null && Number.isNaN(parsed)) {
      toast.error("Enter a valid number.");
      return;
    }
    setSavingValue(true);
    const { error } = await (supabase.from("holding_tank" as any) as any)
      .update({ current_value: parsed })
      .eq("id", account.id);
    setSavingValue(false);
    if (error) {
      toast.error("Failed to update balance.");
    } else {
      toast.success("Balance updated.");
      account.current_value = parsed;
      setEditingValue(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{account.account_name}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
            {account.account_number && (
              <span className="text-xs text-muted-foreground">#{account.account_number}</span>
            )}
            {account.custodian && (
              <span className="text-xs text-muted-foreground">{account.custodian}</span>
            )}
            {account.account_owner && (
              <span className="text-xs text-muted-foreground">{account.account_owner}</span>
            )}
            <Badge variant="outline" className="text-[10px] h-4">
              {account.account_type}
            </Badge>
          </div>
        </div>
        <div className="text-right shrink-0">
          {editingValue ? (
            <div className="flex items-center gap-1">
              <Input
                autoFocus
                type="number"
                value={valueDraft}
                onChange={(e) => setValueDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); saveValue(); }
                  if (e.key === "Escape") { e.preventDefault(); setEditingValue(false); }
                }}
                className="h-7 w-28 text-xs"
                disabled={savingValue}
              />
              <button
                type="button"
                onClick={saveValue}
                disabled={savingValue}
                className="text-[10px] text-primary hover:underline"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditingValue(false)}
                className="text-[10px] text-muted-foreground hover:underline"
              >
                Cancel
              </button>
            </div>
          ) : (
            <p
              role="button"
              tabIndex={0}
              onClick={() => {
                setValueDraft(account.current_value == null ? "" : String(account.current_value));
                setEditingValue(true);
              }}
              className="text-sm font-semibold cursor-text px-1 rounded hover:bg-muted inline-block"
              title="Click to edit balance"
            >
              {account.current_value != null ? formatCurrency(account.current_value) : "—"}
            </p>
          )}
          {account.book_value != null && (
            <p className="text-xs text-muted-foreground">Beginning of Year: {formatCurrency(account.book_value)}</p>
          )}
        </div>
      </div>

      <WithdrawalAvailableLine
        bookValue={account.book_value}
        currentValue={account.current_value}
        incomeFundsValue={account.income_funds_value}
        incomeFundsAsOf={account.income_funds_as_of}
      />

      {snapshot && (
        <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 space-y-2">
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            <div>
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Beginning of Year</div>
              <div className="font-semibold tabular-nums">
                {snapshot.boy_value != null ? formatCurrency(Number(snapshot.boy_value)) : "—"}
              </div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Current Market</div>
              <div className="font-semibold tabular-nums">
                {snapshot.current_value != null ? formatCurrency(Number(snapshot.current_value)) : "—"}
              </div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">YTD Change</div>
              {(() => {
                const h = snapshot.current_harvest != null ? Number(snapshot.current_harvest) : null;
                const pct = snapshot.ytd_value != null ? Number(snapshot.ytd_value) : null;
                const pos = (h ?? 0) >= 0;
                return (
                  <div className={`font-semibold tabular-nums ${pos ? "text-green-600" : "text-destructive"}`}>
                    {h != null ? `${pos ? "+" : ""}${formatCurrency(h)}` : "—"}
                    {pct != null && (
                      <span className="ml-1 text-[10px] font-normal">({pos ? "+" : ""}{pct.toFixed(2)}%)</span>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          {[snapshot.ror_ytd, snapshot.ror_6m, snapshot.ror_1y, snapshot.ror_3y, snapshot.ror_5y, snapshot.ror_since_inception].some(v => v != null) && (
            <div>
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">Historical Rate of Return</div>
              <table className="w-full text-[10px] tabular-nums">
                <thead>
                  <tr className="text-muted-foreground border-b border-border/50">
                    <th className="text-right py-0.5 px-1 font-medium">YTD</th>
                    <th className="text-right py-0.5 px-1 font-medium">6 Mo</th>
                    <th className="text-right py-0.5 px-1 font-medium">1 Yr</th>
                    <th className="text-right py-0.5 px-1 font-medium">3 Yr</th>
                    <th className="text-right py-0.5 px-1 font-medium">5 Yr</th>
                    <th className="text-right py-0.5 px-1 font-medium">Since Inception</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {[snapshot.ror_ytd, snapshot.ror_6m, snapshot.ror_1y, snapshot.ror_3y, snapshot.ror_5y, snapshot.ror_since_inception].map((v, i) => {
                      const num = v == null ? null : Number(v);
                      return (
                        <td key={i} className={`text-right py-0.5 px-1 ${num == null ? "text-muted-foreground" : num >= 0 ? "text-green-600" : "text-destructive"}`}>
                          {num == null ? "—" : `${num >= 0 ? "+" : ""}${num.toFixed(2)}%`}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <div className="text-[9px] text-muted-foreground">
            Snapshot as of {format(new Date(snapshot.snapshot_date + "T00:00:00"), "MMM d, yyyy")}
          </div>
        </div>
      )}





      <div className="flex items-center gap-2">
        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground whitespace-nowrap">Expected:</span>
        <Input
          type="date"
          className="h-7 text-xs w-[140px]"
          value={account.expected_deposit_date || ""}
          onChange={(e) => onDateChange(account.id, e.target.value)}
        />
      </div>

      <div className="flex items-center gap-2">
        <Select value={account.visibility_scope || "household_shared"} onValueChange={(val) => onScopeChange(account.id, val)}>
          <SelectTrigger className="h-8 text-xs w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCOPE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                <span className="flex items-center gap-1.5">
                  <opt.icon className="h-3.5 w-3.5" /> {opt.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={destination} onValueChange={setDestination}>
          <SelectTrigger className="h-8 text-xs flex-1">
            <SelectValue placeholder="Move to…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="vineyard">
              <span className="flex items-center gap-1.5">
                <Grape className="h-3.5 w-3.5" /> The Vineyard
              </span>
            </SelectItem>
            {STOREHOUSE_CONFIG.map((s) => (
              <SelectItem key={s.num} value={`storehouse-${s.num}`}>
                <span className="flex items-center gap-1.5">
                  <s.icon className="h-3.5 w-3.5" /> {s.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="default"
          className="h-8 text-xs"
          disabled={!destination}
          onClick={() => {
            if (destination === "vineyard") {
              onMove("vineyard");
            } else {
              const num = parseInt(destination.replace("storehouse-", ""));
              onMove("storehouse", num);
            }
          }}
        >
          <ArrowRight className="h-3.5 w-3.5 mr-1" />
          Move
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {webforms
        .filter((f) => !f.custodian || f.custodian === account.custodian)
        .map((form) => (
          <Button
            key={form.id}
            size="sm"
            variant="outline"
            className="h-8 text-xs w-full"
            onClick={() => setOpenWebformId(form.id)}
          >
            <FileSignature className="h-3.5 w-3.5 mr-1.5" />
            {form.name}
          </Button>
        ))}
      <WebFormDialog
        open={!!openWebformId}
        onOpenChange={(open) => !open && setOpenWebformId(null)}
        webform={webforms.find((f) => f.id === openWebformId) || null}
        contactId={account.contact_id}
        accountNumber={account.account_number}
      />
    </div>
  );
}
