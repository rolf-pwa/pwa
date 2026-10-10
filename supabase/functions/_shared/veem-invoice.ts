// Pure Veem invoice logic: the request body from our invoice and payer details, what is still missing, status mapping and
// webhook signature checking. No I/O, so it can be tested. Veem's API reference: https://developer.veem.com

export interface VeemPayerDetails {
  payer_type: "Personal" | "Business";
  first_name?: string | null; last_name?: string | null; phone?: string | null; phone_country_code?: string | null; country_code?: string | null;
  business_name?: string | null; industry?: string | null; sub_industry?: string | null; entity?: string | null; tax_id_number?: string | null;
  street?: string | null; city?: string | null; province?: string | null; postal_code?: string | null; address_country_code?: string | null;
}

const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

/** The payer details Veem still needs before an invoice can be sent. Names the fields in plain words. */
export function missingPayerFields(d: Partial<VeemPayerDetails> | null, email: string | null | undefined): string[] {
  const x = d ?? {};
  const out: string[] = [];
  const need = (ok: boolean, label: string) => { if (!ok) out.push(label); };
  need(!blank(email), "email address");
  need(!blank(x.first_name), "first name");
  need(!blank(x.last_name), "last name");
  need(!blank(x.phone), "phone");
  need(!blank(x.phone_country_code) && String(x.phone_country_code).startsWith("+"), "phone country code (with +)");
  need(!blank(x.country_code), "country");
  if (x.payer_type === "Business") {
    need(!blank(x.business_name), "business name");
    need(!blank(x.industry), "industry");
    need(!blank(x.sub_industry), "sub-industry");
    need(!blank(x.entity), "entity type");
    need(!blank(x.tax_id_number), "tax ID");
    need(!blank(x.street) && !blank(x.city) && !blank(x.province) && !blank(x.postal_code), "business address");
  }
  return out;
}

export interface InvoiceForVeem { id: string; total: number | string; currency: string | null; due_date: string | null; notes: string | null; invoice_number: string | null }
export interface LineForVeem { description: string; quantity: number | string; unit_amount: number | string }

const money = (n: number) => n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Veem invoices have no line items, so the lines go into the notes the payer sees. */
export function veemNotes(inv: InvoiceForVeem, lines: LineForVeem[]): string {
  const rows = lines.map((l) => `${l.description} — ${Number(l.quantity)} x ${money(Number(l.unit_amount))}`);
  return [inv.invoice_number ? `Invoice ${inv.invoice_number}` : "", ...rows, inv.notes ?? ""].filter(Boolean).join("\n").slice(0, 1000);
}

export function buildVeemInvoiceBody(inv: InvoiceForVeem, lines: LineForVeem[], payerEmail: string, d: VeemPayerDetails): Record<string, unknown> {
  const business = d.payer_type === "Business" || !blank(d.tax_id_number)
    ? {
        address: { countryCode: d.address_country_code || d.country_code, street: d.street, postalCode: d.postal_code, city: d.city, province: d.province },
        entity: d.entity, taxIdNumber: d.tax_id_number,
      }
    : undefined;
  return {
    payer: {
      type: d.payer_type, email: payerEmail, firstName: d.first_name, lastName: d.last_name, phone: d.phone, phoneCountryCode: d.phone_country_code,
      countryCode: d.country_code, businessName: d.payer_type === "Business" ? d.business_name : [d.first_name, d.last_name].filter(Boolean).join(" "),
      industry: d.industry || undefined, subIndustry: d.sub_industry || undefined, business,
    },
    amount: { number: Math.round(Number(inv.total) * 100) / 100, currency: (inv.currency || "CAD").toUpperCase() },
    notes: veemNotes(inv, lines),
    externalInvoiceRefId: inv.id,
    dueDate: inv.due_date || undefined,
  };
}

export type OurStatus = "draft" | "sent" | "paid" | "canceled" | "failed";

/** Veem invoice status -> ours. Claimed means the payer accepted and a payment is in flight: still outstanding. */
export function mapVeemStatus(status: string | null | undefined): OurStatus {
  switch (String(status ?? "").toLowerCase()) {
    case "markaspaid": return "paid";
    case "cancelled": case "canceled": case "rejected": return "canceled";
    case "closed": return "failed";
    case "drafted": case "scheduled": return "draft";
    default: return "sent"; // Sent, Claimed, Updated
  }
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));

/** Veem signs the raw payload with HMAC-SHA256 keyed by the client id (header access-signature). Hex or base64 is accepted. */
export async function verifyVeemSignature(rawBody: string, header: string | null, clientId: string | undefined): Promise<boolean> {
  if (!header || !clientId) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(clientId), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const given = header.trim();
  return given.toLowerCase() === hex(sig) || given === b64(sig);
}

/** Pulls the invoice id and status out of an invoice webhook, whether `data` is an object or a JSON string. */
export function parseInvoiceEvent(body: unknown): { type: string; invoiceId: string; status: string; paymentId: string | null } | null {
  const b = body as { type?: string; data?: unknown } | null;
  if (!b || typeof b.type !== "string" || !/INVOICE_STATUS_UPDATED$/.test(b.type)) return null;
  let d: any = b.data;
  if (typeof d === "string") { try { d = JSON.parse(d); } catch { return null; } }
  if (!d || d.id === undefined || d.id === null) return null;
  return { type: b.type, invoiceId: String(d.id), status: String(d.status ?? ""), paymentId: d.paymentId === undefined || d.paymentId === null ? null : String(d.paymentId) };
}
