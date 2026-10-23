// quote-service.ts: filing the comparison of carrier quotes as the "alternatives considered" evidence in an insurance file: a branded PDF in Advisor Files /
// Quotes, attached to the file, plus the recommended quote's illustration when it has one. Additive in Drive.

// deno-lint-ignore-file no-explicit-any
import { buildBrandedPdf } from "./simple-pdf.ts";
import { quoteBlocks, type QuoteRow } from "./quote-rules.ts";
import { uploadToAdvisorFiles } from "./insurance-doc-service.ts";
import { conventionFile } from "./file-naming.ts";
import { attachItem } from "./insurance-file-service.ts";

const TYPE_LABEL: Record<string, string> = { term: "Term Life", whole_life: "Whole Life", universal_life: "Universal Life", critical_illness: "Critical Illness", disability: "Disability", long_term_care: "Long-Term Care", other: "Other" };
const ymd = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver" }).format(d);
const footer = () => `© ${new Date().getFullYear()} Issler Group Management & Consulting Inc. o/a ProsperWise Advisors · www.prosperwise.ca`;
const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;

export async function fileComparison(db: any, who: string, input: { householdId: string; contactId: string; policyType: string; fileId?: unknown }): Promise<{ ok: true; url: string; attached: boolean; illustration: string } | { error: string }> {
  const { data: quotes } = await db.from("insurance_quotes").select("*").eq("household_id", input.householdId).eq("contact_id", input.contactId).eq("policy_type", input.policyType).order("created_at");
  if (!(quotes ?? []).length) return { error: "There are no quotes to compare yet." };
  const { data: c } = await db.from("contacts").select("full_name, first_name, last_name").eq("id", input.contactId).maybeSingle();
  const person = (c?.full_name || `${c?.first_name ?? ""} ${c?.last_name ?? ""}`).trim() || "Client";
  let needLine: string | null = null;
  if (["term", "whole_life", "universal_life"].includes(input.policyType)) {
    const { data: a } = await db.from("insurance_needs_analyses").select("results, created_at").eq("contact_id", input.contactId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (a?.results) needLine = `From the needs analysis saved on ${ymd(new Date(a.created_at))}: a total life insurance need of ${money(Number(a.results.need) || 0)}, ${Number(a.results.shortfall) > 0 ? `with a shortfall of ${money(Number(a.results.shortfall))} after what is already in place` : "already covered by what is in place"}.`;
  }
  const typeLabel = TYPE_LABEL[input.policyType] ?? input.policyType;
  const blocks = quoteBlocks({ person, typeLabel, quotes: quotes as QuoteRow[], needLine, preparedOn: ymd() });
  const pdf = buildBrandedPdf({ title: "Alternatives Considered", subtitle: `${person} · ${typeLabel} · ${ymd()}`, footer: footer(), blocks });
  let drive;
  try { drive = await uploadToAdvisorFiles(db, input.householdId, "Quotes", conventionFile(ymd(), [c ?? {}], `Alternatives Considered ${typeLabel}`), pdf); } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }

  let attached = false, illustration = "none";
  if (input.fileId) {
    const { data: f } = await db.from("insurance_files").select("id").eq("id", String(input.fileId)).eq("household_id", input.householdId).maybeSingle();
    if (f) {
      const { data: have } = await db.from("insurance_file_items").select("id").eq("file_id", f.id).eq("kind", "alternatives").eq("drive_file_id", drive.id).maybeSingle();
      if (!have) await db.from("insurance_file_items").insert({ file_id: f.id, kind: "alternatives", status: "provided", drive_file_id: drive.id, drive_name: drive.name, drive_url: drive.url, note: `${(quotes as any[]).length} option${(quotes as any[]).length === 1 ? "" : "s"} compared`, added_by: who });
      attached = true;
      const rec = (quotes as any[]).find((q) => q.status === "recommended");
      if (rec?.illustration_url) {
        const r: any = await attachItem(db, who, f.id, "illustration", { driveLink: rec.illustration_url, note: `Illustration for the recommended ${rec.carrier} ${rec.product}` });
        illustration = r.error ? `not attached: ${r.error}` : "attached";
      }
    }
  }
  return { ok: true, url: drive.url, attached, illustration };
}
