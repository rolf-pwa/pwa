// book-checkout — public book-and-pay endpoint.
// Creates a booking row server-side (never trusting client pricing) and returns
// a Square hosted checkout link for services that require prepayment.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enrollPaidBooking } from "../_shared/booking-enrollment.ts";
import { square, squareErrorMessage, squareLocationId, idempotencyKey, toMinor } from "../_shared/square.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-region",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function db() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

function clean(v: unknown, max = 300): string {
  return String(v ?? "").trim().slice(0, max);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "createCheckout");
    const client = db();

    // --- public status lookup for the confirmation page ------------------
    if (action === "status") {
      const bookingId = clean(body.bookingId, 60);
      if (!bookingId) return json({ ok: false, error: "bookingId is required" }, 400);
      const { data: bk } = await client
        .from("service_bookings")
        .select(
          "id, status, payment_status, total, currency, scheduling_url, service_id, paid_at, square_order_id, requester_name, requester_email",
        )
        .eq("id", bookingId)
        .maybeSingle();
      if (!bk) return json({ ok: false, error: "Booking not found" }, 404);

      // Fall back to Square if the webhook hasn't landed yet.
      if (
        bk.payment_status !== "paid" &&
        bk.square_order_id &&
        Deno.env.get("SQUARE_ACCESS_TOKEN")
      ) {
        const orderRes = await square(`/orders/${bk.square_order_id}`);
        const order = orderRes.data?.order;
        const paid =
          orderRes.ok &&
          (String(order?.state || "").toUpperCase() === "COMPLETED" ||
            Number(order?.net_amount_due_money?.amount ?? 1) === 0);
        if (paid) {
          const paidAt = bk.paid_at || new Date().toISOString();
          await client
            .from("service_bookings")
            .update({ payment_status: "paid", status: "confirmed", paid_at: paidAt })
            .eq("id", bk.id);
          bk.payment_status = "paid";
          bk.status = "confirmed";
          bk.paid_at = paidAt;
          try {
            await enrollPaidBooking(client, bk.id);
          } catch (e) {
            console.error("book-checkout enrollment failed:", e);
          }
        }
      }

      // Once the payment is verified we can safely hand the buyer a portal
      // session so they land straight in their guided onboarding — no OTP on
      // this first hop. Later visits use the normal email OTP login.
      let portalToken: string | null = null;
      if (bk.payment_status === "paid") {
        const { data: linked } = await client
          .from("service_bookings")
          .select("contact_id")
          .eq("id", bk.id)
          .maybeSingle();
        if (linked?.contact_id) {
          const { data: minted, error: mintErr } = await client
            .from("portal_tokens")
            .insert({ contact_id: linked.contact_id, created_by: linked.contact_id })
            .select("token")
            .maybeSingle();
          if (mintErr) console.error("book-checkout portal token mint failed:", mintErr.message);
          portalToken = minted?.token ?? null;
        }
      }

      return json({
        ok: true,
        portal_token: portalToken,
        booking: {
          id: bk.id,
          status: bk.status,
          payment_status: bk.payment_status,
          total: bk.total,
          currency: bk.currency,
          scheduling_url: bk.scheduling_url,
          requester_name: bk.requester_name,
          requester_email: bk.requester_email,
          paid_at: bk.paid_at,
        },
      });
    }


    if (action !== "createCheckout") return json({ ok: false, error: `Unknown action: ${action}` }, 400);

    // `quick: true` skips the in-app form: the buyer types their name/email/phone
    // once, on Square's hosted checkout page. We backfill the booking afterwards.
    const quick = Boolean(body.quick);
    const serviceId = clean(body.serviceId, 60);
    const serviceSlug = clean(body.serviceSlug, 120).toLowerCase();
    const requesterName = clean(body.name, 120);
    const requesterEmail = clean(body.email, 200).toLowerCase();
    const requesterPhone = clean(body.phone, 40);
    // Square requires E.164 for pre-populated phone; omit anything we can't normalize.
    const toE164 = (raw: string): string | undefined => {
      if (!raw) return undefined;
      const digits = raw.replace(/[^0-9]/g, "");
      if (raw.trim().startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
      if (digits.length === 10) return `+1${digits}`;
      if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
      return undefined;
    };
    const squarePhone = toE164(requesterPhone);
    const notes = clean(body.notes, 1000);
    const startsAtRaw = clean(body.startsAt, 60);
    const returnUrl = clean(body.returnUrl, 500);

    if (!serviceId && !serviceSlug) return json({ ok: false, error: "Please choose a service." }, 400);
    if (!quick) {
      if (requesterName.length < 2) return json({ ok: false, error: "Please enter your full name." }, 400);
      if (!EMAIL_RE.test(requesterEmail)) return json({ ok: false, error: "Please enter a valid email." }, 400);
    }

    const SVC_COLS =
      "id, name, slug, description, price, currency, duration_minutes, tax_rate, is_active, requires_prepayment, booking_url";
    let svc: any = null;
    if (serviceId) {
      const { data } = await client.from("services").select(SVC_COLS).eq("id", serviceId).maybeSingle();
      svc = data;
    } else {
      const { data } = await client.from("services").select(SVC_COLS).eq("slug", serviceSlug).maybeSingle();
      svc = data;
      // Tolerate mistyped/legacy handles (e.g. "sovereigny-audit-corporate")
      // by falling back to the closest active slug.
      if (!svc) {
        const { data: all } = await client.from("services").select(SVC_COLS).eq("is_active", true);
        const target = serviceSlug.replace(/[^a-z0-9]/g, "");
        const lev = (a: string, b: string) => {
          const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
          for (let i = 1; i <= a.length; i++) {
            let prev = dp[0];
            dp[0] = i;
            for (let j = 1; j <= b.length; j++) {
              const tmp = dp[j];
              dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
              prev = tmp;
            }
          }
          return dp[b.length];
        };
        let best: any = null;
        let bestScore = Infinity;
        for (const s of all || []) {
          const cand = String(s.slug || "").replace(/[^a-z0-9]/g, "");
          if (!cand) continue;
          const score = lev(target, cand);
          if (score < bestScore) {
            bestScore = score;
            best = s;
          }
        }
        if (best && bestScore <= Math.max(2, Math.round(target.length * 0.2))) {
          console.warn(`book-checkout slug fallback: "${serviceSlug}" -> "${best.slug}"`);
          svc = best;
        }
      }
    }
    if (!svc || !svc.is_active) return json({ ok: false, error: "That service is not available." }, 400);



    const price = Number(svc.price || 0);
    const taxRate = Number(svc.tax_rate || 0);
    const taxAmount = Math.round(price * (taxRate / 100) * 100) / 100;
    const total = Math.round((price + taxAmount) * 100) / 100;
    const currency = svc.currency || "CAD";
    const requiresPayment = Boolean(svc.requires_prepayment) && price > 0;

    let startsAt: string | null = null;
    if (startsAtRaw) {
      const d = new Date(startsAtRaw);
      if (!isNaN(d.getTime())) startsAt = d.toISOString();
    }

    const { data: booking, error: insertError } = await client
      .from("service_bookings")
      .insert({
        service_id: svc.id,
        requester_name: requesterName,
        requester_email: requesterEmail,
        requester_phone: requesterPhone || null,
        starts_at: startsAt,
        duration_minutes: svc.duration_minutes ?? null,
        notes: notes || null,
        status: requiresPayment ? "awaiting_payment" : "requested",
        payment_status: requiresPayment ? "unpaid" : "not_required",
        amount: price,
        tax_amount: taxAmount,
        total,
        currency,
        scheduling_url: svc.booking_url || null,
      })
      .select("id")
      .maybeSingle();

    if (insertError || !booking) {
      console.error("book-checkout insert failed:", insertError);
      return json({ ok: false, error: "We couldn't start that booking. Please try again." }, 500);
    }

    if (!requiresPayment) {
      if (quick) {
        return json({
          ok: false,
          error: "This service doesn't take online payment — please use the booking form.",
        }, 400);
      }
      return json({
        ok: true,
        bookingId: booking.id,
        requiresPayment: false,
        schedulingUrl: svc.booking_url || null,
      });
    }


    if (!Deno.env.get("SQUARE_ACCESS_TOKEN") || !Deno.env.get("SQUARE_LOCATION_ID")) {
      return json({ ok: false, error: "Online payment is not available right now." }, 400);
    }

    const redirectUrl = returnUrl
      ? `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}booking=${booking.id}`
      : undefined;

    const lineItem: Record<string, unknown> = {
      name: svc.name,
      quantity: "1",
      base_price_money: { amount: toMinor(price), currency },
    };
    if (taxRate > 0) {
      lineItem.applied_taxes = [{ tax_uid: "gst" }];
    }

    const buildBody = (prePopulated: Record<string, unknown> | undefined) => ({
      idempotency_key: idempotencyKey(),
      description: `Booking ${booking.id}`,
      order: {
        location_id: squareLocationId(),
        reference_id: booking.id,
        line_items: [lineItem],
        taxes:
          taxRate > 0
            ? [
                {
                  uid: "gst",
                  name: `Tax (${taxRate}%)`,
                  percentage: String(taxRate),
                  scope: "LINE_ITEM",
                  type: "ADDITIVE",
                },
              ]
            : undefined,
      },
      pre_populated_data: prePopulated,
      checkout_options: {
        allow_tipping: false,
        ask_for_shipping_address: false,
        redirect_url: redirectUrl,
        // In quick mode Square is the only place the buyer types anything, so ask
        // for their name there (email + phone are always collected by Square).
        custom_fields: quick ? [{ title: "Full name" }] : undefined,
      },
    });

    let res = await square("/online-checkout/payment-links", {
      method: "POST",
      body: buildBody(
        quick
          ? undefined
          : {
              buyer_email: requesterEmail || undefined,
              buyer_phone_number: squarePhone,
            },
      ),
    });


    // Square rejects some buyer contact values (test domains, odd phone formats).
    // Those are conveniences only, so retry once without them rather than failing the booking.
    if (!res.ok && res.status === 400) {
      console.warn(
        `book-checkout retrying without pre-populated buyer data: ${squareErrorMessage(res.data)}`,
      );
      res = await square("/online-checkout/payment-links", {
        method: "POST",
        body: buildBody(undefined),
      });
    }

    if (!res.ok) {
      const message = squareErrorMessage(res.data);
      console.error(`book-checkout payment link failed [${res.status}]: ${message}`);
      await client.from("service_bookings").update({ notes: notes || null }).eq("id", booking.id);
      return json({ ok: false, error: "We couldn't open the payment page. Please try again." }, 502);
    }

    const link = res.data?.payment_link;
    await client
      .from("service_bookings")
      .update({
        square_payment_link_id: link?.id || null,
        square_order_id: link?.order_id || null,
        checkout_url: link?.long_url || link?.url || null,
      })
      .eq("id", booking.id);

    return json({
      ok: true,
      bookingId: booking.id,
      requiresPayment: true,
      checkoutUrl: link?.long_url || link?.url || null,
      total,
      currency,
    });
  } catch (e) {
    console.error("book-checkout error:", e);
    return new Response(JSON.stringify({ ok: false, error: "Unexpected error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
