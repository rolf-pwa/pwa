// Intercompany/Shareholder Loan Audit (CRA s.15(2)): a scheduled, firm-wide
// sweep of every shareholder/intercompany loan on file, surfaced proactively
// via a staff notification -- independent of whether anyone's looked at that
// household's Stabilization Map recently (the only other place
// computeIntercompanyLoanFlags is currently invoked, one household at a
// time). Dual-mode, mirroring daily-briefing-generate's exact
// isCronCaller/staff-JWT structure -- cron path for the quarterly schedule,
// interactive path for the Workbench's "Run Audit Now" button.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeIntercompanyLoanFlags, type LoanFlag } from "../_shared/sovereignty-diagnostics.ts";

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
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-quarterly-vfo-audit-cron-secret, x-region",
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("QUARTERLY_VFO_AUDIT_CRON_SECRET");

// Long enough that a normal quarterly cadence always re-notifies on a still-
// unresolved loan, short enough that a re-run within the same quarter
// (cron or a manual click) doesn't spam staff with the same flag again.
const RENOTIFY_AFTER_DAYS = 80;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

function isCronCaller(req: Request): boolean {
  if (!CRON_SECRET) return false;
  return req.headers.get("x-quarterly-vfo-audit-cron-secret") === CRON_SECRET;
}

async function requireStaffUser(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data } = await supabaseUser.auth.getUser();
  return data?.user?.id ?? null;
}

interface FlaggedLoan extends LoanFlag {
  holder_type: "contact" | "corporation";
  contact_id: string | null;
  corporation_id: string | null;
  holder_name: string;
  link: string;
  last_audit_flagged_at: string | null;
}

// deno-lint-ignore no-explicit-any
type Db = ReturnType<typeof createClient<any>>;

async function runAudit(db: Db): Promise<{ flaggedCount: number; newlyNotified: number; flags: FlaggedLoan[] }> {
  const { data: liabilities, error } = await db
    .from("liabilities")
    .select("id, description, liability_type, current_balance, due_date, holder_type, contact_id, corporation_id, last_audit_flagged_at")
    .in("liability_type", ["intercompany_loan", "shareholder_loan"])
    .gt("current_balance", 0);
  if (error) throw new Error(`Failed to load liabilities: ${error.message}`);

  const rows = (liabilities || []) as Array<{
    id: string;
    description: string;
    liability_type: string;
    current_balance: number;
    due_date: string | null;
    holder_type: "contact" | "corporation";
    contact_id: string | null;
    corporation_id: string | null;
    last_audit_flagged_at: string | null;
  }>;

  const flags = computeIntercompanyLoanFlags(rows);
  if (flags.length === 0) return { flaggedCount: 0, newlyNotified: 0, flags: [] };

  const rowById = new Map(rows.map((r) => [r.id, r]));
  const contactIds = [...new Set(flags.map((f) => rowById.get(f.id)?.contact_id).filter(Boolean))] as string[];
  const corporationIds = [...new Set(flags.map((f) => rowById.get(f.id)?.corporation_id).filter(Boolean))] as string[];

  const [{ data: contacts }, { data: corporations }] = await Promise.all([
    contactIds.length
      ? db.from("contacts").select("id, full_name").in("id", contactIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    corporationIds.length
      ? db.from("corporations").select("id, name").in("id", corporationIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const contactNameById = new Map((contacts || []).map((c: { id: string; full_name: string }) => [c.id, c.full_name]));
  const corpNameById = new Map((corporations || []).map((c: { id: string; name: string }) => [c.id, c.name]));

  const now = Date.now();
  const flaggedLoans: FlaggedLoan[] = flags.map((f) => {
    const row = rowById.get(f.id)!;
    const holderName =
      row.holder_type === "contact"
        ? contactNameById.get(row.contact_id || "") || "Unknown contact"
        : corpNameById.get(row.corporation_id || "") || "Unknown corporation";
    const link = row.holder_type === "contact" ? `/contacts/${row.contact_id}` : `/corporations/${row.corporation_id}`;
    return {
      ...f,
      holder_type: row.holder_type,
      contact_id: row.contact_id,
      corporation_id: row.corporation_id,
      holder_name: holderName,
      link,
      last_audit_flagged_at: row.last_audit_flagged_at,
    };
  });

  let newlyNotified = 0;
  for (const loan of flaggedLoans) {
    const lastFlaggedMs = loan.last_audit_flagged_at ? new Date(loan.last_audit_flagged_at).getTime() : null;
    const shouldNotify = lastFlaggedMs === null || now - lastFlaggedMs > RENOTIFY_AFTER_DAYS * 24 * 60 * 60 * 1000;
    if (!shouldNotify) continue;

    const statusLabel = loan.isOverdue ? "overdue" : "due soon";
    const amount = loan.current_balance.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
    const dueDateLabel = loan.due_date ? new Date(loan.due_date).toLocaleDateString("en-CA") : "no due date on file";

    await db.from("staff_notifications").insert({
      source_type: "quarterly_vfo_audit",
      title: `${loan.holder_name}'s loan is ${statusLabel}`,
      body: `${loan.description} -- ${amount} outstanding, due ${dueDateLabel} (CRA s.15(2) intercompany/shareholder loan check).`,
      contact_id: loan.holder_type === "contact" ? loan.contact_id : null,
      link: loan.link,
    });
    await db.from("liabilities").update({ last_audit_flagged_at: new Date().toISOString() }).eq("id", loan.id);
    newlyNotified++;
  }

  return { flaggedCount: flaggedLoans.length, newlyNotified, flags: flaggedLoans };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const db = admin();
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (isCronCaller(req)) {
    try {
      const result = await runAudit(db);
      return json(result);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }

  const userId = await requireStaffUser(req);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  try {
    const result = await runAudit(db);
    return json(result);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
