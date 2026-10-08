import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/shared/integrations/supabase/client";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import { Switch } from "@/shared/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatMoney, round2 } from "../lib/money";

interface LineDraft {
  id?: string;
  service_id: string | null;
  description: string;
  quantity: string;
  unit_amount: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string | null;
  onSaved: () => void;
}

const emptyLine = (): LineDraft => ({ service_id: null, description: "", quantity: "1", unit_amount: "0" });

export function InvoiceDialog({ open, onOpenChange, invoiceId, onSaved }: Props) {
  const [contacts, setContacts] = useState<{ id: string; full_name: string; email: string | null }[]>([]);
  const [services, setServices] = useState<{ id: string; name: string; price: number; tax_rate?: number | null }[]>([]);
  const [contactId, setContactId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [discount, setDiscount] = useState("0");
  const [tax, setTax] = useState("0");
  const [taxRate, setTaxRate] = useState("5");
  const [autoTax, setAutoTax] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState<"card" | "e_transfer" | "either" | "veem">("either");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [readOnly, setReadOnly] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      const [{ data: contactData }, { data: serviceData }] = await Promise.all([
        supabase.from("contacts").select("id, full_name, email").order("full_name"),
        supabase.from("services" as any).select("id, name, price, tax_rate").eq("is_active", true).order("name"),
      ]);
      setContacts((contactData as any) || []);
      setServices((serviceData as any) || []);

      if (invoiceId) {
        const [{ data: inv }, { data: lineData }] = await Promise.all([
          supabase.from("invoices" as any).select("*").eq("id", invoiceId).maybeSingle(),
          supabase.from("invoice_line_items" as any).select("*").eq("invoice_id", invoiceId).order("sort_order"),
        ]);
        const invoice: any = inv;
        setContactId(invoice?.contact_id || "");
        setDueDate(invoice?.due_date || "");
        setNotes(invoice?.notes || "");
        setDiscount(String(invoice?.discount_amount ?? 0));
        setTax(String(invoice?.tax_amount ?? 0));
        setTaxRate(String(invoice?.tax_rate ?? 0));
        setPaymentMethod(
          invoice?.payment_method === "e_transfer"
            ? "e_transfer"
            : invoice?.payment_method === "card"
              ? "card"
              : invoice?.payment_method === "veem"
                ? "veem"
                : "either",
        );
        setAutoTax(Number(invoice?.tax_rate ?? 0) > 0);
        setReadOnly(Boolean(invoice && invoice.status !== "draft"));
        setLines(
          ((lineData as any[]) || []).map((l) => ({
            id: l.id,
            service_id: l.service_id,
            description: l.description,
            quantity: String(l.quantity),
            unit_amount: String(l.unit_amount),
          })),
        );
        if (!lineData?.length) setLines([emptyLine()]);
      } else {
        setContactId("");
        setDueDate("");
        setNotes("");
        setDiscount("0");
        setTax("0");
        setTaxRate("5");
        setPaymentMethod("card");
        setAutoTax(true);
        setReadOnly(false);
        setLines([emptyLine()]);
      }
      setLoading(false);
    })();
  }, [open, invoiceId]);

  /** Tax is charged on the invoice total (subtotal less discount), so custom
   *  items like a Virtual Family Office Fee are taxed the same as catalog items. */
  const computedTax = useMemo(() => {
    const subtotal = lines.reduce((acc, l) => acc + Number(l.quantity || 0) * Number(l.unit_amount || 0), 0);
    const taxable = Math.max(subtotal - Number(discount || 0), 0);
    return round2(taxable * (Number(taxRate || 0) / 100));
  }, [lines, discount, taxRate]);

  useEffect(() => {
    if (autoTax && !readOnly) setTax(String(computedTax));
  }, [autoTax, computedTax, readOnly]);

  const totals = useMemo(() => {
    const subtotal = round2(
      lines.reduce((acc, l) => acc + Number(l.quantity || 0) * Number(l.unit_amount || 0), 0),
    );
    const d = Number(discount || 0);
    const t = autoTax ? computedTax : Number(tax || 0);
    return { subtotal, discount: d, tax: t, total: round2(subtotal - d + t) };
  }, [lines, discount, tax, autoTax, computedTax]);


  const applyService = (index: number, serviceId: string) => {
    const svc = services.find((s) => s.id === serviceId);
    if (svc && Number(svc.tax_rate ?? 0) > 0) setTaxRate(String(svc.tax_rate));
    setLines((prev) =>
      prev.map((l, i) =>
        i === index
          ? {
              ...l,
              service_id: serviceId === "custom" ? null : serviceId,
              description: svc ? svc.name : l.description,
              unit_amount: svc ? String(svc.price) : l.unit_amount,
            }
          : l,
      ),
    );
  };


  const save = async () => {
    if (!contactId) {
      toast.error("Choose a client for this invoice.");
      return;
    }
    const cleanLines = lines.filter((l) => l.description.trim());
    if (!cleanLines.length) {
      toast.error("Add at least one line item.");
      return;
    }
    setSaving(true);

    const header = {
      contact_id: contactId,
      subtotal: totals.subtotal,
      discount_amount: totals.discount,
      tax_amount: totals.tax,
      tax_rate: autoTax ? Number(taxRate || 0) : 0,
      payment_method: paymentMethod,
      total: totals.total,
      due_date: dueDate || null,
      notes: notes.trim() || null,
    };


    let id = invoiceId;
    if (id) {
      const { error } = await supabase.from("invoices" as any).update(header).eq("id", id);
      if (error) {
        setSaving(false);
        toast.error(error.message);
        return;
      }
      await supabase.from("invoice_line_items" as any).delete().eq("invoice_id", id);
    } else {
      const { data, error } = await supabase
        .from("invoices" as any)
        .insert({ ...header, status: "draft" })
        .select("id")
        .maybeSingle();
      if (error || !data) {
        setSaving(false);
        toast.error(error?.message || "Could not create the invoice.");
        return;
      }
      id = (data as any).id;
    }

    const { error: lineError } = await supabase.from("invoice_line_items" as any).insert(
      cleanLines.map((l, i) => ({
        invoice_id: id,
        service_id: l.service_id,
        description: l.description.trim(),
        quantity: Number(l.quantity || 1),
        unit_amount: Number(l.unit_amount || 0),
        line_total: round2(Number(l.quantity || 1) * Number(l.unit_amount || 0)),
        sort_order: i,
      })),
    );
    setSaving(false);
    if (lineError) {
      toast.error(lineError.message);
      return;
    }
    toast.success("Draft saved");
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{invoiceId ? (readOnly ? "Invoice" : "Edit draft invoice") : "New invoice"}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Client</Label>
                <Select value={contactId} onValueChange={setContactId} disabled={readOnly}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a client" />
                  </SelectTrigger>
                  <SelectContent>
                    {contacts.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.full_name}
                        {c.email ? ` — ${c.email}` : " (no email)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="inv-due">Due date</Label>
                <Input
                  id="inv-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-2">
                <Label>Payment method</Label>
                <Select
                  value={paymentMethod}
                  onValueChange={(v) => setPaymentMethod(v as "card" | "e_transfer" | "either" | "veem")}
                  disabled={readOnly}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="either">Client's choice — card or e-Transfer</SelectItem>
                    <SelectItem value="card">Credit card (Square)</SelectItem>
                    <SelectItem value="e_transfer">Interac e-Transfer only</SelectItem>
                    <SelectItem value="veem">Bank payment (Veem)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {paymentMethod === "card"
                    ? "Sends through Square with a hosted card payment page."
                    : paymentMethod === "veem"
                      ? "Sends through Veem: the client gets an email with a link to pay by bank transfer, in CAD, USD, EUR or GBP, from Canada or abroad. Veem needs a few details about the client first."
                    : paymentMethod === "e_transfer"
                      ? "No Square charge — put your e-Transfer address in the notes, then mark the invoice paid when the funds land."
                      : "Sends through Square with a card payment page and e-Transfer instructions on the invoice. If they e-Transfer instead, mark it paid here."}
                </p>
              </div>
            </div>


            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Line items</Label>
                {!readOnly && (
                  <Button variant="ghost" size="sm" onClick={() => setLines((p) => [...p, emptyLine()])}>
                    <Plus className="mr-1 h-4 w-4" /> Add line
                  </Button>
                )}
              </div>
              {lines.map((line, index) => (
                <div key={index} className="grid grid-cols-12 gap-2 rounded-md border border-border p-3">
                  <div className="col-span-12 md:col-span-4 space-y-1">
                    <Label className="text-xs text-muted-foreground">Service</Label>
                    <Select
                      value={line.service_id ?? "custom"}
                      onValueChange={(v) => applyService(index, v)}
                      disabled={readOnly}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="custom">Custom item</SelectItem>
                        {services.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-12 md:col-span-4 space-y-1">
                    <Label className="text-xs text-muted-foreground">Description</Label>
                    <Input
                      value={line.description}
                      onChange={(e) =>
                        setLines((p) => p.map((l, i) => (i === index ? { ...l, description: e.target.value } : l)))
                      }
                      disabled={readOnly}
                    />
                  </div>
                  <div className="col-span-4 md:col-span-1 space-y-1">
                    <Label className="text-xs text-muted-foreground">Qty</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.5"
                      value={line.quantity}
                      onChange={(e) =>
                        setLines((p) => p.map((l, i) => (i === index ? { ...l, quantity: e.target.value } : l)))
                      }
                      disabled={readOnly}
                    />
                  </div>
                  <div className="col-span-5 md:col-span-2 space-y-1">
                    <Label className="text-xs text-muted-foreground">Unit</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.unit_amount}
                      onChange={(e) =>
                        setLines((p) => p.map((l, i) => (i === index ? { ...l, unit_amount: e.target.value } : l)))
                      }
                      disabled={readOnly}
                    />
                  </div>
                  <div className="col-span-3 md:col-span-1 flex items-end justify-end">
                    {!readOnly && lines.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setLines((p) => p.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="inv-disc">Discount (CAD)</Label>
                <Input
                  id="inv-disc"
                  type="number"
                  min="0"
                  step="0.01"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inv-tax-rate">Tax rate (%)</Label>
                <Input
                  id="inv-tax-rate"
                  type="number"
                  min="0"
                  step="0.001"
                  value={taxRate}
                  onChange={(e) => setTaxRate(e.target.value)}
                  disabled={readOnly || !autoTax}
                />
                <p className="text-xs text-muted-foreground">Applied to subtotal less discount.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="inv-tax">Tax / GST (CAD)</Label>
                <Input
                  id="inv-tax"
                  type="number"
                  min="0"
                  step="0.01"
                  value={autoTax ? String(computedTax) : tax}
                  onChange={(e) => setTax(e.target.value)}
                  disabled={readOnly || autoTax}
                />
                {!readOnly && (
                  <div className="flex items-center gap-2">
                    <Switch id="inv-auto-tax" checked={autoTax} onCheckedChange={setAutoTax} />
                    <Label htmlFor="inv-auto-tax" className="text-xs text-muted-foreground">
                      Calculate from rate
                    </Label>
                  </div>
                )}
              </div>
              <div className="rounded-md border border-border p-3 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span>{formatMoney(totals.subtotal)}</span>
                </div>
                <div className="mt-1 flex justify-between text-muted-foreground">
                  <span>Tax</span>
                  <span>{formatMoney(totals.tax)}</span>
                </div>
                <div className="mt-1 flex justify-between font-semibold">
                  <span>Total</span>
                  <span>{formatMoney(totals.total)}</span>
                </div>
              </div>
            </div>


            <div className="space-y-2">
              <Label htmlFor="inv-notes">Notes shown to the client</Label>
              <Textarea
                id="inv-notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={readOnly}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {!readOnly && (
            <Button onClick={save} disabled={saving || loading}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save draft
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
