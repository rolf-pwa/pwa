// veem-service — staff-only bridge to Veem invoices (request money by email). Credentials stay server-side.
// Actions: status, getPayer, savePayer, sendInvoice, refreshInvoice, cancelInvoice, registerWebhook.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { veem, veemConfigured, veemErrorMessage } from "../_shared/veem.ts";
import { buildVeemInvoiceBody, mapVeemStatus, missingPayerFields, type VeemPayerDetails } from "../_shared/veem-invoice.ts";
import { syncPipelineForPaidInvoice } from "../_shared/invoice-pipeline.ts";
import { ensureInvoiceBooking, enrollFromPaidInvoice } from "../_shared/invoice-enrollment.ts";

const ALLOWED_ORIGINS = ["https://prosperwise-portal.web.app", "https://prosperwise.lovable.app", "https://app.prosperwise.ca", "https://id-preview--339dfc8f-3e82-4b05-8a36-a9f66fc58449.lovable.app"];
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
// deno-lint-ignore no-explicit-any
type Db = any;
const admin = (): Db => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function requireStaff(req: Request): Promise<{ ok: true } | { error: string }> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return { error: "Missing authorization header" };
  const { data, error } = await createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } }).auth.getUser();
  if (error || !data?.user) return { error: "Not authenticated" };
  if (!data.user.email?.endsWith("@prosperwise.ca")) return { error: "Not authorized" };
  return { ok: true };
}

const NOT_CONNECTED = { ok: false, error: "Veem is not connected yet. Add VEEM_CLIENT_ID and VEEM_CLIENT_SECRET." };

async function getPayer(db: Db, contactId: string) {
  const { data: contact } = await db.from("contacts").select("id, first_name, last_name, email, phone").eq("id", contactId).maybeSingle();
  if (!contact) return { ok: false, error: "Client not found" };
  const { data: saved } = await db.from("veem_payer_details").select("*").eq("contact_id", contactId).maybeSingle();
  // Pre-fill from the contact record where Veem's details have not been saved yet.
  const details = saved ?? { payer_type: "Personal", first_name: contact.first_name, last_name: contact.last_name, phone: contact.phone, country_code: "CA", phone_country_code: "+1" };
  return { ok: true, details, email: contact.email, saved: !!saved, missing: missingPayerFields(details, contact.email) };
}

const PAYER_FIELDS = ["payer_type", "first_name", "last_name", "phone", "phone_country_code", "country_code", "business_name", "industry", "sub_industry", "entity", "tax_id_number", "street", "city", "province", "postal_code", "address_country_code"] as const;

async function savePayer(db: Db, contactId: string, body: Record<string, unknown>) {
  const row: Record<string, unknown> = { contact_id: contactId, updated_at: new Date().toISOString() };
  for (const k of PAYER_FIELDS) if (typeof body[k] === "string") row[k] = (body[k] as string).trim() || null;
  if (row.payer_type !== "Business") row.payer_type = "Personal";
  const { error } = await db.from("veem_payer_details").upsert(row, { onConflict: "contact_id" });
  if (error) return { ok: false, error: error.message };
  return getPayer(db, contactId);
}

async function sendInvoice(db: Db, invoiceId: string) {
  const { data: inv } = await db.from("invoices").select("*, contact:contacts(id, email)").eq("id", invoiceId).maybeSingle();
  if (!inv) return { ok: false, error: "Invoice not found" };
  if (inv.veem_invoice_id && ["sent", "paid", "partially_paid"].includes(inv.status)) return { ok: false, error: "This invoice has already been sent." };
  const { data: lines } = await db.from("invoice_line_items").select("*").eq("invoice_id", invoiceId).order("sort_order");
  if (!lines?.length) return { ok: false, error: "Add at least one line item before sending." };
  if (!(Number(inv.total) > 0)) return { ok: false, error: "The invoice total must be more than zero." };

  const contactId = inv.contact?.id;
  if (!contactId) return { ok: false, error: "Assign a client to this invoice first." };
  const payer = await getPayer(db, contactId);
  if (!payer.ok) return payer;
  if (payer.missing!.length) return { ok: false, needsPayerDetails: true, missing: payer.missing, error: `Veem needs more about this client: ${payer.missing!.join(", ")}.` };

  const body = buildVeemInvoiceBody(inv, lines, inv.contact.email, payer.details as VeemPayerDetails);
  const res = await veem("/veem/v1.2/invoices", { method: "POST", body });
  if (!res.ok) {
    const message = veemErrorMessage(res.data);
    await db.from("invoices").update({ last_error: message }).eq("id", invoiceId);
    return { ok: false, error: message };
  }
  const created = res.data;
  const status = mapVeemStatus(created?.status);
  await db.from("invoices").update({
    veem_invoice_id: String(created.id), public_payment_url: created.claimLink || null, status: status === "draft" ? "sent" : status,
    sent_at: new Date().toISOString(), last_error: null, payment_method: "veem",
  }).eq("id", invoiceId);
  try { await ensureInvoiceBooking(db, invoiceId); } catch (e) { console.error("[veem sendInvoice] ensureInvoiceBooking failed:", e); }
  return { ok: true, publicUrl: created.claimLink ?? null, status };
}

async function applyStatus(db: Db, invoiceId: string, veemStatus: string, claimLink?: string | null) {
  const { data: inv } = await db.from("invoices").select("paid_at, public_payment_url").eq("id", invoiceId).maybeSingle();
  if (!inv) return null;
  const status = mapVeemStatus(veemStatus);
  await db.from("invoices").update({
    status, public_payment_url: claimLink || inv.public_payment_url, paid_at: status === "paid" ? inv.paid_at || new Date().toISOString() : inv.paid_at,
  }).eq("id", invoiceId);
  if (status === "paid") {
    await syncPipelineForPaidInvoice(db, invoiceId, "Veem");
    try { await enrollFromPaidInvoice(db, invoiceId); } catch (e) { console.error("[veem] enrollment failed:", e); }
  }
  return status;
}

async function refreshInvoice(db: Db, invoiceId: string) {
  const { data: inv } = await db.from("invoices").select("veem_invoice_id").eq("id", invoiceId).maybeSingle();
  if (!inv?.veem_invoice_id) return { ok: false, error: "This invoice has not been sent to Veem yet." };
  const res = await veem(`/veem/v1.2/invoices/${inv.veem_invoice_id}`);
  if (!res.ok) return { ok: false, error: veemErrorMessage(res.data) };
  return { ok: true, status: await applyStatus(db, invoiceId, res.data?.status, res.data?.claimLink) };
}

async function cancelInvoice(db: Db, invoiceId: string) {
  const { data: inv } = await db.from("invoices").select("veem_invoice_id, status").eq("id", invoiceId).maybeSingle();
  if (!inv?.veem_invoice_id) return { ok: false, error: "This invoice has not been sent to Veem." };
  if (inv.status === "paid") return { ok: false, error: "A paid invoice can't be canceled." };
  const res = await veem(`/veem/v1.2/invoices/${inv.veem_invoice_id}/cancel`, { method: "POST" });
  if (!res.ok) return { ok: false, error: veemErrorMessage(res.data) };
  await db.from("invoices").update({ status: "canceled" }).eq("id", invoiceId);
  return { ok: true };
}

/** Registers this project's veem-webhook URL for invoice status changes (run once per environment). */
async function registerWebhook(callbackUrl: string) {
  const out: { event: string; ok: boolean; error?: string }[] = [];
  for (const event of ["OUTBOUND_INVOICE_STATUS_UPDATED", "INBOUND_INVOICE_STATUS_UPDATED"]) {
    const res = await veem("/veem/v1.2/webhooks", { method: "POST", body: { event, callbackURL: callbackUrl } });
    out.push({ event, ok: res.ok, error: res.ok ? undefined : veemErrorMessage(res.data) });
  }
  return { ok: out.some((o) => o.ok), results: out };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  const cors = { "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0], "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  const auth = await requireStaff(req);
  if ("error" in auth) return json({ ok: false, error: auth.error }, 401);
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "");
  const db = admin();
  try {
    if (action === "status") return json({ ok: true, configured: veemConfigured() });
    if (action === "getPayer") return json(await getPayer(db, String(body.contactId)));
    if (action === "savePayer") return json(await savePayer(db, String(body.contactId), body.details ?? {}));
    if (!veemConfigured()) return json(NOT_CONNECTED, 400);
    if (action === "sendInvoice") return json(await sendInvoice(db, String(body.invoiceId)));
    if (action === "refreshInvoice") return json(await refreshInvoice(db, String(body.invoiceId)));
    if (action === "cancelInvoice") return json(await cancelInvoice(db, String(body.invoiceId)));
    if (action === "registerWebhook") return json(await registerWebhook(`${SUPABASE_URL}/functions/v1/veem-webhook`));
    return json({ ok: false, error: `Unknown action "${action}"` }, 400);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
