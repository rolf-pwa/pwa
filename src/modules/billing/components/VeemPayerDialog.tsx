import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getInvoiceAgent } from "@/shared/lib/agents";
import type { VeemPayerDetails } from "@/shared/lib/agents/types";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";

type Form = Record<keyof VeemPayerDetails, string>;
const FIELDS: (keyof VeemPayerDetails)[] = ["payer_type", "first_name", "last_name", "phone", "phone_country_code", "country_code", "business_name", "industry", "sub_industry", "entity", "tax_id_number", "street", "city", "province", "postal_code", "address_country_code"];
const toForm = (d: VeemPayerDetails): Form => Object.fromEntries(FIELDS.map((k) => [k, d[k] ?? ""])) as Form;

/** The details Veem needs about a client before it will send them an invoice. Saved once per client and reused. */
export function VeemPayerDialog({ contactId, open, onClose, onSaved }: { contactId: string | null; open: boolean; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Form | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !contactId) return;
    setForm(null);
    getInvoiceAgent().getVeemPayer(contactId).then((s) => { setForm(toForm(s.details)); setEmail(s.email); setMissing(s.missing); }).catch((e) => toast.error(e.message));
  }, [open, contactId]);

  const set = (k: keyof VeemPayerDetails, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const save = async () => {
    if (!form || !contactId) return;
    setSaving(true);
    try {
      const s = await getInvoiceAgent().saveVeemPayer(contactId, form);
      setMissing(s.missing);
      if (s.missing.length) toast.error(`Still needed: ${s.missing.join(", ")}.`);
      else { toast.success("Saved. Sending the invoice…"); onSaved(); }
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't save"); }
    setSaving(false);
  };

  const business = form?.payer_type === "Business";
  const field = (k: keyof VeemPayerDetails, label: string, placeholder?: string) => (
    <div className="space-y-1"><Label className="text-xs">{label}</Label><Input placeholder={placeholder} value={form?.[k] ?? ""} onChange={(e) => set(k, e.target.value)} /></div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Veem needs a few details about this client</DialogTitle>
          <DialogDescription>Saved on the client and reused for every Veem invoice. The invoice goes to {email ?? "the client's email, which is missing on their record"}.</DialogDescription>
        </DialogHeader>
        {!form ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Paying as</Label>
              <Select value={form.payer_type} onValueChange={(v) => set("payer_type", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="Personal">An individual</SelectItem><SelectItem value="Business">A business</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">{field("first_name", "First name")}{field("last_name", "Last name")}</div>
            <div className="grid grid-cols-[6rem_1fr_6rem] gap-3">{field("phone_country_code", "Code", "+1")}{field("phone", "Phone")}{field("country_code", "Country", "CA")}</div>
            {business && (
              <>
                {field("business_name", "Business name")}
                <div className="grid grid-cols-2 gap-3">{field("industry", "Industry")}{field("sub_industry", "Sub-industry")}</div>
                <div className="grid grid-cols-2 gap-3">{field("entity", "Entity type", "Corporation")}{field("tax_id_number", "Tax ID")}</div>
                {field("street", "Street")}
                <div className="grid grid-cols-3 gap-3">{field("city", "City")}{field("province", "Province / state")}{field("postal_code", "Postal code")}</div>
                {field("address_country_code", "Address country", "CA")}
              </>
            )}
            {missing.length > 0 && <p className="text-xs text-muted-foreground">Still needed: {missing.join(", ")}.</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !form}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save and send</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
