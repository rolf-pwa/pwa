// issuance-service.ts: the application and delivery of an insurance policy. The application documents and the issued contract are saved in Drive by Rolf; here they
// are attached to the insurance file (the contract, with iA's electronic delivery, is the proof of delivery), the contract is read into a policy record to review,
// the policy is recorded as in force, and a closing letter goes to the client to confirm. Read-only against Drive.

// deno-lint-ignore-file no-explicit-any
import { getServiceGoogleAccessToken } from "./google-token.ts";
import { GEMINI_EXTRACT_MODEL, generateVertexContent, parseServiceAccountKey, withThinking } from "./vertex-ai.ts";
import { adults, createAndSend } from "./insurance-doc-service.ts";
import { attachItem } from "./insurance-file-service.ts";
import { parseDriveId } from "./insurance-file-rules.ts";
import { sha256Hex } from "./insurance-doc-rules.ts";
import { CONTRACT_PROMPT, DELIVERY_TITLE, deliveryLetterMarkdown, draftFromContract, type IssuanceDraft, type ParsedContract } from "./issuance-rules.ts";

const DRIVE = "https://www.googleapis.com/drive/v3";
const MAX_CONTRACT_BYTES = 12_000_000;
const TOOL = {
  name: "record_policy",
  description: "Record the facts of the issued policy with an exact quote from the document for each.",
  parameters: { type: "OBJECT", properties: { facts: { type: "ARRAY", items: { type: "OBJECT", properties: { key: { type: "STRING" }, value: { type: "STRING" }, quote: { type: "STRING" } }, required: ["key", "value", "quote"] } } }, required: ["facts"] },
};
const FREQS = ["monthly", "quarterly", "semi_annual", "annual"];
const TYPES = ["term", "whole_life", "universal_life", "critical_illness", "disability", "long_term_care", "other"];
const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
const str = (v: unknown, n = 200) => String(v ?? "").trim().slice(0, n);
const dateOrNull = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : null);

export async function iGet(db: any, householdId: string) {
  const people = await adults(db, householdId);
  const { data } = await db.from("insurance_issuances").select("id, file_id, contact_id, policy_id, carrier, product, policy_type, policy_number, issued_on, delivered_on, contract_url, application_urls, letter_document_id, status, created_at").eq("household_id", householdId).order("created_at", { ascending: false }).limit(10);
  return { adults: people, issuances: data ?? [] };
}

/** Reads the issued contract from Drive into a policy record to review. */
export async function iRead(db: any, input: { householdId: string; contactId: string; contractLink: unknown }): Promise<({ ok: true; contract: { id: string; name: string; url: string }; note: string } & ParsedContract) | { error: string }> {
  const id = parseDriveId(String(input.contractLink ?? ""));
  if (!id) return { error: "Paste the Google Drive link to the issued policy contract." };
  const { data: c } = await db.from("contacts").select("full_name, first_name, last_name").eq("id", input.contactId).eq("household_id", input.householdId).maybeSingle();
  if (!c) return { error: "Pick a person in this household." };
  const person = (c.full_name || `${c.first_name} ${c.last_name}`).trim();
  const token = await getServiceGoogleAccessToken(db);
  const meta = await fetch(`${DRIVE}/files/${id}?${new URLSearchParams({ fields: "id,name,mimeType,size,webViewLink", supportsAllDrives: "true" })}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(25_000) });
  if (!meta.ok) return { error: meta.status === 404 ? "I could not open that link. Check it, and that the file is in your Drive." : `Drive said no (${meta.status}).` };
  const m = await meta.json();
  if (m.mimeType !== "application/pdf") return { error: "That file is not a PDF. Save the policy contract as a PDF in Drive." };
  if (Number(m.size) > MAX_CONTRACT_BYTES) return { error: "That PDF is over 12 MB. Enter the policy details by hand, or save a shorter copy." };
  const file = { id: m.id as string, name: m.name as string, url: (m.webViewLink as string) ?? `https://drive.google.com/file/d/${m.id}/view` };
  const dl = await fetch(`${DRIVE}/files/${id}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(40_000) });
  if (!dl.ok) return { error: `Drive could not give me the file (${dl.status}).` };
  const bytes = new Uint8Array(await dl.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  let facts: unknown = [], note = "";
  try {
    const sa = await parseServiceAccountKey(Deno.env.get("GCP_SERVICE_ACCOUNT_KEY"));
    const result = await generateVertexContent(sa, GEMINI_EXTRACT_MODEL, [{ role: "user", parts: [{ text: CONTRACT_PROMPT }, { inlineData: { mimeType: "application/pdf", data: btoa(bin) } }] }], withThinking(GEMINI_EXTRACT_MODEL, { temperature: 0.1, maxOutputTokens: 4096 }, "low"), { tools: [{ functionDeclarations: [TOOL] }], toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["record_policy"] } } });
    facts = (result.candidates?.[0]?.content?.parts || []).find((p: any) => p.functionCall)?.functionCall?.args?.facts ?? [];
  } catch (e) { note = `I could not read the contract just now (${e instanceof Error ? e.message.slice(0, 100) : "error"}). Fill the details in by hand.`; }
  return { ok: true, contract: file, note, ...draftFromContract(facts, person) };
}

export async function iSave(db: any, who: string, input: { householdId: string; contactId: string; fileId?: unknown; draft: any; contractLink: unknown; applicationLinks: unknown; contingent?: unknown }) {
  const people = await adults(db, input.householdId);
  const person = people.find((p) => p.id === input.contactId);
  if (!person) return { error: "Pick a person in this household." };
  const d = input.draft ?? {};
  const rec = { carrier: str(d.carrier, 120), product: str(d.product, 160), policy_type: TYPES.includes(d.policy_type) ? d.policy_type : "other", policy_number: str(d.policy_number, 80), coverage_amount: num(d.coverage_amount), premium_amount: num(d.premium_amount), premium_frequency: FREQS.includes(d.premium_frequency) ? d.premium_frequency : null, issued_on: dateOrNull(d.issued_on), delivered_on: dateOrNull(d.delivered_on), primary_beneficiary: str(d.primary_beneficiary, 160) || null };
  if (!rec.carrier || !rec.product || !rec.policy_number) return { error: "The carrier, the product and the policy number are needed to record the policy." };
  const contractId = parseDriveId(String(input.contractLink ?? ""));
  if (!contractId) return { error: "Paste the Google Drive link to the issued policy contract: it is the proof of delivery." };
  const appLinks = (Array.isArray(input.applicationLinks) ? input.applicationLinks : []).map((l: unknown) => str(l, 400)).filter(Boolean).slice(0, 12);

  // The policy, recorded as in force: updated if this policy number is already on file for the person.
  const { data: existing } = await db.from("insurance_policies").select("id").eq("contact_id", person.id).ilike("policy_number", rec.policy_number).maybeSingle();
  const policyRow = { contact_id: person.id, carrier: rec.carrier, policy_number: rec.policy_number, policy_type: rec.policy_type, insured_name: person.name, coverage_amount: rec.coverage_amount ?? 0, premium_amount: rec.premium_amount, premium_frequency: rec.premium_frequency, issue_date: rec.issued_on, primary_beneficiary: rec.primary_beneficiary, contingent_beneficiary: str(input.contingent, 160) || null, notes: `${rec.product}. Recorded from the issued contract.`, updated_at: new Date().toISOString() };
  const w = existing ? await db.from("insurance_policies").update(policyRow).eq("id", existing.id).select("id").single() : await db.from("insurance_policies").insert(policyRow).select("id").single();
  if (w.error) return { error: `The policy could not be recorded: ${w.error.message}` };

  let fileId: string | null = null;
  if (input.fileId) { const { data: f } = await db.from("insurance_files").select("id").eq("id", String(input.fileId)).eq("household_id", input.householdId).maybeSingle(); fileId = f?.id ?? null; }
  const { data: row, error } = await db.from("insurance_issuances").insert({ household_id: input.householdId, file_id: fileId, contact_id: person.id, policy_id: w.data.id, carrier: rec.carrier, product: rec.product, policy_type: rec.policy_type, policy_number: rec.policy_number, coverage_amount: rec.coverage_amount, premium_amount: rec.premium_amount, premium_frequency: rec.premium_frequency, issued_on: rec.issued_on, delivered_on: rec.delivered_on, primary_beneficiary: rec.primary_beneficiary, contract_url: `https://drive.google.com/file/d/${contractId}/view`, contract_drive_id: contractId, application_urls: appLinks, created_by: who }).select("id").single();
  if (error) return { error: error.message };

  const problems: string[] = [];
  if (fileId) {
    for (const link of appLinks) { const r: any = await attachItem(db, who, fileId, "application", { driveLink: link, note: `${rec.carrier} application` }); if (r.error) problems.push(`Application: ${r.error}`); }
    const r: any = await attachItem(db, who, fileId, "delivery_confirmation", { driveLink: String(input.contractLink), note: `Issued contract${rec.delivered_on ? `; delivered electronically by ${rec.carrier} on ${rec.delivered_on}` : ""}` });
    if (r.error) problems.push(`Contract: ${r.error}`);
  }
  return { ok: true as const, id: row.id as string, policyId: w.data.id as string, updatedPolicy: !!existing, attachedToFile: !!fileId, problems };
}

/** The built-in closing letter for a recorded policy, ready for Rolf to edit. */
export async function iLetter(db: any, id: string) {
  const { data: r } = await db.from("insurance_issuances").select("*").eq("id", id).maybeSingle();
  if (!r) return { error: "Not found." };
  const { data: c } = await db.from("contacts").select("first_name, full_name").eq("id", r.contact_id).maybeSingle();
  const md = deliveryLetterMarkdown({ firstNames: c?.first_name || (c?.full_name ?? "").split(" ")[0] || "there", carrier: r.carrier, product: r.product, policy_type: r.policy_type, policy_number: r.policy_number, coverage_amount: r.coverage_amount ? Number(r.coverage_amount) : null, premium_amount: r.premium_amount ? Number(r.premium_amount) : null, premium_frequency: r.premium_frequency, issued_on: r.issued_on, delivered_on: r.delivered_on, primary_beneficiary: r.primary_beneficiary });
  return { ok: true as const, md, status: r.status as string };
}

export async function iSend(db: any, who: string, id: string, input: { bodyMd?: unknown; fileId?: unknown }) {
  const { data: r } = await db.from("insurance_issuances").select("*").eq("id", id).maybeSingle();
  if (!r) return { error: "Not found." };
  if (r.status === "confirmed") return { error: "The client has already confirmed this letter." };
  const people = await adults(db, r.household_id);
  const person = people.find((p) => p.id === r.contact_id);
  if (!person) return { error: "The client is no longer in the household." };
  const gen: any = typeof input.bodyMd === "string" && input.bodyMd.trim() ? { md: input.bodyMd.trim().slice(0, 30_000) } : await iLetter(db, id);
  if (gen.error) return gen;
  if (/_{3,}/.test(gen.md)) return { error: "The letter still has blanks to fill in." };
  const sent: any = await createAndSend(db, who, { householdId: r.household_id, kind: "delivery_letter", title: DELIVERY_TITLE, md: gen.md, hash: await sha256Hex(gen.md), driveId: "none", modified: null, version: null, signers: [{ id: person.id, name: person.name }], fileId: input.fileId ?? r.file_id });
  if (sent.error) return sent;
  await db.from("insurance_issuances").update({ letter_document_id: sent.id, status: "sent", updated_at: new Date().toISOString() }).eq("id", id);
  return { ok: true as const, documentId: sent.id as string };
}
export type { IssuanceDraft };
