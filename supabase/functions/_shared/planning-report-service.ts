// planning-report-service.ts: building the Insurance Planning Report for a household from its saved needs analyses and quotes, previewing it, and filing it in
// Advisor Files / Reports (additive: nothing is moved or deleted). The wording is in planning-report-rules.ts.

// deno-lint-ignore-file no-explicit-any
import "./bc-time.ts";
import { buildBrandedPdf } from "./simple-pdf.ts";
import { planningReportBlocks, REPORT_KINDS, type ReportKind, type ReportPerson, type SavedAnalysis } from "./planning-report-rules.ts";
import type { QuoteRow } from "./quote-rules.ts";
import { uploadToAdvisorFiles } from "./insurance-doc-service.ts";
import { shareReportIn, unshareReportIn } from "./report-sharing.ts";
import { conventionFile, DOC_FILE_NAME } from "./file-naming.ts";

export interface ReportRequest { householdId: string; contactIds?: unknown; kinds?: unknown; includeOptions?: unknown; coverNote?: unknown }
const ymd = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver" }).format(d);
const longDate = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "America/Vancouver", dateStyle: "long" });
const footer = () => `© ${new Date().getFullYear()} Issler Group Management & Consulting Inc. o/a ProsperWise Advisors · www.prosperwise.ca`;
const METHOD_KIND: Record<string, ReportKind> = { dime: "life", critical_illness: "critical_illness", disability: "disability" };

type Built = { error: string } | { ok: true; pdf: Uint8Array; name: string; contactIds: string[]; kinds: ReportKind[]; includeOptions: boolean; coverNote: string | null };

async function build(db: any, input: ReportRequest): Promise<Built> {
  const { data: contacts } = await db.from("contacts").select("id, first_name, last_name, full_name, is_minor").eq("household_id", input.householdId).order("created_at");
  const wanted = Array.isArray(input.contactIds) ? new Set(input.contactIds.map(String)) : null;
  const chosen = ((contacts ?? []) as any[]).filter((c) => !c.is_minor && (!wanted || wanted.has(c.id)));
  if (!chosen.length) return { error: "Pick at least one person in this household." };
  const kinds = REPORT_KINDS.filter((k) => (Array.isArray(input.kinds) ? input.kinds.includes(k) : true));
  if (!kinds.length) return { error: "Pick at least one kind of cover." };
  const ids = chosen.map((c) => c.id);

  const [{ data: analyses }, { data: quotes }, { data: hh }] = await Promise.all([
    db.from("insurance_needs_analyses").select("contact_id, method, inputs, results, created_at").in("contact_id", ids).order("created_at", { ascending: false }),
    db.from("insurance_quotes").select("*").eq("household_id", input.householdId).in("contact_id", ids).order("created_at"),
    db.from("households").select("label").eq("id", input.householdId).maybeSingle(),
  ]);
  const people: ReportPerson[] = chosen.map((c) => {
    const mine: Partial<Record<ReportKind, SavedAnalysis>> = {};
    for (const a of (analyses ?? []) as any[]) {
      const kind = METHOD_KIND[a.method];
      if (a.contact_id === c.id && kind && !mine[kind]) mine[kind] = { inputs: a.inputs ?? {}, results: a.results ?? {}, savedAt: a.created_at }; // newest first, so the first is the latest
    }
    return { name: (c.full_name || `${c.first_name ?? ""} ${c.last_name ?? ""}`).trim() || "Client", analyses: mine, quotes: ((quotes ?? []) as any[]).filter((q) => q.contact_id === c.id) as QuoteRow[] };
  });
  const includeOptions = input.includeOptions !== false;
  const coverNote = String(input.coverNote ?? "").trim().slice(0, 3000) || null;
  const blocks = planningReportBlocks({ household: hh?.label ?? "", preparedOn: longDate(), coverNote, kinds, includeOptions, people });
  const names = people.map((p) => p.name).join(" and ");
  const pdf = buildBrandedPdf({ title: "Insurance Planning Report", subtitle: `${names} · ${longDate()}`, footer: footer(), blocks });
  return { ok: true, pdf, name: conventionFile(ymd(), chosen, DOC_FILE_NAME.planning_report), contactIds: ids, kinds, includeOptions, coverNote };
}

/** The report as a PDF to look at before filing it. Nothing is saved. */
export async function previewReport(db: any, input: ReportRequest): Promise<{ ok: true; name: string; base64: string } | { error: string }> {
  const r = await build(db, input);
  if ("error" in r) return r;
  let bin = "";
  for (let i = 0; i < r.pdf.length; i += 0x8000) bin += String.fromCharCode(...r.pdf.subarray(i, i + 0x8000));
  return { ok: true, name: r.name, base64: btoa(bin) };
}

/** Files the report in Advisor Files / Reports and records what it covered. */
export async function fileReport(db: any, who: string, input: ReportRequest): Promise<{ ok: true; url: string; name: string } | { error: string }> {
  const r = await build(db, input);
  if ("error" in r) return r;
  let drive;
  try { drive = await uploadToAdvisorFiles(db, input.householdId, "Reports", r.name, r.pdf); } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  const { error } = await db.from("insurance_reports").insert({ household_id: input.householdId, title: "Insurance Planning Report", contact_ids: r.contactIds, kinds: r.kinds, include_options: r.includeOptions, cover_note: r.coverNote, pdf_drive_id: drive.id, pdf_url: drive.url, pdf_name: drive.name, created_by: who });
  if (error) return { error: "The PDF is filed in Advisor Files, but I could not record it here." };
  return { ok: true, url: drive.url, name: drive.name };
}

export async function listReports(db: any, householdId: string) {
  const { data } = await db.from("insurance_reports").select("id, title, kinds, contact_ids, include_options, pdf_url, pdf_name, created_by, created_at, shared_at").eq("household_id", householdId).order("created_at", { ascending: false }).limit(20);
  return { reports: data ?? [] };
}

/** Sharing and the client's reads live in report-sharing.ts (shared with the investment report); these keep the planning report's names. */
export { REPORT_NOTICE_TITLE, clientReportDownload, clientReports } from "./report-sharing.ts";
export const shareReport = (db: any, who: string, id: string, notify: boolean) => shareReportIn(db, "insurance_reports", who, id, notify);
export const unshareReport = (db: any, id: string) => unshareReportIn(db, "insurance_reports", id);
