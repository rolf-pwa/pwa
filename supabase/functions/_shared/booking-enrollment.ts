// booking-enrollment.ts
// When a public website booking is paid, turn the buyer into a real CRM record
// and enroll them in the Sovereignty Survey (document) workflow:
//   1. link/create a contact (matched on email)
//   2. create a family + household when the contact is brand new
//   3. leave the household in `stabilization` so the portal Audit checklist
//      renders for them, and notify staff to provision the vault.
//
// Idempotent: safe to call from both the Square webhook and the confirmation
// page fallback — it no-ops once the booking already has a contact_id.

import { square } from "./square.ts";
import { provisionClientFolderTree } from "./vault-provisioning.ts";

function splitName(fullName: string): { first: string; last: string } {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "New", last: "Client" };
  if (parts.length === 1) return { first: parts[0], last: parts[0] };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

/** Deep-scan a Square payload for the buyer's answer to a custom field. */
function findCustomFieldAnswer(node: unknown, titleMatch: RegExp): string | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findCustomFieldAnswer(item, titleMatch);
      if (hit) return hit;
    }
    return null;
  }
  const obj = node as Record<string, any>;
  const answer = obj.answer ?? obj.value ?? obj.text;
  if (typeof obj.title === "string" && titleMatch.test(obj.title) && typeof answer === "string" && answer.trim()) {
    return answer.trim();
  }
  for (const value of Object.values(obj)) {
    const hit = findCustomFieldAnswer(value, titleMatch);
    if (hit) return hit;
  }
  return null;
}

/**
 * Quick-pay links (/pay/:slug) let the buyer type their details once, on Square.
 * Pull those details back onto the booking so enrollment has a name + email.
 */
async function backfillBuyerFromSquare(client: any, booking: any): Promise<void> {
  if (!Deno.env.get("SQUARE_ACCESS_TOKEN")) return;

  let name = String(booking.requester_name || "").trim();
  let email = String(booking.requester_email || "").trim();
  let phone = String(booking.requester_phone || "").trim();

  if (booking.square_payment_id) {
    const res = await square(`/payments/${booking.square_payment_id}`);
    const p = res.data?.payment;
    if (res.ok && p) {
      email = email || String(p.buyer_email_address || "").trim();
      const ship = p.shipping_address || p.billing_address;
      const shipName = [ship?.first_name, ship?.last_name].filter(Boolean).join(" ").trim();
      name = name || shipName;
    }
  }

  if (booking.square_order_id) {
    const res = await square(`/orders/${booking.square_order_id}`);
    const order = res.data?.order;
    if (res.ok && order) {
      const recipient =
        order.fulfillments?.[0]?.shipment_details?.recipient ||
        order.fulfillments?.[0]?.pickup_details?.recipient ||
        order.fulfillments?.[0]?.delivery_details?.recipient;
      email = email || String(recipient?.email_address || "").trim();
      phone = phone || String(recipient?.phone_number || "").trim();
      name = name || String(recipient?.display_name || "").trim();
      name = name || findCustomFieldAnswer(order, /name/i) || "";
    }
  }

  if (booking.square_payment_link_id && !name) {
    const res = await square(`/online-checkout/payment-links/${booking.square_payment_link_id}`);
    if (res.ok) name = findCustomFieldAnswer(res.data?.payment_link, /name/i) || "";
  }

  // Last resort: derive something human from the email local part.
  if (!name && email) {
    name = email
      .split("@")[0]
      .replace(/[._-]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  }

  const patch: Record<string, unknown> = {};
  if (name && name !== booking.requester_name) patch.requester_name = name.slice(0, 120);
  if (email && email !== booking.requester_email) patch.requester_email = email.toLowerCase().slice(0, 200);
  if (phone && phone !== booking.requester_phone) patch.requester_phone = phone.slice(0, 40);
  if (Object.keys(patch).length) {
    await client.from("service_bookings").update(patch).eq("id", booking.id);
    Object.assign(booking, patch);
  }
}

async function staffUserId(client: any): Promise<string | null> {
  const { data } = await client
    .from("profiles")
    .select("user_id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.user_id ?? null;
}

/**
 * Payment is the only real conversion signal for a lead — someone can start
 * checkout and stop, and stay a pending lead for staff to follow up on by
 * phone; only an actual completed payment (whether the buyer finished it
 * themselves or staff walked them through it) should mark a lead converted.
 * Matches both lead sources by email, since a buyer's identity here is only
 * ever known by the email they paid with.
 */
async function convertMatchingLeads(client: any, email: string): Promise<void> {
  if (!email) return;
  try {
    await client
      .from("georgia2_leads")
      .update({ status: "converted_to_contact" })
      .ilike("email", email)
      .not("status", "in", "(converted_to_contact,dismissed)");
  } catch (e) {
    console.error("[enrollPaidBooking] georgia2_leads conversion update failed:", e);
  }
  try {
    await client
      .from("discovery_leads")
      .update({ sovereignty_status: "converted_to_contact" })
      .ilike("email", email)
      .not("sovereignty_status", "in", "(converted_to_contact,dismissed)");
  } catch (e) {
    console.error("[enrollPaidBooking] discovery_leads conversion update failed:", e);
  }
}

// Causal AI Platform, Phase 1: Georgia 2.0's catalyst maps onto the Hub &
// Spoke Ontology's event_spoke_type where a real Spoke exists for it —
// divorce_restructuring/sudden_windfall/insurance_settlement have no
// matching Spoke yet, so those stay unseeded rather than forced into a
// wrong fit. Deliberately not evaluated against the Causal DAG here — see
// _shared/causal-dag-evaluator.ts's own header comment: that only ever
// runs against an already-engaged household's real (staff-entered)
// assessment, never against a lead's pre-consent diagnostic answers.
const CATALYST_TO_SPOKE: Record<string, string | undefined> = {
  inheritance: "inheritance",
  founder_exit: "business_exit",
  growth_stage_founder: "pre_exit_growth",
  executive_exit: "executive_retirement",
};

/**
 * Seeds one household_ontology_assessments row from the lead's Georgia 2.0
 * diagnostic, for a brand-new household only (an existing household
 * re-booking already has its own real assessment history, if any). Almost
 * everything in the Hub (financial/relational/emotional state) has no
 * Georgia 2.0 equivalent and is deliberately left null rather than
 * fabricated -- this is provenance + the one field (bc_probate_exposure)
 * that genuinely maps 1:1, not a substitute for a real staff assessment.
 * Best-effort: never blocks enrollment if it fails.
 */
async function seedOntologyFromGeorgia2Lead(client: any, householdId: string, email: string): Promise<void> {
  if (!email) return;
  try {
    const { data: lead } = await client
      .from("georgia2_leads")
      .select("id, domain, catalyst, scale, answers, risk_scores_calculated, submitted_at")
      .ilike("email", email)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!lead) return;

    const spokeType = CATALYST_TO_SPOKE[lead.catalyst as string] ?? null;
    const eventSpokeData =
      spokeType === "inheritance"
        ? { bc_probate_exposure: (lead.answers as Record<string, unknown> | null)?.probate === "yes" }
        : null;

    await client.from("household_ontology_assessments").insert({
      household_id: householdId,
      event_spoke_type: spokeType,
      event_spoke_data: eventSpokeData,
      source_georgia2_lead_id: lead.id,
      seeded_from: {
        domain: lead.domain,
        catalyst: lead.catalyst,
        scale: lead.scale,
        answers: lead.answers,
        risk_scores_calculated: lead.risk_scores_calculated,
      },
    });
  } catch (e) {
    console.error("[enrollPaidBooking] Ontology seed from Georgia 2.0 lead failed (non-fatal):", e);
  }
}

export interface EnrollmentResult {
  contactId: string | null;
  householdId: string | null;
  created: boolean;
  vaultProvisioning?: "provisioned" | "failed" | "skipped";
}

export async function enrollPaidBooking(
  client: any,
  bookingId: string,
): Promise<EnrollmentResult> {
  const { data: booking } = await client
    .from("service_bookings")
    .select(
      "id, contact_id, requester_name, requester_email, requester_phone, service_id, payment_status, square_order_id, square_payment_id, square_payment_link_id",
    )
    .eq("id", bookingId)
    .maybeSingle();

  if (!booking) return { contactId: null, householdId: null, created: false };
  if (booking.contact_id) {
    return { contactId: booking.contact_id, householdId: null, created: false };
  }

  if (!booking.requester_email || !booking.requester_name) {
    try {
      await backfillBuyerFromSquare(client, booking);
    } catch (e) {
      console.error("[enrollPaidBooking] Square buyer backfill failed:", e);
    }
  }

  const email = String(booking.requester_email || "").trim().toLowerCase();

  // Never fall back to a nameless placeholder when we know their email: derive
  // something human from the local part instead of "New Client".
  let nameSource = String(booking.requester_name || "").trim();
  if (!nameSource && email) {
    nameSource = email
      .split("@")[0]
      .replace(/[._+-]+/g, " ")
      .replace(/\d+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  }
  const { first, last } = splitName(nameSource);
  const fullName = (first === last ? first : `${first} ${last}`).trim();




  // ---- 1. Existing contact by email -------------------------------------
  let contactId: string | null = null;
  let householdId: string | null = null;
  let created = false;

  if (email) {
    const { data: existing } = await client
      .from("contacts")
      .select("id, household_id")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();
    if (existing?.id) {
      contactId = existing.id;
      householdId = existing.household_id ?? null;
    }
  }

  // ---- 2. Create the sovereign tree for a brand-new buyer ----------------
  if (!contactId) {
    const createdBy = await staffUserId(client);
    if (!createdBy) {
      console.error("[enrollPaidBooking] no staff profile available for created_by");
      return { contactId: null, householdId: null, created: false };
    }

    const { data: family, error: famErr } = await client
      .from("families")
      .insert({ name: `${last} Family`, created_by: createdBy })
      .select("id")
      .maybeSingle();
    if (famErr || !family?.id) {
      console.error("[enrollPaidBooking] family insert failed:", famErr);
      return { contactId: null, householdId: null, created: false };
    }

    const { data: household, error: hhErr } = await client
      .from("households")
      .insert({
        family_id: family.id,
        label: `${last} Household`,
        governance_status: "stabilization",
        quiet_period_start_date: new Date().toISOString().slice(0, 10),
      })
      .select("id")
      .maybeSingle();
    if (hhErr || !household?.id) {
      console.error("[enrollPaidBooking] household insert failed:", hhErr);
      return { contactId: null, householdId: null, created: false };
    }
    householdId = household.id;

    const { data: contact, error: cErr } = await client
      .from("contacts")
      .insert({
        full_name: fullName,
        first_name: first,
        last_name: last,
        email: email || null,
        phone: booking.requester_phone || null,
        family_id: family.id,
        household_id: household.id,
        family_role: "head_of_family",
        quiet_period_start_date: new Date().toISOString().slice(0, 10),
        created_by: createdBy,
      })
      .select("id")
      .maybeSingle();
    if (cErr || !contact?.id) {
      console.error("[enrollPaidBooking] contact insert failed:", cErr);
      return { contactId: null, householdId: householdId, created: false };
    }
    contactId = contact.id;
    created = true;
  }

  // ---- 3. Convert any matching pending lead — see convertMatchingLeads() ----
  await convertMatchingLeads(client, email);

  // ---- 3b. Seed the Ontology from that same lead's diagnostic, brand-new households only ----
  if (created && householdId) {
    await seedOntologyFromGeorgia2Lead(client, householdId, email);
  }

  // ---- 4. Link the booking ----------------------------------------------
  await client.from("service_bookings").update({ contact_id: contactId }).eq("id", bookingId);

  // Anyone who pays for an Audit is a new client and gets the guided
  // onboarding flow. Legacy households stay opted out.
  if (householdId) {
    await client.from("households").update({ onboarding_enabled: true }).eq("id", householdId);
  }

  const { data: svc } = await client
    .from("services")
    .select("name")
    .eq("id", booking.service_id)
    .maybeSingle();

  // ---- 5. Provision the vault autonomously ------------------------------
  // The client should never wait on the office: build the Drive folder tree
  // (Family > Household > Vault + Advisor Files) directly, right away.
  // Failures never block enrollment — staff can re-provision from the
  // household's Vault page if this doesn't land.
  let vaultProvisioning: EnrollmentResult["vaultProvisioning"] = "skipped";
  if (householdId) {
    try {
      const result = await provisionClientFolderTree(client, householdId);
      vaultProvisioning = result.ok ? "provisioned" : "failed";
      if (!result.ok) console.error("[enrollPaidBooking] autonomous vault provisioning failed:", result.error);
    } catch (e) {
      vaultProvisioning = "failed";
      console.error("[enrollPaidBooking] autonomous vault provisioning threw:", e);
    }
  }

  // ---- 6. Tell staff ----------------------------------------------------
  const vaultNote =
    vaultProvisioning === "provisioned"
      ? "Vault folders were created automatically in Drive — their document checklist is ready in the portal."
      : vaultProvisioning === "failed"
        ? "Automatic vault provisioning FAILED — open the household's Vault page and click Provision Vault manually."
        : "Vault was already provisioned.";

  await client.from("staff_notifications").insert({
    title: created ? "New Audit client (paid online)" : "Audit booked by existing client",
    body: `${fullName}${email ? ` <${email}>` : ""} paid for ${svc?.name || "a service"}. ${
      created ? "Contact, family and household created." : "Booking linked to their existing record."
    } ${vaultNote}`,
    link: householdId ? `/households/${householdId}` : `/contacts/${contactId}`,
    contact_id: contactId,
    source_type: "booking_paid",
  });

  return { contactId, householdId, created, vaultProvisioning };
}
