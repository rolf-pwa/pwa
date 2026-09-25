// georgia2-abandoned-cart — one gentle follow-up for Georgia leads who clicked
// "Start the Sovereignty Survey" but never paid. Called daily by pg_cron (see
// the scheduling migration) with a shared secret; there is no browser-facing
// path. A lead is eligible when it is still status = 'pending_survey_payment'
// (payment flips it to converted_to_contact via convertMatchingLeads), the
// click was 48h+ ago (but under 30 days), it has never been emailed, and it
// is not flagged Emergency_Override. abandoned_cart_sent_at is stamped only
// after a successful send, so a Gmail hiccup retries on the next run and a
// lead can never be emailed twice.
//
// Copy is static, keyed to the lead's spoke and primary friction (both
// captured deterministically by the diagnostic) -- no LLM involved.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { escapeHtml, GEORGIA_SENDER, sendServiceEmail } from "../_shared/service-email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("GEORGIA2_ABANDONED_CART_CRON_SECRET");

const WAIT_HOURS = 48;
const MAX_AGE_DAYS = 30;
const BATCH_LIMIT = 50;

const SURVEY_URL = "https://www.prosperwise.ca/sovereignty-audit#pricing";
const CLARITY_URL = "https://www.prosperwise.ca/clarity-call";

const SPOKE_LINE: Record<string, string> = {
  Business_Exit:
    "A business exit is one of the few moments where the order you do things in decides what you keep.",
  Pre_Exit_Growth:
    "The best exits are prepared for years before the deal. Looking at your structure now puts you ahead.",
  Inheritance: "An inheritance arrives with more than money. There is no deadline on getting your footing.",
  Divorce:
    "A separation resets the financial picture as much as the personal one — and you can rebuild it deliberately.",
  Executive_Retirement:
    "Leaving a senior role is a financial and personal reset at once, and the tax calendar doesn't wait for either.",
  Financial_Windfall:
    "Sudden money is easiest to protect in the first few weeks, before it starts to move.",
};
const DEFAULT_SPOKE_LINE =
  "A major financial transition is easiest to navigate when the structure is built before the decisions arrive.";

const FRICTION_LINE: Record<string, string> = {
  family_pressure:
    "You mentioned pressure from the people around you. One of the first things the Survey does is put a clear, documented boundary between your capital and everyone's opinions.",
  professional_pressure:
    "You mentioned being pulled in different directions by advisors and other professionals. The Survey gives you one independent view, with no products attached.",
  internal_paralysis:
    "You mentioned feeling stuck. That is completely normal — and the Survey is built so that no big decision is needed from you today.",
  operational_overload:
    "You mentioned being stretched thin. The Survey does the organizing for you: you bring the documents, we bring the structure.",
  liquidity_gap:
    "You mentioned most of your wealth being tied up on paper. The Survey maps what is actually accessible, and when.",
  no_friction:
    "You're approaching this from a steady place, which is the best position to build from.",
};

export function abandonedCartEmailHtml(firstName: string, spoke: string | null, friction: string | null): string {
  const spokeLine = (spoke && SPOKE_LINE[spoke]) || DEFAULT_SPOKE_LINE;
  const frictionLine = friction ? FRICTION_LINE[friction] : null;
  return `
    <div style="font-family:'DM Sans',sans-serif;color:#334155;max-width:520px;margin:0 auto;">
      <p style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;">Sovereignty Operating System™</p>
      <h2 style="font-family:'Cormorant Garamond',serif;font-weight:300;font-size:24px;color:#1e293b;margin:4px 0 16px;">Still here when you're ready</h2>
      <p style="font-size:14px;line-height:1.6;">Hi ${escapeHtml(firstName)},</p>
      <p style="font-size:14px;line-height:1.6;">You started your Sovereignty Survey after completing the diagnostic, and I didn't want it to slip away. ${escapeHtml(spokeLine)}</p>
      ${frictionLine ? `<p style="font-size:14px;line-height:1.6;">${escapeHtml(frictionLine)}</p>` : ""}
      <p style="font-size:14px;line-height:1.6;">The Survey is a working session built around exactly what you told Georgia. You can pick it up whenever you're ready:</p>
      <p style="margin:24px 0;"><a href="${SURVEY_URL}" style="background:#1e293b;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-size:14px;">Continue to the Sovereignty Survey</a></p>
      <p style="font-size:14px;line-height:1.6;">Prefer to talk it through first? <a href="${CLARITY_URL}" style="color:#a37c58;">Book a short clarity call</a> — no commitment.</p>
      <p style="font-size:14px;line-height:1.6;margin-top:24px;">— Rolf &amp; the ProsperWise team</p>
      <p style="font-size:11px;line-height:1.5;color:#94a3b8;margin-top:28px;border-top:1px solid #e2e8f0;padding-top:12px;">You're receiving this one follow-up because you completed the Sovereignty Diagnostic on prosperwise.ca. If you'd rather not hear from us, just reply to this email and we'll remove you.</p>
    </div>
  `.trim();
}

function isCronCaller(req: Request): boolean {
  if (!CRON_SECRET) return false;
  return req.headers.get("x-georgia2-cron-secret") === CRON_SECRET;
}

Deno.serve(async (req) => {
  if (!isCronCaller(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const now = Date.now();
  const cutoff = new Date(now - WAIT_HOURS * 3600 * 1000).toISOString();
  const oldest = new Date(now - MAX_AGE_DAYS * 24 * 3600 * 1000).toISOString();

  const { data: leads, error } = await db
    .from("georgia2_leads")
    .select("id, first_name, email, spoke, primary_friction")
    .eq("status", "pending_survey_payment")
    .is("abandoned_cart_sent_at", null)
    .lte("survey_clicked_at", cutoff)
    .gte("survey_clicked_at", oldest)
    .or("spoke.is.null,spoke.neq.Emergency_Override")
    .order("survey_clicked_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    console.error("[georgia2-abandoned-cart] query failed:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let sent = 0;
  let failed = 0;
  for (const lead of leads ?? []) {
    const ok = await sendServiceEmail(db, {
      to: lead.email,
      subject: "Your Sovereignty Survey — still here when you're ready",
      html: abandonedCartEmailHtml(lead.first_name, lead.spoke, lead.primary_friction),
      from: GEORGIA_SENDER,
    });
    if (ok) {
      await db
        .from("georgia2_leads")
        .update({ abandoned_cart_sent_at: new Date().toISOString() })
        .eq("id", lead.id);
      sent++;
    } else {
      failed++;
    }
  }

  return new Response(JSON.stringify({ eligible: leads?.length ?? 0, sent, failed }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
