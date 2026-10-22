// insurance-doc-service.ts: insurance documents that clients sign in the portal. The master is a Google Doc read fresh from Drive each time one is
// prepared; what the client is sent is stored frozen with its fingerprint; each signature is recorded with what was agreed, when and from where; and when
// everyone has signed, a PDF of the document as signed goes to the household's Advisor Files (additive: nothing in Drive is moved or deleted) and the
// checklist items it covers are ticked in the insurance file.

// deno-lint-ignore-file no-explicit-any
import { getServiceGoogleAccessToken } from "./google-token.ts";
import { driveEnsureFolder, driveFindFolder } from "./meeting-record-service.ts";
import { cleanTemplate, fillTemplate, footerVersion, sha256Hex, signedPdfLines } from "./insurance-doc-rules.ts";
import { buildPdf } from "./simple-pdf.ts";
import { DOC_ITEMS, type DocKind } from "./insurance-doc-client.ts";

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const sig = () => AbortSignal.timeout(25_000);
const ymd = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver" }).format(d);
const ROLF = "rolf@prosperwise.ca";

const isKind = (k: unknown): k is DocKind => k === "disclosure_privacy" || k === "reason_why";

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

/** The document as the client would get it, for Rolf to read before sending. Nothing is stored. */
export async function previewDoc(db: any, householdId: string, kind: unknown, contactIds: unknown) {
  if (!isKind(kind)) return { error: "Unknown document." };
  if (kind === "reason_why") return { error: "The reason-why letter is built from the needs analysis and the recommendation, which come next." };
  const all = await adults(db, householdId);
  const want = Array.isArray(contactIds) && contactIds.length ? all.filter((a) => (contactIds as string[]).includes(a.id)) : all;
  if (!want.length) return { error: "Pick at least one adult from this household." };
  let master;
  try { master = await readMaster(db, kind); } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  const cleaned = cleanTemplate(master.md);
  const md = fillTemplate(cleaned.md, { names: want.map((w) => w.name), advisorContact: master.template.advisor_contact ?? "", date: ymd() });
  const warnings: string[] = [];
  if (!cleaned.usesContactField && !master.template.advisor_contact) warnings.push("Your contact details are not in the document.");
  if (cleaned.usesContactField && !String(master.template.advisor_contact ?? "").trim()) warnings.push("The document has a place for your contact details, but none are set.");
  if (!cleaned.hasCasl) warnings.push("I could not find the CASL choice in the document, so clients will not be asked for it.");
  return { ok: true as const, title: master.template.title, md, hasCasl: cleaned.hasCasl, version: footerVersion(master.md), modified: master.modified, signers: want, warnings, hash: await sha256Hex(md), driveId: master.template.drive_file_id };
}

export async function sendDoc(db: any, who: string, input: { householdId: string; kind: unknown; contactIds: unknown; fileId?: unknown }) {
  const p: any = await previewDoc(db, input.householdId, input.kind, input.contactIds);
  if (p.error) return p;
  let fileId: string | null = null;
  if (input.fileId) {
    const { data: f } = await db.from("insurance_files").select("id").eq("id", String(input.fileId)).eq("household_id", input.householdId).maybeSingle();
    fileId = f?.id ?? null;
  }
  // One live copy of a document per household: the earlier one is voided so a client is never asked to sign two versions.
  const { data: earlier } = await db.from("insurance_documents").select("id, task_id").eq("household_id", input.householdId).eq("kind", input.kind).in("status", ["sent", "partly_signed"]);
  for (const e of (earlier ?? []) as any[]) await voidDoc(db, e.id, "Replaced by a newer copy", who);
  const { data: doc, error } = await db.from("insurance_documents").insert({ household_id: input.householdId, file_id: fileId, kind: input.kind, title: p.title, template_drive_id: p.driveId, template_modified: p.modified, template_version: p.version, body_md: p.md, body_hash: p.hash, sent_by: who }).select("id").single();
  if (error) return { error: error.message };
  await db.from("insurance_document_signers").insert(p.signers.map((s: any) => ({ document_id: doc.id, contact_id: s.id, name: s.name })));
  const { data: rolf } = await db.from("profiles").select("user_id").eq("email", ROLF).maybeSingle();
  if (rolf?.user_id) {
    const due = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const { data: task } = await db.from("pm_tasks").insert({ title: `Sign your ${p.title}`, description: `Please read and sign your ${p.title} in your portal: open Documents to sign. It takes a couple of minutes. If you have questions first, reply here and I will answer them.`, status: "open", client_visible: true, assignee_id: rolf.user_id, created_by: rolf.user_id, household_id: input.householdId, due_date: due }).select("id").maybeSingle();
    if (task?.id) await db.from("insurance_documents").update({ task_id: task.id }).eq("id", doc.id);
  }
  return { ok: true as const, id: doc.id };
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

/** Builds the signed PDF, files it in Advisor Files, ticks the checklist and closes the client's task. Safe to run again: it does only what is not yet done. */
export async function finalizeDoc(db: any, documentId: string): Promise<{ ok: boolean; message: string }> {
  const { data: d } = await db.from("insurance_documents").select("*").eq("id", documentId).maybeSingle();
  if (!d || d.status !== "signed") return { ok: false, message: "The document is not fully signed." };
  if (d.task_id) await db.from("pm_tasks").update({ status: "done", completed_at: new Date().toISOString() }).eq("id", d.task_id).neq("status", "done");
  if (d.pdf_drive_id) return { ok: true, message: "Already filed." };
  const { data: signers } = await db.from("insurance_document_signers").select("name, typed_name, signed_at, ip, casl_choice, casl_initials, casl_email").eq("document_id", documentId).order("signed_at");
  const lines = signedPdfLines({ title: d.title, md: d.body_md, hash: d.body_hash, templateModified: d.template_modified, templateVersion: d.template_version, sentAt: d.sent_at, signers: ((signers ?? []) as any[]).map((s) => ({ name: s.name, typedName: s.typed_name, signedAt: s.signed_at, ip: s.ip, caslChoice: s.casl_choice, caslInitials: s.casl_initials, caslEmail: s.casl_email })) });
  const pdf = buildPdf(lines, `${d.title}  |  signed electronically  |  ${d.body_hash.slice(0, 16)}`);
  try {
    const { data: hh } = await db.from("households").select("label, vault_folder_id").eq("id", d.household_id).maybeSingle();
    if (!hh?.vault_folder_id) throw new Error("This household has no Vault folder yet.");
    const token = await getServiceGoogleAccessToken(db);
    const advisor = await driveFindFolder(hh.vault_folder_id, "Advisor Files", token);
    if (!advisor) throw new Error("I could not find the Advisor Files folder.");
    const folder = await driveEnsureFolder(advisor, "Signed Documents", token);
    const name = `${d.title} (signed ${ymd()}).pdf`;
    const boundary = `pwsig${crypto.randomUUID().replace(/-/g, "")}`;
    const head = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, mimeType: "application/pdf", parents: [folder] })}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`);
    const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
    const body = new Uint8Array(head.length + pdf.length + tail.length);
    body.set(head, 0); body.set(pdf, head.length); body.set(tail, head.length + pdf.length);
    const up = await fetch(`${UPLOAD}/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` }, body, signal: sig() });
    if (!up.ok) throw new Error(`Drive said no (${up.status}).`);
    const f = await up.json();
    const url = f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`;
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
