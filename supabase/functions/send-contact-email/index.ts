// send-contact-email — staff compose-and-send to a contact, via the staff
// member's OWN connected Gmail account (not a shared inbox). Every link in
// the body is rewritten to route through email-track for click tracking,
// and a tracking pixel is appended for open tracking. Metadata only is
// stored (contact_emails/contact_email_links) -- the composed body itself
// is never persisted, since it already lands in the sender's own Gmail
// Sent folder (the existing ContactEmails history panel finds it there).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkOutboundPii } from "../_shared/pii-shield.ts";
import { getValidGoogleAccessToken } from "../_shared/google-token.ts";
import { buildRawEmail, base64UrlEncode } from "../_shared/gmail-mime.ts";

const GATEWAY_URL = "https://gmail.googleapis.com/gmail/v1";

const ALLOWED_ORIGINS = [
  "https://prosperwise-portal.web.app",
  "https://prosperwise.lovable.app",
  "https://app.prosperwise.ca",
  "https://id-preview--339dfc8f-3e82-4b05-8a36-a9f66fc58449.lovable.app",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

async function requireStaff(req: Request): Promise<{ userId: string; email: string; error?: undefined } | { error: string }> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return { error: "Missing authorization header" };
  const supabaseUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await supabaseUser.auth.getUser();
  if (error || !data?.user) return { error: "Not authenticated" };
  if (!data.user.email?.endsWith("@prosperwise.ca")) return { error: "Not authorized" };
  return { userId: data.user.id, email: data.user.email };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const URL_PATTERN = /https?:\/\/\S+/g;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const auth = await requireStaff(req);
    if (auth.error) return json({ error: auth.error }, 401);
    const { userId, email: staffEmail } = auth;

    const db = admin();
    const body = await req.json().catch(() => ({}));
    const contactId = String(body?.contactId || "");
    const subject = String(body?.subject || "").trim();
    const draft = String(body?.body || "").trim();

    if (!contactId || !subject || !draft) {
      return json({ error: "contactId, subject, and body are required" }, 400);
    }

    const { data: contact, error: contactErr } = await db
      .from("contacts")
      .select("id, email, first_name, last_name")
      .eq("id", contactId)
      .maybeSingle();
    if (contactErr) return json({ error: contactErr.message }, 500);
    if (!contact) return json({ error: "Contact not found" }, 404);
    if (!contact.email) return json({ error: "This contact has no email address on file" }, 400);

    // PII Shield -- dollar amounts are routine advisor-client correspondence
    // here (confirmed with Rolf), so that one rule is relaxed for this path
    // only; every other check (SIN, account numbers, health terms, digit
    // runs) still blocks exactly as everywhere else in the app.
    const pii = checkOutboundPii(`${subject}\n${draft}`, { skipDollarAmountRule: true });
    if (pii.blocked) {
      console.warn(`[send-contact-email] PII Shield blocked: ${pii.reason} (${pii.matched})`);
      return json({ error: "PII Shield blocked", reason: pii.reason }, 422);
    }

    const { data: profile } = await db
      .from("profiles")
      .select("full_name, email, email_signature")
      .eq("user_id", userId)
      .maybeSingle();
    const from =
      profile?.full_name && profile?.email ? `${profile.full_name} <${profile.email}>` : undefined;

    const { data: emailRow, error: insertErr } = await db
      .from("contact_emails")
      .insert({
        contact_id: contactId,
        sender_user_id: userId,
        to_email: contact.email,
        subject,
      })
      .select("id, tracking_token")
      .single();
    if (insertErr || !emailRow) {
      return json({ error: insertErr?.message || "Could not record this send" }, 500);
    }

    // Register every link as its own row, then rewrite occurrences in order.
    // The click endpoint only ever resolves a target by this row's own id --
    // never accepts a destination URL in the request -- to avoid an
    // open-redirect vector on a publicly reachable endpoint.
    const trackBase = `${SUPABASE_URL}/functions/v1/email-track`;
    const matches = [...draft.matchAll(URL_PATTERN)].map((m) => m[0]);
    const linkIds: string[] = [];
    for (const url of matches) {
      const { data: linkRow, error: linkErr } = await db
        .from("contact_email_links")
        .insert({ email_id: emailRow.id, target_url: url })
        .select("id")
        .single();
      if (linkErr || !linkRow) {
        await db.from("contact_emails").delete().eq("id", emailRow.id);
        return json({ error: linkErr?.message || "Could not prepare this email's links" }, 500);
      }
      linkIds.push(linkRow.id);
    }

    let matchIndex = 0;
    const escapedWithLinks = escapeHtml(draft).replace(/https?:\/\/\S+/g, () => {
      const url = matches[matchIndex];
      const linkId = linkIds[matchIndex];
      matchIndex++;
      return `<a href="${trackBase}?action=click&l=${linkId}">${escapeHtml(url)}</a>`;
    });
    const htmlBody =
      escapedWithLinks.replace(/\n/g, "<br>") +
      `<img src="${trackBase}?action=pixel&t=${emailRow.tracking_token}" width="1" height="1" alt="" style="display:none;border:0" />`;

    const raw = buildRawEmail({
      from,
      to: [contact.email],
      subject,
      text: draft,
      html: htmlBody,
    });
    const rawEncoded = base64UrlEncode(raw);

    let accessToken: string;
    try {
      accessToken = await getValidGoogleAccessToken(db, userId);
    } catch (e) {
      await db.from("contact_emails").delete().eq("id", emailRow.id);
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[send-contact-email] Google token error:", msg);
      return json({ error: "Connect your Google account first, then try again." }, 400);
    }

    const gmRes = await fetch(`${GATEWAY_URL}/users/me/messages/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: rawEncoded }),
    });
    const gmBody = await gmRes.text();
    if (!gmRes.ok) {
      console.error(`[send-contact-email] Gmail API failed [${gmRes.status}]: ${gmBody}`);
      await db.from("contact_emails").delete().eq("id", emailRow.id);
      return json({ error: "Gmail send failed", status: gmRes.status }, 502);
    }

    const parsed = JSON.parse(gmBody);
    await db
      .from("contact_emails")
      .update({ gmail_message_id: parsed.id, gmail_thread_id: parsed.threadId })
      .eq("id", emailRow.id);

    console.log(`[send-contact-email] ${staffEmail} sent to ${contact.email} (id: ${parsed.id})`);
    return json({ sent: true, id: emailRow.id, gmailMessageId: parsed.id, threadId: parsed.threadId });
  } catch (e) {
    console.error("send-contact-email error:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
