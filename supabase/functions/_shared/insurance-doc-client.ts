// insurance-doc-client.ts: the client's side of signing an insurance document in the portal. Only a person named as a signer on a document can see or sign
// it; each signature is stored with exactly what was agreed, when, and from where. Filing the signed PDF is passed in, so this file has no Google code.

// deno-lint-ignore-file no-explicit-any
import { CASL_MARKER, SIGN_STATEMENT_VERSION, checkSignature, statementFor } from "./insurance-doc-rules.ts";

export type DocKind = "disclosure_privacy" | "reason_why" | "fact_find" | "replacement_declaration" | "replacement_explanation" | "delivery_letter";
/** Which checklist items a signed document covers. */
export const DOC_ITEMS: Record<DocKind, string[]> = { disclosure_privacy: ["advisor_disclosure", "privacy_consent"], reason_why: ["recommendation"], fact_find: ["fact_find"], replacement_declaration: ["replacement_disclosure"], replacement_explanation: ["replacement_explanation"], delivery_letter: ["delivery_confirmation"] };

// ── The client's side ──────────────────────────────────────────────────────────────────────────────────────────────
export async function clientPending(db: any, contactId: string) {
  const { data: rows } = await db.from("insurance_document_signers").select("document_id, status").eq("contact_id", contactId).eq("status", "pending");
  const ids = (rows ?? []).map((r: any) => r.document_id);
  if (!ids.length) return [];
  const { data: docs } = await db.from("insurance_documents").select("id, title, sent_at, status, task_id").in("id", ids).in("status", ["sent", "partly_signed"]).order("sent_at", { ascending: false });
  return (docs ?? []).map((d: any) => ({ id: d.id, title: d.title, sent_at: d.sent_at, task_id: d.task_id ?? null }));
}

export async function clientGet(db: any, contactId: string, documentId: string) {
  const { data: me } = await db.from("insurance_document_signers").select("id, name, status, signed_at").eq("document_id", documentId).eq("contact_id", contactId).maybeSingle();
  if (!me) return { error: "Not available" };
  const { data: d } = await db.from("insurance_documents").select("id, kind, title, body_md, status, completed_at, agent_typed_name, agent_signed_at").eq("id", documentId).maybeSingle();
  if (!d || d.status === "void") return { error: "This document is no longer waiting for your signature." };
  const { data: c } = await db.from("contacts").select("email").eq("id", contactId).maybeSingle();
  const { data: others } = await db.from("insurance_document_signers").select("name, status").eq("document_id", documentId).neq("contact_id", contactId);
  const parts = String(d.body_md).split(CASL_MARKER);
  return { id: d.id, title: d.title, before: parts[0], after: parts.length > 1 ? parts.slice(1).join("") : null, needsCasl: parts.length > 1, statement: statementFor(d.kind), agent: d.agent_signed_at ? { name: d.agent_typed_name, signedAt: d.agent_signed_at } : null, signerName: me.name, signed: me.status === "signed", signedAt: me.signed_at, email: c?.email ?? "", others: (others ?? []).map((o: any) => ({ name: o.name, signed: o.status === "signed" })) };
}

export async function clientSign(db: any, contactId: string, documentId: string, input: any, ip: string | null, ua: string | null, onComplete: (documentId: string) => Promise<unknown> = async () => {}) {
  const { data: me } = await db.from("insurance_document_signers").select("id, name, status").eq("document_id", documentId).eq("contact_id", contactId).maybeSingle();
  if (!me) return { error: "Not available" };
  if (me.status === "signed") return { ok: true as const, alreadySigned: true };
  const { data: d } = await db.from("insurance_documents").select("id, kind, status, body_md").eq("id", documentId).maybeSingle();
  if (!d || d.status === "void" || d.status === "signed") return { error: "This document is no longer waiting for your signature." };
  const check = checkSignature(input ?? {}, me.name, String(d.body_md).includes(CASL_MARKER));
  if ("error" in check) return { error: check.error };
  // Only the first of two quick submissions counts: the update is conditional on the signer still being pending.
  const { data: upd } = await db.from("insurance_document_signers").update({ status: "signed", typed_name: check.typedName, casl_choice: check.caslChoice, casl_initials: check.caslInitials, casl_email: check.caslEmail, statement_text: `${statementFor(d.kind)} (version ${SIGN_STATEMENT_VERSION})`, signed_at: new Date().toISOString(), ip, user_agent: ua }).eq("id", me.id).eq("status", "pending").select("id");
  if (!upd?.length) return { ok: true as const, alreadySigned: true };
  const { data: rest } = await db.from("insurance_document_signers").select("id").eq("document_id", documentId).eq("status", "pending");
  const everyone = !(rest ?? []).length;
  await db.from("insurance_documents").update({ status: everyone ? "signed" : "partly_signed", ...(everyone ? { completed_at: new Date().toISOString() } : {}) }).eq("id", documentId);
  const { data: doc } = await db.from("insurance_documents").select("title, household_id").eq("id", documentId).maybeSingle();
  await db.from("staff_notifications").insert({ title: everyone ? `${doc?.title ?? "Document"} signed by everyone` : `${me.name} signed the ${doc?.title ?? "document"}`, body: everyone ? "All signatures are in. The signed copy is being filed." : "Waiting on the other signer.", link: `/insurance/${doc?.household_id}/compliance`, contact_id: contactId, source_type: "insurance_document" });
  if (everyone) await onComplete(documentId);
  return { ok: true as const, complete: everyone };
}


/** Documents this person has signed, newest first, with whether the signed copy is filed (so they can download it). */
export async function clientSigned(db: any, contactId: string) {
  const { data: rows } = await db.from("insurance_document_signers").select("document_id, signed_at").eq("contact_id", contactId).eq("status", "signed");
  const ids = (rows ?? []).map((r: any) => r.document_id);
  if (!ids.length) return [];
  const { data: docs } = await db.from("insurance_documents").select("id, title, status, pdf_drive_id").in("id", ids).neq("status", "void");
  const at = new Map((rows ?? []).map((r: any) => [r.document_id, r.signed_at]));
  return ((docs ?? []) as any[]).filter((d) => d.pdf_drive_id).map((d) => ({ id: d.id as string, title: d.title as string, signed_at: at.get(d.id) as string })).sort((a, b) => Date.parse(b.signed_at) - Date.parse(a.signed_at));
}

/** What the client's task is called: "Sign your ..." for the documents that are signed, "Review and confirm your ..." for the rest. Titles that already start with "Your" are not doubled. */
export function documentTaskTitle(kind: string, title: string): string {
  const signs = kind === "disclosure_privacy" || kind === "replacement_declaration";
  const yours = /^your\s/i.test(title) ? `your ${title.slice(5)}` : `your ${title}`;
  return `${signs ? "Sign" : "Review and confirm"} ${yours}`;
}
