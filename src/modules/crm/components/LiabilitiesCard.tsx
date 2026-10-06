import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/shared/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/components/ui/alert-dialog";
import { Landmark, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

const LIABILITY_TYPE_LABELS: Record<string, string> = {
  mortgage: "Mortgage",
  personal_loan: "Personal Loan",
  line_of_credit: "Line of Credit",
  credit_card: "Credit Card",
  intercompany_loan: "Intercompany Loan",
  shareholder_loan: "Shareholder Loan",
  other_debt: "Other Debt",
};

const LOAN_TYPES = new Set(["intercompany_loan", "shareholder_loan"]);

interface Liability {
  id: string;
  liability_type: string;
  description: string;
  current_balance: number;
  due_date: string | null;
  counterparty_type: string | null;
  counterparty_contact_id: string | null;
  counterparty_corporation_id: string | null;
  counterparty_name?: string;
}

interface Props {
  holderType: "contact" | "corporation";
  holderId: string;
  onChanged?: () => void;
}

export function LiabilitiesCard({ holderType, holderId, onChanged }: Props) {
  const [liabilities, setLiabilities] = useState<Liability[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const [contacts, setContacts] = useState<{ id: string; name: string }[]>([]);
  const [corporations, setCorporations] = useState<{ id: string; name: string }[]>([]);

  const [type, setType] = useState("other_debt");
  const [description, setDescription] = useState("");
  const [balance, setBalance] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [counterpartyType, setCounterpartyType] = useState("external");
  const [counterpartyId, setCounterpartyId] = useState("");

  const fetchLiabilities = useCallback(async () => {
    const holderColumn = holderType === "contact" ? "contact_id" : "corporation_id";
    const { data, error } = await (supabase.from("liabilities" as any) as any)
      .select("*")
      .eq("holder_type", holderType)
      .eq(holderColumn, holderId)
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Failed to load liabilities.");
      setLoading(false);
      return;
    }
    const rows = (data || []) as any[];
    const contactIds = [...new Set(rows.filter((r) => r.counterparty_contact_id).map((r) => r.counterparty_contact_id))];
    const corpIds = [...new Set(rows.filter((r) => r.counterparty_corporation_id).map((r) => r.counterparty_corporation_id))];
    const [{ data: cpContacts }, { data: cpCorps }] = await Promise.all([
      contactIds.length
        ? supabase.from("contacts").select("id, first_name, last_name").in("id", contactIds)
        : Promise.resolve({ data: [] as any[] }),
      corpIds.length
        ? (supabase.from("corporations" as any) as any).select("id, name").in("id", corpIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const contactNameById: Record<string, string> = {};
    (cpContacts || []).forEach((c: any) => {
      contactNameById[c.id] = [c.first_name, c.last_name].filter(Boolean).join(" ");
    });
    const corpNameById: Record<string, string> = {};
    (cpCorps || []).forEach((c: any) => {
      corpNameById[c.id] = c.name;
    });
    setLiabilities(
      rows.map((r) => ({
        ...r,
        current_balance: Number(r.current_balance) || 0,
        counterparty_name: r.counterparty_contact_id
          ? contactNameById[r.counterparty_contact_id]
          : r.counterparty_corporation_id
            ? corpNameById[r.counterparty_corporation_id]
            : undefined,
      }))
    );
    setLoading(false);
  }, [holderType, holderId]);

  useEffect(() => {
    fetchLiabilities();
  }, [fetchLiabilities]);

  useEffect(() => {
    if (!showAdd || !LOAN_TYPES.has(type)) return;
    (async () => {
      const [{ data: c }, { data: corps }] = await Promise.all([
        supabase.from("contacts").select("id, first_name, last_name").order("first_name"),
        (supabase.from("corporations" as any) as any).select("id, name").order("name"),
      ]);
      setContacts((c || []).map((x: any) => ({ id: x.id, name: [x.first_name, x.last_name].filter(Boolean).join(" ") })));
      setCorporations((corps || []).map((x: any) => ({ id: x.id, name: x.name })));
    })();
  }, [showAdd, type]);

  const resetForm = () => {
    setType("other_debt");
    setDescription("");
    setBalance("");
    setDueDate("");
    setCounterpartyType("external");
    setCounterpartyId("");
  };

  const handleAdd = async () => {
    // The table requires created_by, and its insert policy only allows created_by = the signed-in user.
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      toast.error("You're signed out. Sign in again to save.");
      return;
    }
    const payload: Record<string, unknown> = {
      created_by: auth.user.id,
      holder_type: holderType,
      contact_id: holderType === "contact" ? holderId : null,
      corporation_id: holderType === "corporation" ? holderId : null,
      liability_type: type,
      description: description.trim(),
      current_balance: balance ? Number(balance) : 0,
      due_date: dueDate || null,
    };
    if (LOAN_TYPES.has(type)) {
      payload.counterparty_type = counterpartyType;
      payload.counterparty_contact_id = counterpartyType === "contact" ? counterpartyId || null : null;
      payload.counterparty_corporation_id = counterpartyType === "corporation" ? counterpartyId || null : null;
    }
    const { error } = await (supabase.from("liabilities" as any) as any).insert(payload);
    if (error) {
      toast.error("Failed to add liability.");
      return;
    }
    toast.success("Liability added.");
    resetForm();
    setShowAdd(false);
    fetchLiabilities();
    onChanged?.();
  };

  const handleDelete = async (liabilityId: string) => {
    const { error } = await (supabase.from("liabilities" as any) as any).delete().eq("id", liabilityId);
    if (error) {
      toast.error("Failed to delete liability.");
      return;
    }
    toast.success("Liability removed.");
    fetchLiabilities();
    onChanged?.();
  };

  const total = liabilities.reduce((sum, l) => sum + l.current_balance, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Landmark className="h-3.5 w-3.5 text-sanctuary-bronze" />
          Liabilities
        </CardTitle>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold tabular-nums">${total.toLocaleString()}</span>
          <Button size="sm" variant="outline" onClick={() => setShowAdd((v) => !v)}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {showAdd && (
          <div className="space-y-2 rounded-md border p-3">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(LIABILITY_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Current Balance ($)</Label>
                <Input type="number" value={balance} onChange={(e) => setBalance(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Description</Label>
              <Input
                placeholder="e.g. RBC Mortgage, Loan from Holdco"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Due Date (optional)</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            {LOAN_TYPES.has(type) && (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 rounded-md border border-dashed p-2">
                <div className="space-y-1">
                  <Label className="text-xs">Owed To</Label>
                  <Select value={counterpartyType} onValueChange={(v) => { setCounterpartyType(v); setCounterpartyId(""); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="external">External Lender</SelectItem>
                      <SelectItem value="corporation">A Corporation</SelectItem>
                      <SelectItem value="contact">An Individual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {counterpartyType === "corporation" && (
                  <div className="space-y-1">
                    <Label className="text-xs">Corporation</Label>
                    <Select value={counterpartyId} onValueChange={setCounterpartyId}>
                      <SelectTrigger><SelectValue placeholder="Select corporation" /></SelectTrigger>
                      <SelectContent>
                        {corporations.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {counterpartyType === "contact" && (
                  <div className="space-y-1">
                    <Label className="text-xs">Individual</Label>
                    <Select value={counterpartyId} onValueChange={setCounterpartyId}>
                      <SelectTrigger><SelectValue placeholder="Select individual" /></SelectTrigger>
                      <SelectContent>
                        {contacts.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-2">
              <Button size="sm" disabled={!description.trim()} onClick={handleAdd}>Add</Button>
              <Button size="sm" variant="ghost" onClick={() => { setShowAdd(false); resetForm(); }}>Cancel</Button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : liabilities.length === 0 ? (
          <p className="text-xs text-muted-foreground">No liabilities on file.</p>
        ) : (
          <div className="space-y-1">
            {liabilities.map((l) => (
              <div key={l.id} className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2">
                <div>
                  <div className="text-sm font-medium">{l.description}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {LIABILITY_TYPE_LABELS[l.liability_type] || l.liability_type}
                    {l.counterparty_name && <> · Owed to {l.counterparty_name}</>}
                    {l.due_date && <> · Due {l.due_date}</>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium tabular-nums">${l.current_balance.toLocaleString()}</span>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-7 w-7">
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove this liability?</AlertDialogTitle>
                        <AlertDialogDescription>
                          "{l.description}" will be permanently removed. This can't be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(l.id)}>Remove</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
