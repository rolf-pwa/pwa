// fact-find-service.ts: compiling a fact find for one person from the file, the meeting notes and the call transcripts; editing it; and sending it to the
// client to confirm. Read-only against Drive. The model only proposes facts, each with a quote that must appear in its source (see fact-find-rules.ts).

// deno-lint-ignore-file no-explicit-any
import { getServiceGoogleAccessToken } from "./google-token.ts";
import { GEMINI_EXTRACT_MODEL, generateVertexContent, parseServiceAccountKey, withThinking } from "./vertex-ai.ts";
import { FIELDS, assemble, askList, buildFileFacts, evidencePrompt, factFindMarkdown, validateModelFacts, type Evidence, type Fact } from "./fact-find-rules.ts";
import { adults, createAndSend } from "./insurance-doc-service.ts";
import { sha256Hex } from "./insurance-doc-rules.ts";

const DRIVE = "https://www.googleapis.com/drive/v3";
const ymd = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver" }).format(d);
const PER_SOURCE = 25_000, TOTAL = 100_000;
export const FACT_FIND_TITLE = "Your Fact Find";

const FACT_TOOL = {
  name: "record_facts",
  description: "Record the facts about the person that the sources state, each with the id of its source and an exact quote.",
  parameters: { type: "OBJECT", properties: { facts: { type: "ARRAY", items: { type: "OBJECT", properties: { key: { type: "STRING" }, value: { type: "STRING" }, evidence_id: { type: "STRING" }, quote: { type: "STRING" } }, required: ["key", "value", "evidence_id", "quote"] } } }, required: ["facts"] },
};

export async function gatherEvidence(db: any, householdId: string, memberIds: string[]): Promise<Evidence[]> {
  const out: Evidence[] = [];
  const { data: calls } = memberIds.length ? await db.from("quo_calls").select("occurred_at, direction, transcript, summary").in("contact_id", memberIds).order("occurred_at", { ascending: false }).limit(10) : { data: [] as any[] };
  for (const c of (calls ?? []) as any[]) {
    const text = String(c.transcript || c.summary || "").trim();
    if (text.length > 40) out.push({ id: "", type: "call", label: `Call on ${ymd(new Date(c.occurred_at))}`, date: ymd(new Date(c.occurred_at)), text: text.slice(0, PER_SOURCE) });
  }
  const { data: tasks } = await db.from("pm_tasks").select("id").or([`household_id.eq.${householdId}`, ...(memberIds.length ? [`contact_id.in.(${memberIds.join(",")})`] : [])].join(",")).limit(500);
  const taskIds = ((tasks ?? []) as any[]).map((t) => t.id);
  const { data: notes } = taskIds.length ? await db.from("meeting_notes_seen").select("doc_id, doc_name, doc_created_at").eq("status", "drafted").in("task_id", taskIds).order("doc_created_at", { ascending: false }).limit(5) : { data: [] as any[] };
  if ((notes ?? []).length) {
    const token = await getServiceGoogleAccessToken(db);
    for (const n of notes as any[]) {
      try {
        const r = await fetch(`${DRIVE}/files/${n.doc_id}/export?${new URLSearchParams({ mimeType: "text/plain", supportsAllDrives: "true" })}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(25_000) });
        if (!r.ok) continue;
        const text = (await r.text()).trim();
        if (text.length > 80) out.push({ id: "", type: "meeting", label: String(n.doc_name).replace(/\s*-?\s*Notes by Gemini\s*$/i, "").trim() || "Meeting notes", date: n.doc_created_at ? ymd(new Date(n.doc_created_at)) : "", text: text.slice(0, PER_SOURCE) });
      } catch { /* a notes document that cannot be read is skipped */ }
    }
  }
  let used = 0;
  const kept: Evidence[] = [];
  for (const e of out) { if (used + e.text.length > TOTAL) break; used += e.text.length; kept.push({ ...e, id: `E${kept.length + 1}` }); }
  return kept;
}

/** The latest fact find for each adult, newest first, with the adults themselves. */
export async function ffGet(db: any, householdId: string) {
  const people = await adults(db, householdId);
  const { data } = await db.from("insurance_fact_finds").select("id, contact_id, file_id, facts, evidence, dropped, status, document_id, created_at, updated_at").eq("household_id", householdId).order("created_at", { ascending: false });
  const seen = new Set<string>();
  const finds = ((data ?? []) as any[]).filter((f) => (seen.has(f.contact_id) ? false : (seen.add(f.contact_id), true)));
  return { adults: people, finds };
}

export async function ffCompile(db: any, who: string, householdId: string, contactId: string, fileId?: unknown) {
  const { data: c } = await db.from("contacts").select("id, first_name, last_name, full_name, email, phone, address, date_of_birth, is_minor, household_id, lawyer_name, lawyer_firm, executor_name, executor_firm, poa_name, poa_firm").eq("id", contactId).eq("household_id", householdId).maybeSingle();
  if (!c || c.is_minor) return { error: "Pick an adult in this household." };
  const [{ data: hh }, { data: members }, { data: liabilities }, { data: storehouses }, { data: policies }] = await Promise.all([
    db.from("households").select("vision_notes, values_notes, purpose_notes, pressure_types, pressure_note").eq("id", householdId).maybeSingle(),
    db.from("contacts").select("id, first_name, last_name, full_name, date_of_birth, is_minor").eq("household_id", householdId),
    db.from("liabilities").select("liability_type, current_balance").eq("contact_id", contactId),
    db.from("storehouses").select("asset_type, current_value").eq("contact_id", contactId),
    db.from("insurance_policies").select("carrier, policy_type, coverage_amount").eq("contact_id", contactId),
  ]);
  const name = (c.full_name || `${c.first_name} ${c.last_name}`).trim();
  const fileFacts = buildFileFacts({ contact: c, household: hh ?? {}, minors: ((members ?? []) as any[]).filter((m) => m.is_minor).map((m) => ({ name: (m.full_name || `${m.first_name} ${m.last_name}`).trim(), date_of_birth: m.date_of_birth })), liabilities: liabilities ?? [], storehouses: storehouses ?? [], policies: policies ?? [], today: ymd() });

  const evidence = await gatherEvidence(db, householdId, ((members ?? []) as any[]).map((m) => m.id));
  let modelFacts: Fact[] = [], dropped = 0, note = "";
  if (evidence.length) {
    try {
      const sa = await parseServiceAccountKey(Deno.env.get("GCP_SERVICE_ACCOUNT_KEY"));
      const result = await generateVertexContent(sa, GEMINI_EXTRACT_MODEL, [{ role: "user", parts: [{ text: evidencePrompt(name, evidence) }] }], withThinking(GEMINI_EXTRACT_MODEL, { temperature: 0.1, maxOutputTokens: 4096 }, "low"), { tools: [{ functionDeclarations: [FACT_TOOL] }], toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["record_facts"] } } });
      const call = (result.candidates?.[0]?.content?.parts || []).find((p: any) => p.functionCall)?.functionCall;
      const v = validateModelFacts(call?.args?.facts, evidence);
      modelFacts = v.facts; dropped = v.dropped;
    } catch (e) { note = `The meeting and call notes could not be read just now (${e instanceof Error ? e.message.slice(0, 120) : "error"}). Only the file facts are filled in; compile again in a few minutes.`; }
  } else note = "There are no meeting notes or call transcripts for this household yet, so only the file facts are filled in.";

  const facts = assemble(fileFacts, modelFacts);
  const { data: row, error } = await db.from("insurance_fact_finds").insert({ household_id: householdId, contact_id: contactId, file_id: fileId ? String(fileId) : null, facts, evidence: evidence.map(({ text, ...e }) => ({ ...e, chars: text.length })), dropped, created_by: who }).select("id").single();
  if (error) return { error: error.message };
  return { ok: true as const, id: row.id as string, note, asks: askList(facts), fromNotes: modelFacts.length, dropped };
}

/** Rolf's edits: a changed value becomes his own (status edited). Only known fields, and only text. */
export async function ffSave(db: any, id: string, edits: unknown) {
  const { data: row } = await db.from("insurance_fact_finds").select("id, facts, status").eq("id", id).maybeSingle();
  if (!row) return { error: "Fact find not found." };
  if (row.status === "confirmed") return { error: "This fact find is already confirmed by the client. Compile a new one to change it." };
  const byKey = new Map<string, string>((Array.isArray(edits) ? edits : []).filter((e: any) => FIELDS.some((f) => f.key === e?.key)).map((e: any) => [String(e.key), String(e.value ?? "").trim().slice(0, 600)] as [string, string]));
  const facts = (row.facts as Fact[]).map((f) => {
    if (!byKey.has(f.key)) return f;
    const value = byKey.get(f.key)!;
    if (value === f.value) return f;
    return value ? { ...f, value, status: "edited" as const, source: { type: "client" as const, label: "Edited by Rolf" } } : { ...f, value: "", status: "missing" as const, source: { type: "none" as const, label: "Not found" } };
  });
  await db.from("insurance_fact_finds").update({ facts, updated_at: new Date().toISOString() }).eq("id", id);
  return { ok: true as const, facts };
}

export async function ffSend(db: any, who: string, id: string, fileId?: unknown) {
  const { data: row } = await db.from("insurance_fact_finds").select("id, household_id, contact_id, facts, status, file_id").eq("id", id).maybeSingle();
  if (!row) return { error: "Fact find not found." };
  if (row.status === "confirmed") return { error: "Already confirmed by the client." };
  const { data: c } = await db.from("contacts").select("id, first_name, last_name, full_name").eq("id", row.contact_id).maybeSingle();
  const name = (c?.full_name || `${c?.first_name} ${c?.last_name}`).trim();
  const md = factFindMarkdown(name, row.facts as Fact[]);
  const r: any = await createAndSend(db, who, { householdId: row.household_id, kind: "fact_find", title: FACT_FIND_TITLE, md, hash: await sha256Hex(md), driveId: "none", modified: null, version: null, signers: [{ id: row.contact_id, name }], fileId: fileId ?? row.file_id });
  if (r.error) return r;
  await db.from("insurance_fact_finds").update({ status: "sent", document_id: r.id, file_id: fileId ? String(fileId) : row.file_id, updated_at: new Date().toISOString() }).eq("id", id);
  return { ok: true as const, documentId: r.id as string };
}
