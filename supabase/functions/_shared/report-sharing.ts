// report-sharing.ts: reports the advisor shares with a client (the insurance planning report, the investment recommendation report): sharing and hiding them,
// telling the client once, and what the client may list and download. A client sees a report only when it was prepared for them and only while it is shared.

// deno-lint-ignore-file no-explicit-any
import { driveFileBase64 } from "./insurance-doc-service.ts";
import { notifyClientsOfComment } from "./task-notify.ts";

export type ReportTable = "insurance_reports" | "investment_reports";
const TABLES: ReportTable[] = ["insurance_reports", "investment_reports"];

/** The wording of the portal bell for a shared report: it opens the Documents page. */
export const REPORT_NOTICE_TITLE = "A new report from your advisor is ready";

/** Shares a filed report with the people it was prepared for (their portal Documents page), and tells them the way a waiting document does: a bell and one short email. */
export async function shareReportIn(db: any, table: ReportTable, who: string, id: string, notify: boolean): Promise<{ ok: true; notified: number } | { error: string }> {
  const { data: r } = await db.from(table).select("id, title, contact_ids, shared_at").eq("id", id).maybeSingle();
  if (!r) return { error: "That report was not found." };
  const { error } = await db.from(table).update({ shared_at: new Date().toISOString(), shared_by: who }).eq("id", id);
  if (error) return { error: "Could not share the report." };
  let notified = 0;
  if (notify && !r.shared_at) { // told once: sharing it again does not email them again
    for (const contactId of (r.contact_ids ?? []) as string[]) {
      try { notified += await notifyClientsOfComment(db, { id: r.id, title: r.title, client_visible: true, contact_id: contactId, household_id: null }, Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, "updated", { linkTab: "documents", title: REPORT_NOTICE_TITLE }); } catch (e) { console.error("[report-share] notify failed", e); }
    }
  }
  return { ok: true, notified };
}

export async function unshareReportIn(db: any, table: ReportTable, id: string): Promise<{ ok: true } | { error: string }> {
  const { error } = await db.from(table).update({ shared_at: null, shared_by: null }).eq("id", id);
  return error ? { error: "Could not hide the report." } : { ok: true };
}

/** The reports shared with this person (only those prepared for them), from every kind of report. */
export async function clientReports(db: any, contactId: string) {
  const all: { id: string; title: string; shared_at: string }[] = [];
  for (const t of TABLES) {
    const { data } = await db.from(t).select("id, title, shared_at").not("shared_at", "is", null).contains("contact_ids", [contactId]);
    all.push(...((data ?? []) as any[]));
  }
  return all.sort((a, b) => Date.parse(b.shared_at) - Date.parse(a.shared_at));
}

export async function clientReportDownload(db: any, contactId: string, reportId: string): Promise<{ name: string; base64: string } | { error: string }> {
  for (const t of TABLES) {
    const { data: r } = await db.from(t).select("pdf_drive_id, pdf_name, shared_at, contact_ids").eq("id", reportId).maybeSingle();
    if (!r) continue;
    if (!r.shared_at || !((r.contact_ids ?? []) as string[]).includes(contactId)) return { error: "Not available" };
    const f = await driveFileBase64(db, r.pdf_drive_id, "report");
    if ("error" in f) return f;
    return { name: String(r.pdf_name).replace(/[\\/:*?"<>|]/g, "-"), base64: f.base64 };
  }
  return { error: "Not available" };
}
