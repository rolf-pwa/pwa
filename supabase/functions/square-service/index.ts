// square-service — staff-only Square Catalog + Invoices bridge.
// All Square credentials stay server-side; the browser only sends action + ids.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  square,
  squareErrorMessage,
  squareLocationId,
  idempotencyKey,
  toMinor,
  fromMinor,
  ensureSquareCustomer,
} from "../_shared/square.ts";
import { ensureInvoiceBooking, enrollFromPaidInvoice } from "../_shared/invoice-enrollment.ts";

const ALLOWED_ORIGINS = [
  "https://prosperwise-portal.web.app",
  "https://prosperwise.lovable.app",
  "https://app.prosperwise.ca",
  "https://id-preview--339dfc8f-3e82-4b05-8a36-a9f66fc58449.lovable.app",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowed =
    ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".lovable.app") || origin.endsWith(".lovableproject.com")
      ? origin
      : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-region",
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

async function requireStaff(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return { error: "Missing authorization header" };
  const supabaseUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await supabaseUser.auth.getUser();
  if (error || !data?.user) return { error: "Not authenticated" };
  return { userId: data.user.id };
}

function squareConfigured() {
  return Boolean(Deno.env.get("SQUARE_ACCESS_TOKEN") && Deno.env.get("SQUARE_LOCATION_ID"));
}

// ------------------------------------------------------------------ catalog

async function syncService(serviceId: string) {
  const db = admin();
  const { data: svc, error } = await db.from("services").select("*").eq("id", serviceId).maybeSingle();
  if (error || !svc) return { ok: false, error: "Service not found" };

  const variationId = svc.square_variation_id;
  const objectId = svc.square_catalog_object_id;

  let version: number | undefined;
  let existingVariationId: string | undefined;
  if (objectId) {
    const existing = await square(`/catalog/object/${objectId}`);
    if (existing.ok && existing.data?.object) {
      version = existing.data.object.version;
      existingVariationId =
        existing.data.object.item_data?.variations?.[0]?.id || variationId || undefined;
    }
  }

  const itemRef = objectId || "#item";
  const varRef = existingVariationId || variationId || "#variation";

  const body = {
    idempotency_key: idempotencyKey(),
    object: {
      type: "ITEM",
      id: itemRef,
      version,
      present_at_all_locations: true,
      item_data: {
        name: svc.name,
        description: svc.description || undefined,
        product_type: "APPOINTMENTS_SERVICE",
        variations: [
          {
            type: "ITEM_VARIATION",
            id: varRef,
            version: version && existingVariationId ? undefined : undefined,
            present_at_all_locations: true,
            item_variation_data: {
              item_id: itemRef,
              name: svc.category || "Standard",
              pricing_type: "FIXED_PRICING",
              price_money: { amount: toMinor(svc.price), currency: svc.currency || "CAD" },
              service_duration: svc.duration_minutes ? svc.duration_minutes * 60 * 1000 : undefined,
            },
          },
        ],
      },
    },
  };

  const res = await square("/catalog/object", { method: "POST", body });
  if (!res.ok) {
    const message = squareErrorMessage(res.data);
    await db
      .from("services")
      .update({ square_sync_status: "error", square_sync_error: message })
      .eq("id", serviceId);
    return { ok: false, error: message };
  }

  const obj = res.data?.catalog_object;
  await db
    .from("services")
    .update({
      square_catalog_object_id: obj?.id ?? objectId,
      square_variation_id: obj?.item_data?.variations?.[0]?.id ?? variationId,
      square_sync_status: "synced",
      square_sync_error: null,
      square_synced_at: new Date().toISOString(),
    })
    .eq("id", serviceId);

  return { ok: true, squareId: obj?.id };
}

// ----------------------------------------------------------------- invoices

function mapSquareStatus(status?: string): string {
  switch ((status || "").toUpperCase()) {
    case "DRAFT":
      return "draft";
    case "UNPAID":
    case "SCHEDULED":
      return "sent";
    case "PARTIALLY_PAID":
      return "partially_paid";
    case "PAID":
      return "paid";
    case "PARTIALLY_REFUNDED":
    case "REFUNDED":
      return "refunded";
    case "CANCELED":
      return "canceled";
    case "FAILED":
      return "failed";
    default:
      return "sent";
  }
}

async function sendInvoice(invoiceId: string) {
  const db = admin();
  const { data: inv } = await db
    .from("invoices")
    .select("*, contact:contacts(id, full_name, email, phone)")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) return { ok: false, error: "Invoice not found" };
  if (inv.square_invoice_id && ["sent", "paid", "partially_paid"].includes(inv.status)) {
    return { ok: false, error: "This invoice has already been sent." };
  }

  const { data: lines } = await db
    .from("invoice_line_items")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("sort_order");
  if (!lines?.length) return { ok: false, error: "Add at least one line item before sending." };

  const contact: any = inv.contact;
  const cust = await ensureSquareCustomer({
    email: contact?.email,
    fullName: contact?.full_name,
    phone: contact?.phone,
  });
  if (!cust.customerId) return { ok: false, error: cust.error || "Could not resolve a Square customer." };

  const currency = inv.currency || "CAD";
  const subtotal = Number(inv.subtotal || 0);
  const discount = Number(inv.discount_amount || 0);
  const tax = Number(inv.tax_amount || 0);

  const order: Record<string, unknown> = {
    location_id: squareLocationId(),
    customer_id: cust.customerId,
    line_items: lines.map((l: any) => ({
      name: String(l.description).slice(0, 500),
      quantity: String(Number(l.quantity || 1)),
      base_price_money: { amount: toMinor(l.unit_amount), currency },
      note: l.service_id ? undefined : undefined,
    })),
  };
  if (discount > 0) {
    (order as any).discounts = [
      { name: "Discount", amount_money: { amount: toMinor(discount), currency }, scope: "ORDER" },
    ];
  }
  if (tax > 0 && subtotal - discount > 0) {
    const pct = ((tax / (subtotal - discount)) * 100).toFixed(4);
    (order as any).taxes = [{ name: "Tax", percentage: pct, scope: "ORDER" }];
  }

  const orderRes = await square("/orders", {
    method: "POST",
    body: { idempotency_key: idempotencyKey(), order },
  });
  if (!orderRes.ok) {
    const message = squareErrorMessage(orderRes.data);
    await db.from("invoices").update({ last_error: message }).eq("id", invoiceId);
    return { ok: false, error: message };
  }
  const orderId = orderRes.data?.order?.id;

  const createRes = await square("/invoices", {
    method: "POST",
    body: {
      idempotency_key: idempotencyKey(),
      invoice: {
        location_id: squareLocationId(),
        order_id: orderId,
        primary_recipient: { customer_id: cust.customerId },
        payment_requests: [
          {
            request_type: "BALANCE",
            due_date: inv.due_date || undefined,
            automatic_payment_source: "NONE",
          },
        ],
        delivery_method: "EMAIL",
        accepted_payment_methods: { card: true, square_gift_card: false, bank_account: false },
        title: inv.invoice_number ? `Invoice ${inv.invoice_number}` : "Invoice",
        description:
          inv.payment_method === "either"
            ? [inv.notes, "You may also pay by Interac e-Transfer — reply to this invoice for details."]
                .filter(Boolean)
                .join("\n\n")
            : inv.notes || undefined,
      },
    },
  });
  if (!createRes.ok) {
    const message = squareErrorMessage(createRes.data);
    await db.from("invoices").update({ last_error: message, square_order_id: orderId }).eq("id", invoiceId);
    return { ok: false, error: message };
  }

  const draft = createRes.data?.invoice;
  const publishRes = await square(`/invoices/${draft.id}/publish`, {
    method: "POST",
    body: { idempotency_key: idempotencyKey(), version: draft.version },
  });
  if (!publishRes.ok) {
    const message = squareErrorMessage(publishRes.data);
    await db
      .from("invoices")
      .update({
        square_invoice_id: draft.id,
        square_order_id: orderId,
        square_version: draft.version,
        last_error: message,
      })
      .eq("id", invoiceId);
    return { ok: false, error: message };
  }

  const published = publishRes.data?.invoice;
  await db
    .from("invoices")
    .update({
      square_invoice_id: published.id,
      square_order_id: orderId,
      square_version: published.version,
      public_payment_url: published.public_url || null,
      invoice_number: published.invoice_number || inv.invoice_number,
      status: mapSquareStatus(published.status),
      sent_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", invoiceId);

  try {
    await ensureInvoiceBooking(db, invoiceId);
  } catch (e) {
    console.error("[sendInvoice] ensureInvoiceBooking failed:", e);
  }

  return { ok: true, publicUrl: published.public_url, status: mapSquareStatus(published.status) };
}

async function refreshInvoice(invoiceId: string) {
  const db = admin();
  const { data: inv } = await db.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
  if (!inv) return { ok: false, error: "Invoice not found" };
  if (!inv.square_invoice_id) return { ok: false, error: "This invoice has not been sent to Square yet." };

  const res = await square(`/invoices/${inv.square_invoice_id}`);
  if (!res.ok) return { ok: false, error: squareErrorMessage(res.data) };
  const sq = res.data?.invoice;
  const status = mapSquareStatus(sq?.status);

  await db
    .from("invoices")
    .update({
      status,
      square_version: sq?.version,
      public_payment_url: sq?.public_url || inv.public_payment_url,
      paid_at: status === "paid" ? inv.paid_at || new Date().toISOString() : inv.paid_at,
    })
    .eq("id", invoiceId);

  if (status === "paid") {
    await syncPipelineForPaidInvoice(invoiceId);
    await enrollFromPaidInvoice(db, invoiceId);
  }
  return { ok: true, status };
}

async function cancelInvoice(invoiceId: string) {
  const db = admin();
  const { data: inv } = await db.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
  if (!inv) return { ok: false, error: "Invoice not found" };

  if (inv.square_invoice_id) {
    const res = await square(`/invoices/${inv.square_invoice_id}/cancel`, {
      method: "POST",
      body: { version: inv.square_version },
    });
    if (!res.ok) return { ok: false, error: squareErrorMessage(res.data) };
  }
  await db.from("invoices").update({ status: "canceled" }).eq("id", invoiceId);
  return { ok: true };
}

/**
 * Permanently remove an invoice. Paid invoices are never deleted (they are
 * revenue records). Square drafts are deleted, published invoices are canceled
 * first so nothing keeps chasing the client for payment.
 */
async function deleteInvoice(invoiceId: string) {
  const db = admin();
  const { data: inv } = await db.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
  if (!inv) return { ok: false, error: "Invoice not found" };
  if (inv.status === "paid" || inv.status === "partially_paid") {
    return { ok: false, error: "Paid invoices can't be deleted — they're part of your revenue record." };
  }

  if (inv.square_invoice_id && squareConfigured()) {
    const current = await square(`/invoices/${inv.square_invoice_id}`);
    const sqStatus = String(current.data?.invoice?.status || "").toUpperCase();
    const version = current.data?.invoice?.version ?? inv.square_version;
    if (current.ok && sqStatus === "DRAFT") {
      await square(`/invoices/${inv.square_invoice_id}?version=${version}`, { method: "DELETE" });
    } else if (current.ok && !["CANCELED", "PAID", "REFUNDED"].includes(sqStatus)) {
      const res = await square(`/invoices/${inv.square_invoice_id}/cancel`, {
        method: "POST",
        body: { version },
      });
      if (!res.ok) return { ok: false, error: squareErrorMessage(res.data) };
    }
  }

  await db.from("invoice_payments").delete().eq("invoice_id", invoiceId);
  await db.from("invoice_line_items").delete().eq("invoice_id", invoiceId);
  if (inv.pipeline_id) await db.from("business_pipeline").delete().eq("id", inv.pipeline_id);
  const { error } = await db.from("invoices").delete().eq("id", invoiceId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Permanently remove a service. Removes the Square catalog item too. Services
 * with bookings attached are kept (deactivate them instead) so history survives.
 */
async function deleteService(serviceId: string) {
  const db = admin();
  const { data: svc } = await db.from("services").select("*").eq("id", serviceId).maybeSingle();
  if (!svc) return { ok: false, error: "Service not found" };

  const { count } = await db
    .from("service_bookings")
    .select("id", { count: "exact", head: true })
    .eq("service_id", serviceId);
  if ((count || 0) > 0) {
    return {
      ok: false,
      error: `This service has ${count} booking(s) attached. Mark it inactive instead so the history stays intact.`,
    };
  }

  if (svc.square_catalog_object_id && squareConfigured()) {
    await square(`/catalog/object/${svc.square_catalog_object_id}`, { method: "DELETE" });
  }

  const { error } = await db.from("services").delete().eq("id", serviceId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Manual payment (Interac e-Transfer, cheque, wire). No Square call — the
 * advisor confirms the funds landed, we record the payment and sync revenue.
 */
async function markPaidManually(invoiceId: string, reference?: string, amount?: number) {
  const db = admin();
  const { data: inv } = await db.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
  if (!inv) return { ok: false, error: "Invoice not found" };
  if (inv.status === "paid") return { ok: false, error: "This invoice is already marked paid." };
  if (inv.status === "canceled") return { ok: false, error: "This invoice was canceled." };

  const paidAt = new Date().toISOString();
  const paidAmount = Number(amount ?? inv.total ?? 0);

  const { error: payErr } = await db.from("invoice_payments").insert({
    invoice_id: invoiceId,
    amount: paidAmount,
    currency: inv.currency || "CAD",
    status: "completed",
    paid_at: paidAt,
    raw_payload: { source: "manual", method: inv.payment_method || "e_transfer", reference: reference || null },
  });
  if (payErr) return { ok: false, error: payErr.message };

  await db
    .from("invoices")
    .update({
      status: "paid",
      paid_at: paidAt,
      payment_reference: reference || null,
      sent_at: inv.sent_at || paidAt,
      last_error: null,
    })
    .eq("id", invoiceId);

  await syncPipelineForPaidInvoice(invoiceId);
  await enrollFromPaidInvoice(db, invoiceId);
  return { ok: true, status: "paid" };
}

/** e-Transfer invoices never touch Square — mark them issued so they show as outstanding. */
async function markSentManually(invoiceId: string) {
  const db = admin();
  const { data: inv } = await db.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
  if (!inv) return { ok: false, error: "Invoice not found" };
  if (inv.status !== "draft") return { ok: false, error: "Only draft invoices can be issued." };
  await db
    .from("invoices")
    .update({ status: "sent", sent_at: new Date().toISOString(), last_error: null })
    .eq("id", invoiceId);
  try {
    await ensureInvoiceBooking(db, invoiceId);
  } catch (e) {
    console.error("[markSentManually] ensureInvoiceBooking failed:", e);
  }
  return { ok: true, status: "sent" };
}


/** Paid invoice -> business_pipeline consulting revenue row. */
export async function syncPipelineForPaidInvoice(invoiceId: string) {
  const db = admin();
  const { data: inv } = await db.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
  if (!inv || !inv.contact_id) return;

  const payload = {
    contact_id: inv.contact_id,
    category: "pws_consulting",
    status: "completed",
    amount: Number(inv.total || 0),
    expected_close_date: (inv.paid_at || new Date().toISOString()).slice(0, 10),
    notes: `Square invoice ${inv.invoice_number || inv.square_invoice_id || inv.id}`,
  };

  if (inv.pipeline_id) {
    await db.from("business_pipeline").update(payload).eq("id", inv.pipeline_id);
    return;
  }
  const { data: created } = await db.from("business_pipeline").insert(payload).select("id").maybeSingle();
  if (created?.id) await db.from("invoices").update({ pipeline_id: created.id }).eq("id", invoiceId);
}

// -------------------------------------------------------------------- serve

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  try {
    const auth = await requireStaff(req);
    if (auth.error) return json({ ok: false, error: auth.error }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    if (action === "status") {
      return json({
        ok: true,
        configured: squareConfigured(),
        environment: (Deno.env.get("SQUARE_ENVIRONMENT") || "sandbox").toLowerCase(),
      });
    }

    // Manual (e-Transfer) actions work with or without Square configured.
    if (action === "markPaidManually") {
      return json(
        await markPaidManually(
          String(body.invoiceId),
          body.reference ? String(body.reference).slice(0, 200) : undefined,
          body.amount === undefined ? undefined : Number(body.amount),
        ),
      );
    }
    if (action === "markSentManually") {
      return json(await markSentManually(String(body.invoiceId)));
    }
    // Deletes work with or without Square — the Square cleanup is best-effort.
    if (action === "deleteInvoice") {
      return json(await deleteInvoice(String(body.invoiceId)));
    }
    if (action === "deleteService") {
      return json(await deleteService(String(body.serviceId)));
    }

    if (!squareConfigured()) {
      return json(
        { ok: false, error: "Square is not connected yet. Add SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID." },
        400,
      );
    }


    switch (action) {
      case "syncService":
        return json(await syncService(String(body.serviceId)));
      case "sendInvoice":
        return json(await sendInvoice(String(body.invoiceId)));
      case "refreshInvoice":
        return json(await refreshInvoice(String(body.invoiceId)));
      case "cancelInvoice":
        return json(await cancelInvoice(String(body.invoiceId)));
      default:
        return json({ ok: false, error: `Unknown action: ${action}` }, 400);
    }
  } catch (e) {
    console.error("square-service error:", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
