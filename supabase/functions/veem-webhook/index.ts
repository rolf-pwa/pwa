// veem-webhook — receives Veem invoice status events, verifies the access-signature (HMAC-SHA256 keyed by the client id),
// and updates the invoice. A paid invoice runs the same follow-up as a paid Square invoice (pipeline row, enrollment).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mapVeemStatus, parseInvoiceEvent, verifyVeemSignature } from "../_shared/veem-invoice.ts";
import { syncPipelineForPaidInvoice } from "../_shared/invoice-pipeline.ts";
import { enrollFromPaidInvoice } from "../_shared/invoice-enrollment.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const rawBody = await req.text();
  if (!(await verifyVeemSignature(rawBody, req.headers.get("access-signature"), Deno.env.get("VEEM_CLIENT_ID")))) {
    console.error("veem-webhook: signature verification failed");
    return new Response("Invalid signature", { status: 401 });
  }
  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { return new Response("Invalid JSON", { status: 400 }); }

  const event = parseInvoiceEvent(body);
  if (!event) return new Response("ok"); // not an invoice event we handle
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    const { data: inv } = await db.from("invoices").select("id, paid_at").eq("veem_invoice_id", event.invoiceId).maybeSingle();
    if (!inv) return new Response("ok");
    const status = mapVeemStatus(event.status);
    await db.from("invoices").update({ status, paid_at: status === "paid" ? inv.paid_at || new Date().toISOString() : inv.paid_at }).eq("id", inv.id);
    if (status === "paid") {
      await syncPipelineForPaidInvoice(db, inv.id, "Veem");
      try { await enrollFromPaidInvoice(db, inv.id); } catch (e) { console.error("veem-webhook enrollment failed:", e); }
    }
    return new Response("ok");
  } catch (e) {
    console.error("veem-webhook error:", e instanceof Error ? e.message : String(e));
    return new Response("error", { status: 500 }); // Veem retries up to three times
  }
});
