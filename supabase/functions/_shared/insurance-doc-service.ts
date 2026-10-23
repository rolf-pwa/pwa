// insurance-doc-service.ts: insurance documents that clients sign in the portal. The master is a Google Doc read fresh from Drive each time one is
// prepared; what the client is sent is stored frozen with its fingerprint; each signature is recorded with what was agreed, when and from where; and when
// everyone has signed, a PDF of the document as signed goes to the household's Advisor Files (additive: nothing in Drive is moved or deleted) and the
// checklist items it covers are ticked in the insurance file.

// deno-lint-ignore-file no-explicit-any
import { getServiceGoogleAccessToken } from "./google-token.ts";
import { driveEnsureFolder, driveFindFolder } from "./meeting-record-service.ts";
import { alternativesParagraph, cleanTemplate, costParagraph, fillReasonWhy, fillTemplate, footerVersion, needsParagraph, replacementParagraph, sha256Hex, signedPdfBlocks, statementFor, type AnalysisLite } from "./insurance-doc-rules.ts";
import { buildBrandedPdf } from "./simple-pdf.ts";
import { needsAnalysisBlocks } from "./needs-analysis-pdf.ts";
import { notifyClientsOfComment } from "./task-notify.ts";
import { DOC_FILE_NAME, conventionFile } from "./file-naming.ts";
import { DOC_ITEMS, documentTaskTitle, type DocKind } from "./insurance-doc-client.ts";

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const sig = () => AbortSignal.timeout(25_000);
const ymd = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver" }).format(d);
const ROLF = "rolf@prosperwise.ca";
/** The entity on insurance documents is ProsperWise Advisors (the Strategy side keeps its own line on its documents). */
/** What the client sees the letter called (the master in Drive is titled "Reason Why: Life" for Rolf). */
const RW_TITLE = "Your Life Insurance Recommendation";
const ADVISORS_FOOTER = () => `\u00A9 ${new Date().getFullYear()} Issler Group Management & Consulting Inc. o/a ProsperWise Advisors \u00B7 www.prosperwise.ca`;

const isKind = (k: unknown): k is DocKind => k === "disclosure_privacy" || k === "reason_why" || k === "fact_find" || k === "replacement_declaration" || k === "replacement_explanation" || k === "delivery_letter";

async function readMaster(db: any, kind: DocKind) {
  const { data: t } = await db.from("insurance_doc_templates").select("kind, title, drive_file_id, advisor_contact").eq("kind", kind).maybeSingle();
  if (!t) throw new Error("No master document is set for this kind of document.");
  const token = await getServiceGoogleAccessToken(db);
  const meta = await fetch(`${DRIVE}/files/${t.drive_file_id}?${new URLSearchParams({ fields: "id,name,mimeType,modifiedTime", supportsAllDrives: "true" })}`, { headers: { Authorization: `Bearer ${token}` }, signal: sig() });
  if (!meta.ok) throw new Error(`I could not open the master document in Drive (${meta.status}).`);
  const m = await meta.json();
  if (m.mimeType !== "application/vnd.google-apps.document") throw new Error("The master document must be a Google Doc. In Drive, open it and choose File, Save as Google Docs, then tell me the new link.");
  const exportAs = (mimeType: string) => fetch(`${DRIVE}/files/${t.drive_file_id}/export?${new URLSearchParams({ mimeType, supportsAllDrives: "true" })}`, { headers: { Authorization: `Bearer ${token}` }, signal: sig() });
  // Markdown keeps the headings and bold; plain text is the fallback if Drive will not give Markdown.
  let ex = await exportAs("text/markdown");
  if (!ex.ok) ex = await exportAs("text/plain");
  if (!ex.ok) throw new Error(`Drive could not export the master document (${ex.status}).`);
  return { template: t, md: await ex.text(), modified: m.modifiedTime as string };
}

const fullName = (c: any) => (c.full_name || `${c.first_name ?? ""} ${c.last_name ?? ""}`).trim();

export async function adults(db: any, householdId: string) {
  const { data } = await db.from("contacts").select("id, first_name, last_name, full_name, email, is_minor").eq("household_id", householdId).order("created_at");
  return ((data ?? []) as any[]).filter((c) => !c.is_minor).map((c) => ({ id: c.id as string, name: fullName(c), email: (c.email as string | null) ?? null }));
}

export interface ReasonWhyFields {
  insuredId?: string; need?: string; product?: string; carrier?: string; benefits?: string[]; coverageAmount?: number | null;
  premium?: number | null; frequency?: string | null; includeNeeds?: boolean; includeCost?: boolean; alternatives?: string; replacement?: string;
}
const str = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
export function cleanFields(raw: any): ReasonWhyFields {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    insuredId: str(r.insuredId, 60) || undefined, need: str(r.need, 400), product: str(r.product, 120), carrier: str(r.carrier, 120),
    benefits: (Array.isArray(r.benefits) ? r.benefits : []).map((b: unknown) => str(b, 240)).filter(Boolean).slice(0, 12),
    coverageAmount: num(r.coverageAmount), premium: num(r.premium), frequency: ["monthly", "quarterly", "semi_annual", "annual"].includes(r.frequency) ? r.frequency : null,
    includeNeeds: r.includeNeeds !== false, includeCost: r.includeCost !== false, alternatives: str(r.alternatives, 1500), replacement: str(r.replacement, 1500),
  };
}

/** The latest saved needs analysis for each of these people. */
async function latestAnalyses(db: any, people: { id: string; name: string }[]): Promise<AnalysisLite[]> {
  if (!people.length) return [];
  const { data } = await db.from("insurance_needs_analyses").select("contact_id, results, created_at").in("contact_id", people.map((p) => p.id)).order("created_at", { ascending: false });
  const seen = new Set<string>();
  const out: AnalysisLite[] = [];
  for (const r of (data ?? []) as any[]) {
    if (seen.has(r.contact_id)) continue;
    seen.add(r.contact_id);
    const p = people.find((x) => x.id === r.contact_id);
    if (p && r.results) out.push({ name: p.name, need: Number(r.results.need) || 0, available: Number(r.results.available) || 0, shortfall: Number(r.results.shortfall) || 0, surplus: Number(r.results.surplus) || 0, percentMet: Number(r.results.percentMet) || 0 });
  }
  return out;
}

/** The document as the client would get it, for Rolf to read before sending. Nothing is stored. */
export async function previewDoc(db: any, householdId: string, kind: unknown, contactIds: unknown, rawFields?: unknown) {
  if (!isKind(kind)) return { error: "Unknown document." };
  if (kind === "fact_find") return { error: "The fact find is built on the Fact find card." };
  if (kind === "delivery_letter") return { error: "The closing letter is built on the Application and delivery card." };
  if (kind === "replacement_declaration" || kind === "replacement_explanation") return { error: "The replacement documents are built on the Replacing a policy card." };
  const all = await adults(db, householdId);
  const fields = cleanFields(rawFields);
  const asked = Array.isArray(contactIds) && contactIds.length ? (contactIds as string[]) : kind === "reason_why" && fields.insuredId ? [fields.insuredId] : null;
  const want = asked ? all.filter((a) => asked.includes(a.id)) : all;
  if (!want.length) return { error: "Pick at least one adult from this household." };
  let master;
  try { master = await readMaster(db, kind); } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  const warnings: string[] = [];
  if (kind === "reason_why") {
    const insured = all.find((a) => a.id === fields.insuredId) ?? want[0];
    const analyses = fields.includeNeeds ? await latestAnalyses(db, [insured]) : [];
    if (fields.includeNeeds && !analyses.length) warnings.push(`There is no saved needs analysis for ${insured.name}, so the needs paragraph is left out. Save one under Needs analysis first.`);
    const extra = [needsParagraph(analyses, fields.coverageAmount ?? null), fields.includeCost ? costParagraph(fields.premium ?? null, fields.frequency ?? null, fields.product ?? "") : "", alternativesParagraph(fields.alternatives ?? ""), replacementParagraph(fields.replacement ?? "")].filter(Boolean);
    const filled = fillReasonWhy(master.md, { firstNames: want.map((w) => w.name.split(" ")[0]), need: fields.need ?? "", product: fields.product ?? "", carrier: fields.carrier ?? "", benefits: fields.benefits ?? [], extra });
    if (filled.missing.length) warnings.push(`Still to fill in: ${filled.missing.join(", ")}.`);
    return { ok: true as const, title: RW_TITLE, md: filled.md, hasCasl: false, version: null, modified: master.modified, signers: want, warnings, hash: await sha256Hex(filled.md), driveId: master.template.drive_file_id, analyses };
  }
  const cleaned = cleanTemplate(master.md);
  const md = fillTemplate(cleaned.md, { names: want.map((w) => w.name), advisorContact: master.template.advisor_contact ?? "", date: ymd() });
  if (!cleaned.usesContactField && !master.template.advisor_contact) warnings.push("Your contact details are not in the document.");
  if (cleaned.usesContactField && !String(master.template.advisor_contact ?? "").trim()) warnings.push("The document has a place for your contact details, but none are set.");
  if (!cleaned.hasCasl) warnings.push("I could not find the CASL choice in the document, so clients will not be asked for it.");
  return { ok: true as const, title: master.template.title, md, hasCasl: cleaned.hasCasl, version: footerVersion(master.md), modified: master.modified, signers: want, warnings, hash: await sha256Hex(md), driveId: master.template.drive_file_id, analyses: [] as AnalysisLite[] };
}

export async function sendDoc(db: any, who: string, input: { householdId: string; kind: unknown; contactIds: unknown; fileId?: unknown; fields?: unknown; bodyMd?: unknown }) {
  const p: any = await previewDoc(db, input.householdId, input.kind, input.contactIds, input.fields);
  if (p.error) return p;
  // The letter is Rolf's own words: he can edit the draft before it goes. The disclosure is always the master's wording.
  if (input.kind === "reason_why" && typeof input.bodyMd === "string" && input.bodyMd.trim()) { p.md = input.bodyMd.trim().slice(0, 30_000); p.hash = await sha256Hex(p.md); }
  if (input.kind === "reason_why" && /_{3,}/.test(p.md)) return { error: "The letter still has blanks to fill in." };
  return await createAndSend(db, who, { householdId: input.householdId, kind: input.kind as DocKind, title: p.title, md: p.md, hash: p.hash, driveId: p.driveId, modified: p.modified, version: p.version, signers: p.signers, fileId: input.fileId });
}

/** Stores a document exactly as it will be read, names who must sign, and puts a task in the client's portal. Used by every kind of document. */
export async function createAndSend(db: any, who: string, p: { householdId: string; kind: DocKind; title: string; md: string; hash: string; driveId: string; modified: string | null; version: string | null; signers: { id: string; name: string }[]; fileId?: unknown }) {
  let fileId: string | null = null;
  if (p.fileId) {
    const { data: f } = await db.from("insurance_files").select("id").eq("id", String(p.fileId)).eq("household_id", p.householdId).maybeSingle();
    fileId = f?.id ?? null;
  }
  // One live copy of the disclosure per household: the earlier one is voided so a client is never asked to sign two versions.
  // (Letters and fact finds are per person, so a new one does not void another person's pending one.)
  const { data: earlier } = p.kind === "disclosure_privacy" ? await db.from("insurance_documents").select("id, task_id").eq("household_id", p.householdId).eq("kind", p.kind).in("status", ["sent", "partly_signed"]) : { data: [] as any[] };
  for (const e of (earlier ?? []) as any[]) await voidDoc(db, e.id, "Replaced by a newer copy", who);
  const { data: doc, error } = await db.from("insurance_documents").insert({ household_id: p.householdId, file_id: fileId, kind: p.kind, title: p.title, template_drive_id: p.driveId, template_modified: p.modified, template_version: p.version, body_md: p.md, body_hash: p.hash, sent_by: who }).select("id").single();
  if (error) return { error: error.message };
  await db.from("insurance_document_signers").insert(p.signers.map((s) => ({ document_id: doc.id, contact_id: s.id, name: s.name })));
  const { data: rolf } = await db.from("profiles").select("user_id").eq("email", ROLF).maybeSingle();
  if (rolf?.user_id) {
    const due = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const confirmOnly = p.kind !== "disclosure_privacy";
    const owner = p.signers.length === 1 ? { contact_id: p.signers[0].id, household_id: null as string | null } : { contact_id: null as string | null, household_id: p.householdId };
    const taskTitle = documentTaskTitle(p.kind, p.title);
    const { data: task } = await db.from("pm_tasks").insert({
      title: taskTitle,
      description: confirmOnly ? `Please read ${p.title} and confirm it: open this task and press the button. If anything is missing or not right, tell me before you confirm.` : `Please read and sign your ${p.title}: open this task and press the button. It takes a couple of minutes. If you have questions first, reply here and I will answer them.`,
      status: "open", client_visible: true, assignee_id: rolf.user_id, created_by: rolf.user_id, due_date: due,
      // A document for one person is that person's task alone; a household task would show up in the other adults' portals, where they cannot open it.
      ...(owner.contact_id ? { contact_id: owner.contact_id } : { household_id: owner.household_id }),
    }).select("id").maybeSingle();
    if (task?.id) {
      await db.from("insurance_documents").update({ task_id: task.id }).eq("id", doc.id);
      // The client is told the way they are for any task shared with them: a bell in the portal and, through the digest, one short email that carries no details.
      try { await notifyClientsOfComment(db, { id: task.id, title: taskTitle, client_visible: true, contact_id: owner.contact_id, household_id: owner.household_id }, Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, "updated"); } catch (e) { console.error("[insurance-doc] client notification failed", e); }
    }
  }
  return { ok: true as const, id: doc.id as string };
}

export async function listDocs(db: any, householdId: string) {
  const { data: docs } = await db.from("insurance_documents").select("id, file_id, kind, title, status, sent_at, completed_at, pdf_url, template_version, template_modified, void_reason").eq("household_id", householdId).order("sent_at", { ascending: false });
  const ids = (docs ?? []).map((d: any) => d.id);
  const { data: signers } = ids.length ? await db.from("insurance_document_signers").select("document_id, contact_id, name, status, signed_at, casl_choice").in("document_id", ids) : { data: [] as any[] };
  return (docs ?? []).map((d: any) => ({ ...d, signers: ((signers ?? []) as any[]).filter((s) => s.document_id === d.id) }));
}

export async function voidDoc(db: any, id: string, reason: string, who: string) {
  const { data: d } = await db.from("insurance_documents").select("id, status, task_id").eq("id", id).maybeSingle();
  if (!d) return { error: "Document not found." };
  if (d.status === "signed") return { error: "A signed document cannot be voided." };
  await db.from("insurance_documents").update({ status: "void", void_reason: `${reason.slice(0, 200)} (${who})` }).eq("id", id);
  if (d.task_id) await db.from("pm_tasks").update({ status: "done", completed_at: new Date().toISOString() }).eq("id", d.task_id);
  return { ok: true };
}


/** Puts a PDF in a folder under the household's Advisor Files (created if needed). Additive: nothing is moved or deleted. */
export async function uploadToAdvisorFiles(db: any, householdId: string, folderName: string, name: string, pdf: Uint8Array, mime = "application/pdf"): Promise<{ id: string; url: string; name: string }> {
  const { data: hh } = await db.from("households").select("vault_folder_id").eq("id", householdId).maybeSingle();
  if (!hh?.vault_folder_id) throw new Error("This household has no Vault folder yet.");
  const token = await getServiceGoogleAccessToken(db);
  const advisor = await driveFindFolder(hh.vault_folder_id, "Advisor Files", token);
  if (!advisor) throw new Error("I could not find the Advisor Files folder.");
  const folder = await driveEnsureFolder(advisor, folderName, token);
  const boundary = `pwsig${crypto.randomUUID().replace(/-/g, "")}`;
  const head = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, mimeType: mime, parents: [folder] })}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
  const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + pdf.length + tail.length);
  body.set(head, 0); body.set(pdf, head.length); body.set(tail, head.length + pdf.length);
  const up = await fetch(`${UPLOAD}/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` }, body, signal: sig() });
  if (!up.ok) throw new Error(`Drive said no (${up.status}).`);
  const f = await up.json();
  return { id: f.id, url: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`, name };
}

/** Builds the signed PDF, files it in Advisor Files, ticks the checklist and closes the client's task. Safe to run again: it does only what is not yet done. */
export async function finalizeDoc(db: any, documentId: string): Promise<{ ok: boolean; message: string }> {
  const { data: d } = await db.from("insurance_documents").select("*").eq("id", documentId).maybeSingle();
  if (!d || d.status !== "signed") return { ok: false, message: "The document is not fully signed." };
  if (d.task_id) await db.from("pm_tasks").update({ status: "done", completed_at: new Date().toISOString() }).eq("id", d.task_id).neq("status", "done");
  if (d.kind === "fact_find") await db.from("insurance_fact_finds").update({ status: "confirmed", updated_at: new Date().toISOString() }).eq("document_id", d.id);
  if (d.kind === "delivery_letter") await db.from("insurance_issuances").update({ status: "confirmed", updated_at: new Date().toISOString() }).eq("letter_document_id", d.id);
  if (d.kind === "replacement_declaration" || d.kind === "replacement_explanation") {
    const { data: rep } = await db.from("insurance_replacements").select("id, explanation_doc_id, declaration_doc_id").or(`explanation_doc_id.eq.${d.id},declaration_doc_id.eq.${d.id}`).maybeSingle();
    if (rep) {
      const { data: both } = await db.from("insurance_documents").select("id, status").in("id", [rep.explanation_doc_id, rep.declaration_doc_id].filter(Boolean));
      if ((both ?? []).length === 2 && (both as any[]).every((x) => x.status === "signed")) await db.from("insurance_replacements").update({ status: "confirmed", updated_at: new Date().toISOString() }).eq("id", rep.id);
    }
  }
  if (d.pdf_drive_id) return { ok: true, message: "Already filed." };
  const { data: signers } = await db.from("insurance_document_signers").select("name, typed_name, signed_at, ip, casl_choice, casl_initials, casl_email").eq("document_id", documentId).order("signed_at");
  const blocks = signedPdfBlocks({ agent: d.agent_signed_at ? { typedName: d.agent_typed_name, signedAt: d.agent_signed_at, ip: d.agent_ip, statement: d.agent_statement } : null, statement: statementFor(d.kind), md: d.body_md, hash: d.body_hash, templateModified: d.template_modified, templateVersion: d.template_version, sentAt: d.sent_at, signers: ((signers ?? []) as any[]).map((s) => ({ name: s.name, typedName: s.typed_name, signedAt: s.signed_at, ip: s.ip, caslChoice: s.casl_choice, caslInitials: s.casl_initials, caslEmail: s.casl_email })) });
  const pdf = buildBrandedPdf({ title: d.title, subtitle: `Signed electronically \u00B7 fingerprint ${d.body_hash.slice(0, 16)}`, footer: ADVISORS_FOOTER(), blocks });
  try {
    const { data: who } = await db.from("insurance_document_signers").select("contact_id").eq("document_id", documentId).order("signed_at");
    const { data: people } = (who ?? []).length ? await db.from("contacts").select("id, first_name, last_name, full_name").in("id", (who as any[]).map((w) => w.contact_id)) : { data: [] as any[] };
    const ordered = (who as any[] ?? []).map((w) => (people ?? []).find((c: any) => c.id === w.contact_id)).filter(Boolean);
    const f = await uploadToAdvisorFiles(db, d.household_id, "Signed Documents", conventionFile(ymd(), ordered, DOC_FILE_NAME[d.kind] ?? d.title), pdf);
    const url = f.url, name = f.name;
    await db.from("insurance_documents").update({ pdf_drive_id: f.id, pdf_url: url }).eq("id", documentId);
    if (d.file_id) {
      const names = ((signers ?? []) as any[]).map((s) => s.typed_name).join(" and ");
      for (const kind of DOC_ITEMS[d.kind as DocKind] ?? []) {
        const { data: have } = await db.from("insurance_file_items").select("id").eq("file_id", d.file_id).eq("kind", kind).eq("drive_file_id", f.id).maybeSingle();
        if (!have) await db.from("insurance_file_items").insert({ file_id: d.file_id, kind, status: "provided", drive_file_id: f.id, drive_name: name, drive_url: url, note: `Signed electronically in the client portal by ${names}`, added_by: "client portal" });
      }
    }
    return { ok: true, message: "Filed in Advisor Files." };
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    await db.from("staff_notifications").insert({ title: `Signed ${d.title} could not be filed`, body: `${why} The signatures are saved. Open Compliance and use "File the signed copy" to try again.`, link: `/insurance/${d.household_id}/compliance`, source_type: "insurance_document" });
    return { ok: false, message: why };
  }
}

/** Files a saved needs analysis as a branded PDF in Advisor Files / Needs Analyses, and attaches it to an insurance file as the needs-analysis evidence. */
export async function fileNeedsAnalysis(db: any, who: string, analysisId: string, fileId?: unknown): Promise<{ ok: true; url: string; attached: boolean } | { error: string }> {
  const { data: a } = await db.from("insurance_needs_analyses").select("id, household_id, contact_id, inputs, results, note, created_at, pdf_drive_id, pdf_url").eq("id", analysisId).maybeSingle();
  if (!a) return { error: "Analysis not found." };
  const { data: c } = await db.from("contacts").select("full_name, first_name, last_name, household_id").eq("id", a.contact_id).maybeSingle();
  const householdId = a.household_id ?? c?.household_id;
  if (!householdId) return { error: "This person is not in a household, so there is no Advisor Files folder to put it in." };
  const person = (c?.full_name || `${c?.first_name ?? ""} ${c?.last_name ?? ""}`).trim() || "Client";
  const day = ymd(new Date(a.created_at));
  let drive = a.pdf_drive_id ? { id: a.pdf_drive_id as string, url: a.pdf_url as string, name: conventionFile(day, [c ?? {}], DOC_FILE_NAME.needs_analysis) } : null;
  if (!drive) {
    const pdf = buildBrandedPdf({ title: "Life Insurance Needs Analysis", subtitle: `${person} \u00B7 ${new Date(a.created_at).toLocaleDateString("en-CA", { timeZone: "America/Vancouver", dateStyle: "long" })}`, footer: ADVISORS_FOOTER(), blocks: needsAnalysisBlocks({ inputs: a.inputs ?? {}, results: a.results ?? {}, note: a.note, savedAt: a.created_at, person }) });
    try { drive = await uploadToAdvisorFiles(db, householdId, "Needs Analyses", conventionFile(day, [c ?? {}], DOC_FILE_NAME.needs_analysis), pdf); } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
    await db.from("insurance_needs_analyses").update({ pdf_drive_id: drive.id, pdf_url: drive.url, filed_at: new Date().toISOString() }).eq("id", a.id);
  }
  let attached = false;
  if (fileId) {
    const { data: f } = await db.from("insurance_files").select("id").eq("id", String(fileId)).eq("household_id", householdId).maybeSingle();
    if (f) {
      const { data: have } = await db.from("insurance_file_items").select("id").eq("file_id", f.id).eq("kind", "needs_analysis").eq("drive_file_id", drive.id).maybeSingle();
      if (!have) await db.from("insurance_file_items").insert({ file_id: f.id, kind: "needs_analysis", status: "provided", drive_file_id: drive.id, drive_name: drive.name, drive_url: drive.url, note: `Saved analysis of ${day}`, added_by: who });
      attached = true;
    }
  }
  return { ok: true, url: drive.url, attached };
}

/** A signed copy for the person who signed it (every signatory must be given a copy). Read from Drive with the service account; returned as base64. */
export async function clientDownload(db: any, contactId: string, documentId: string): Promise<{ name: string; base64: string } | { error: string }> {
  const { data: me } = await db.from("insurance_document_signers").select("status").eq("document_id", documentId).eq("contact_id", contactId).maybeSingle();
  if (!me || me.status !== "signed") return { error: "Not available" };
  const { data: d } = await db.from("insurance_documents").select("title, status, pdf_drive_id").eq("id", documentId).maybeSingle();
  if (!d?.pdf_drive_id || d.status === "void") return { error: "The signed copy is not ready yet." };
  const token = await getServiceGoogleAccessToken(db);
  const r = await fetch(`${DRIVE}/files/${d.pdf_drive_id}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` }, signal: sig() });
  if (!r.ok) return { error: "The signed copy could not be opened just now." };
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length > 6_000_000) return { error: "The signed copy is too large to download here." };
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { name: `${String(d.title).replace(/[\\/:*?"<>|]/g, "-")} (signed).pdf`, base64: btoa(bin) };
}
