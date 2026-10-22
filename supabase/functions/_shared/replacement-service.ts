// replacement-service.ts: replacing a life insurance policy. Compiles the written explanation from the file and the meeting notes and calls (a model-proposed
// fact is kept only if it quotes its source), lets Rolf fill in what is missing, and sends the explanation and the Declaration to the client together. Rolf
// signs the Declaration as the agent when he sends, confirming the application for the new policy has not been started.

// deno-lint-ignore-file no-explicit-any
import { GEMINI_EXTRACT_MODEL, generateVertexContent, parseServiceAccountKey, withThinking } from "./vertex-ai.ts";
import { evidencePrompt, validateModelFacts, type Fact } from "./fact-find-rules.ts";
import { gatherEvidence } from "./fact-find-service.ts";
import { adults, createAndSend } from "./insurance-doc-service.ts";
import { nameMatches, sha256Hex } from "./insurance-doc-rules.ts";
import { EXPLANATION_TITLE, LIRD_AGENT_STATEMENT, LIRD_MD, LIRD_TITLE, REPL_ASKS, REPL_FIELDS, assembleReplacement, explanationMarkdown, policyFacts } from "./replacement-rules.ts";

const FACT_TOOL = {
  name: "record_facts",
  description: "Record the facts the sources state, each with the id of its source and an exact quote.",
  parameters: { type: "OBJECT", properties: { facts: { type: "ARRAY", items: { type: "OBJECT", properties: { key: { type: "STRING" }, value: { type: "STRING" }, evidence_id: { type: "STRING" }, quote: { type: "STRING" } }, required: ["key", "value", "evidence_id", "quote"] } } }, required: ["facts"] },
};
const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
const str = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

export async function rGet(db: any, householdId: string) {
  const people = await adults(db, householdId);
  const ids = people.map((p) => p.id);
  const { data: policies } = ids.length ? await db.from("insurance_policies").select("id, carrier, policy_type, policy_number, coverage_amount, premium_amount, premium_frequency, cash_value, insured_name, contact_id").in("contact_id", ids) : { data: [] as any[] };
  const { data: rows } = await db.from("insurance_replacements").select("id, file_id, client_ids, replaced_policy_id, new_policy, facts, evidence, dropped, status, explanation_doc_id, declaration_doc_id, created_at, sent_at").eq("household_id", householdId).order("created_at", { ascending: false }).limit(10);
  return { adults: people, policies: policies ?? [], replacements: rows ?? [], declaration: LIRD_MD };
}

export async function rCompile(db: any, who: string, input: { householdId: string; clientIds: unknown; policyId: unknown; newPolicy: any; fileId?: unknown }) {
  const people = await adults(db, input.householdId);
  const clients = people.filter((p) => (Array.isArray(input.clientIds) ? (input.clientIds as string[]) : []).includes(p.id));
  if (!clients.length) return { error: "Pick who the declaration is for: the client, and the life insured if that is someone else." };
  const { data: policy } = await db.from("insurance_policies").select("id, carrier, policy_type, policy_number, coverage_amount, premium_amount, premium_frequency, cash_value, insured_name, contact_id").eq("id", String(input.policyId ?? "")).maybeSingle();
  if (!policy || !people.some((p) => p.id === policy.contact_id)) return { error: "Pick the policy that is being replaced." };
  const np = { product: str(input.newPolicy?.product, 120), carrier: str(input.newPolicy?.carrier, 120), coverage: num(input.newPolicy?.coverage), premium: num(input.newPolicy?.premium), frequency: str(input.newPolicy?.frequency, 20) || null };
  if (!np.product || !np.carrier) return { error: "Say what the new policy is and which carrier it is with." };
  const fileFacts = policyFacts(policy, np);

  const evidence = await gatherEvidence(db, input.householdId, people.map((p) => p.id));
  let modelFacts: Fact[] = [], dropped = 0, note = "";
  if (evidence.length) {
    try {
      const sa = await parseServiceAccountKey(Deno.env.get("GCP_SERVICE_ACCOUNT_KEY"));
      const subject = `${clients.map((c) => c.name).join(" and ")} (about replacing their ${policy.policy_type.replace(/_/g, " ")} policy with ${policy.carrier} by a ${np.product} with ${np.carrier})`;
      const result = await generateVertexContent(sa, GEMINI_EXTRACT_MODEL, [{ role: "user", parts: [{ text: evidencePrompt(subject, evidence, REPL_FIELDS, "for the written explanation of the advantages and disadvantages of replacing a life insurance policy. Only record what was actually said about the present policy, the new policy, the reasons for the change, and how they compare") }] }], withThinking(GEMINI_EXTRACT_MODEL, { temperature: 0.1, maxOutputTokens: 4096 }, "low"), { tools: [{ functionDeclarations: [FACT_TOOL] }], toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["record_facts"] } } });
      const call = (result.candidates?.[0]?.content?.parts || []).find((p: any) => p.functionCall)?.functionCall;
      const v = validateModelFacts(call?.args?.facts, evidence, REPL_FIELDS);
      modelFacts = v.facts; dropped = v.dropped;
    } catch (e) { note = `The meeting and call notes could not be read just now (${e instanceof Error ? e.message.slice(0, 120) : "error"}). Compile again in a few minutes, or fill the answers in by hand.`; }
  } else note = "There are no meeting notes or call transcripts for this household yet, so only the two policies are filled in.";
  const facts = assembleReplacement(fileFacts, modelFacts);
  let fileId: string | null = null;
  if (input.fileId) { const { data: f } = await db.from("insurance_files").select("id").eq("id", String(input.fileId)).eq("household_id", input.householdId).maybeSingle(); fileId = f?.id ?? null; }
  const { data: row, error } = await db.from("insurance_replacements").insert({ household_id: input.householdId, file_id: fileId, client_ids: clients.map((c) => c.id), replaced_policy_id: policy.id, new_policy: np, facts, evidence: evidence.map(({ text, ...e }) => ({ ...e, chars: text.length })), dropped, created_by: who }).select("id").single();
  if (error) return { error: error.message };
  return { ok: true as const, id: row.id as string, note, asks: REPL_ASKS(facts), fromNotes: modelFacts.length, dropped };
}

export async function rSave(db: any, id: string, edits: unknown) {
  const { data: row } = await db.from("insurance_replacements").select("id, facts, status").eq("id", id).maybeSingle();
  if (!row) return { error: "Not found." };
  if (row.status !== "draft") return { error: "This has already been sent. Compile a new one to change it." };
  const byKey = new Map<string, string>((Array.isArray(edits) ? edits : []).filter((e: any) => REPL_FIELDS.some((f) => f.key === e?.key)).map((e: any) => [String(e.key), String(e.value ?? "").trim().slice(0, 2000)] as [string, string]));
  const facts = (row.facts as Fact[]).map((f) => {
    if (!byKey.has(f.key) || byKey.get(f.key) === f.value) return f;
    const value = byKey.get(f.key)!;
    return value ? { ...f, value, status: "edited" as const, source: { type: "client" as const, label: "Edited by Rolf" } } : { ...f, value: "", status: "missing" as const, source: { type: "none" as const, label: "Not found" } };
  });
  await db.from("insurance_replacements").update({ facts, updated_at: new Date().toISOString() }).eq("id", id);
  return { ok: true as const, facts };
}

export async function rSend(db: any, who: string, id: string, input: { typedName: unknown; agree: unknown; noApplication: unknown; fileId?: unknown; ip: string | null }) {
  const { data: row } = await db.from("insurance_replacements").select("*").eq("id", id).maybeSingle();
  if (!row) return { error: "Not found." };
  if (row.status !== "draft") return { error: "This has already been sent." };
  const facts = row.facts as Fact[];
  const blank = facts.filter((f) => !f.value.trim());
  if (blank.length) return { error: `Still to fill in: ${blank.map((f) => f.label.toLowerCase()).slice(0, 4).join("; ")}${blank.length > 4 ? ` and ${blank.length - 4} more` : ""}. Write "Not applicable" where a question does not apply.` };
  if (input.noApplication !== true) return { error: "Confirm that the application for the new policy has not been started." };
  if (input.agree !== true) return { error: "Tick the box to confirm you have given the client the Declaration and the written explanation." };
  const { data: prof } = await db.from("profiles").select("full_name").eq("email", who).maybeSingle();
  const agentName = String(prof?.full_name || "Rolf Issler");
  if (!nameMatches(String(input.typedName ?? ""), agentName)) return { error: `Type your full name as the agent: ${agentName}.` };

  const people = await adults(db, row.household_id);
  const clients = people.filter((p) => (row.client_ids as string[]).includes(p.id));
  if (!clients.length) return { error: "The clients on this are no longer in the household." };
  const fileId = input.fileId ?? row.file_id;
  const expMd = explanationMarkdown(clients.map((c) => c.name.split(" ")[0]).join(" and "), facts);
  const common = { householdId: row.household_id, signers: clients, fileId, modified: null, version: null, driveId: "none" };
  const a: any = await createAndSend(db, who, { ...common, kind: "replacement_explanation", title: EXPLANATION_TITLE, md: expMd, hash: await sha256Hex(expMd) });
  if (a.error) return a;
  const b: any = await createAndSend(db, who, { ...common, kind: "replacement_declaration", title: LIRD_TITLE, md: LIRD_MD, hash: await sha256Hex(LIRD_MD), version: "ICN 12-003 (Feb 3, 2012)" });
  if (b.error) return b;
  await db.from("insurance_documents").update({ agent_name: agentName, agent_typed_name: String(input.typedName).trim().slice(0, 120), agent_signed_at: new Date().toISOString(), agent_ip: input.ip, agent_statement: LIRD_AGENT_STATEMENT }).eq("id", b.id);
  await db.from("insurance_replacements").update({ status: "sent", explanation_doc_id: a.id, declaration_doc_id: b.id, sent_at: new Date().toISOString(), file_id: fileId ? String(fileId) : row.file_id, updated_at: new Date().toISOString() }).eq("id", id);
  return { ok: true as const, explanationId: a.id as string, declarationId: b.id as string };
}
