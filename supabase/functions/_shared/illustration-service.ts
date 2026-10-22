// illustration-service.ts: reading a carrier's illustration PDF into a quote to review. The PDF is kept in the household's Advisor Files / Quotes (a copy; nothing
// is moved or deleted) and read by Vertex AI in Montreal. Nothing becomes a quote until Rolf has reviewed and saved the form.

// deno-lint-ignore-file no-explicit-any
import { GEMINI_EXTRACT_MODEL, generateVertexContent, parseServiceAccountKey, withThinking } from "./vertex-ai.ts";
import { uploadToAdvisorFiles } from "./insurance-doc-service.ts";
import { ILLUSTRATION_PROMPT, draftFromIllustration, type ParsedIllustration } from "./illustration-rules.ts";

export const MAX_ILLUSTRATION_BYTES = 6_000_000;
const TOOL = {
  name: "record_quote",
  description: "Record the facts of the quote with an exact quote from the document for each.",
  parameters: { type: "OBJECT", properties: { facts: { type: "ARRAY", items: { type: "OBJECT", properties: { key: { type: "STRING" }, value: { type: "STRING" }, quote: { type: "STRING" } }, required: ["key", "value", "quote"] } } }, required: ["facts"] },
};

export async function parseIllustration(db: any, input: { householdId: string; contactId: string; fileName: unknown; base64: unknown }): Promise<({ ok: true; drive: { id: string; url: string; name: string }; note: string } & ParsedIllustration) | { error: string }> {
  const b64 = String(input.base64 ?? "");
  if (b64.length < 100) return { error: "No file came through." };
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); } catch { return { error: "That file could not be read." }; }
  if (bytes.length > MAX_ILLUSTRATION_BYTES) return { error: "That PDF is over 6 MB. Save the illustration with fewer pages, or enter the quote by hand." };
  if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") return { error: "That is not a PDF. Upload the carrier's illustration as a PDF." };
  const { data: c } = await db.from("contacts").select("full_name, first_name, last_name, household_id").eq("id", input.contactId).eq("household_id", input.householdId).maybeSingle();
  if (!c) return { error: "Pick a person in this household." };
  const person = (c.full_name || `${c.first_name} ${c.last_name}`).trim();
  const clean = String(input.fileName ?? "illustration.pdf").replace(/[\\/:*?"<>|]/g, "-").replace(/\.pdf$/i, "").slice(0, 120) || "illustration";
  let drive;
  try { drive = await uploadToAdvisorFiles(db, input.householdId, "Quotes", `${clean}.pdf`, bytes); } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  let facts: unknown = [], note = "";
  try {
    const sa = await parseServiceAccountKey(Deno.env.get("GCP_SERVICE_ACCOUNT_KEY"));
    const result = await generateVertexContent(sa, GEMINI_EXTRACT_MODEL, [{ role: "user", parts: [{ text: ILLUSTRATION_PROMPT }, { inlineData: { mimeType: "application/pdf", data: b64 } }] }], withThinking(GEMINI_EXTRACT_MODEL, { temperature: 0.1, maxOutputTokens: 4096 }, "low"), { tools: [{ functionDeclarations: [TOOL] }], toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["record_quote"] } } });
    facts = (result.candidates?.[0]?.content?.parts || []).find((p: any) => p.functionCall)?.functionCall?.args?.facts ?? [];
  } catch (e) { note = `I could not read the illustration just now (${e instanceof Error ? e.message.slice(0, 100) : "error"}). The PDF is saved with the quote; fill the fields in by hand.`; }
  const parsed = draftFromIllustration(facts, person, drive.url);
  return { ok: true, drive, note, ...parsed };
}
