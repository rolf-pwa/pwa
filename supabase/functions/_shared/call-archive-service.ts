// call-archive-service.ts: copying call recordings to the client's Advisor Files / Call Recordings and transcribing them with our own AI. Additive in Drive:
// Callizy keeps its copy and nothing is moved or deleted. A few calls per run, newest first, so a nightly schedule works through the backlog.

// deno-lint-ignore-file no-explicit-any
import { callizyDownload, callizyGet, firstUrl } from "./callizy.ts";
import { buildBrandedPdf } from "./simple-pdf.ts";
import { GEMINI_EXTRACT_MODEL, generateVertexContent, parseServiceAccountKey, withThinking } from "./vertex-ai.ts";
import { uploadToAdvisorFiles } from "./insurance-doc-service.ts";
import { MAX_ARCHIVE_BYTES, MAX_TRANSCRIBE_BYTES, TRANSCRIBE_PROMPT, audioType, callFileNames, checkTranscription, transcriptBlocks, wantsArchive, type Transcription } from "./call-archive-rules.ts";

const TOOL = {
  name: "record_call",
  description: "Record the transcript of the call, a short summary and the next steps.",
  parameters: { type: "OBJECT", properties: { transcript: { type: "STRING" }, summary: { type: "STRING" }, next_steps: { type: "ARRAY", items: { type: "STRING" } } }, required: ["transcript", "summary", "next_steps"] },
};
const footer = () => `© ${new Date().getFullYear()} Issler Group Management & Consulting Inc. o/a ProsperWise Advisors · www.prosperwise.ca`;
const COLS = "id, quo_call_id, provider, is_voicemail, status, direction, duration_seconds, occurred_at, contact_id, transcript, summary, archived_at, archive_attempts";

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function transcribe(bytes: Uint8Array, mime: string): Promise<Transcription | null> {
  const sa = await parseServiceAccountKey(Deno.env.get("GCP_SERVICE_ACCOUNT_KEY"));
  const result = await generateVertexContent(sa, GEMINI_EXTRACT_MODEL, [{ role: "user", parts: [{ text: TRANSCRIBE_PROMPT }, { inlineData: { mimeType: mime, data: toBase64(bytes) } }] }], withThinking(GEMINI_EXTRACT_MODEL, { temperature: 0, maxOutputTokens: 16384 }, "minimal"), { tools: [{ functionDeclarations: [TOOL] }], toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["record_call"] } } });
  const args = (result.candidates?.[0]?.content?.parts || []).find((p: any) => p.functionCall)?.functionCall?.args;
  return checkTranscription(args);
}

type Outcome = "archived" | "skipped" | "failed";
async function archiveOne(db: any, call: any): Promise<{ outcome: Outcome; transcribed: boolean }> {
  const note = (n: string | null, attempt = false) => db.from("quo_calls").update({ archive_note: n, ...(attempt ? { archive_attempts: (call.archive_attempts ?? 0) + 1 } : {}) }).eq("id", call.id);
  const ageMs = Date.now() - Date.parse(call.occurred_at);
  if (ageMs < 20 * 60_000) return { outcome: "skipped", transcribed: false };
  if (!call.contact_id) { await note("Not a matched client, so not copied."); return { outcome: "skipped", transcribed: false }; }
  const { data: c } = await db.from("contacts").select("first_name, last_name, full_name, household_id").eq("id", call.contact_id).maybeSingle();
  const { data: hh } = c?.household_id ? await db.from("households").select("vault_folder_id").eq("id", c.household_id).maybeSingle() : { data: null };
  if (!c?.household_id || !hh?.vault_folder_id) { await note("This client has no household Vault folder yet, so the call is not copied."); return { outcome: "skipped", transcribed: false }; }

  const id = encodeURIComponent(call.quo_call_id);
  const link = firstUrl(call.is_voicemail ? await callizyGet(`/voicemails/${id}/`) : await callizyGet(`/calls/${id}/recording/`));
  if (!link) { await note("The recording is not available from Callizy yet.", ageMs > 24 * 3_600_000); return { outcome: "skipped", transcribed: false }; }
  const dl = await callizyDownload(link, MAX_ARCHIVE_BYTES);
  const type = audioType(dl.contentType, link);
  const names = callFileNames(call.occurred_at, [c], type.ext, !!call.is_voicemail);
  const rec = await uploadToAdvisorFiles(db, c.household_id, "Call Recordings", names.audio, dl.bytes, type.mime);

  // The transcript: what is already stored (a voicemail's, or Callizy's if its AI was on), else ours from the audio.
  let t: Transcription | null = call.transcript ? checkTranscription({ transcript: call.transcript, summary: call.summary, next_steps: [] }) : null;
  let source = t ? "callizy" : null, noteText: string | null = null, transcribed = false;
  if (!t) {
    if (dl.bytes.length > MAX_TRANSCRIBE_BYTES) noteText = "The recording is long, so it was copied to Drive but not transcribed automatically.";
    else { t = await transcribe(dl.bytes, type.mime); if (t) { source = "vertex"; transcribed = true; } else noteText = "The recording was copied, but no transcript could be made from it."; }
  }
  let transcriptUrl: string | null = null;
  if (t) {
    const person = (c.full_name || `${c.first_name} ${c.last_name}`).trim();
    const pdf = buildBrandedPdf({ eyebrow: "ProsperWise Advisors", title: call.is_voicemail ? "Voicemail Transcript" : "Call Transcript", subtitle: person, footer: footer(), blocks: transcriptBlocks({ person, startedAt: call.occurred_at, durationSeconds: call.duration_seconds, direction: call.direction, t }) });
    transcriptUrl = (await uploadToAdvisorFiles(db, c.household_id, "Call Recordings", names.transcript, pdf)).url;
  }
  await db.from("quo_calls").update({
    archived_at: new Date().toISOString(), recording_drive_id: rec.id, recording_drive_url: rec.url, transcript_drive_url: transcriptUrl, transcript_source: source, archive_note: noteText,
    ...(transcribed && t ? { transcript: t.transcript, summary: t.summary || null, next_steps: t.nextSteps.length ? t.nextSteps.join("\n") : null } : {}),
  }).eq("id", call.id);
  return { outcome: "archived", transcribed };
}

/** One run: a few calls, newest first (or the one call asked for). Returns a line for the health page. */
export async function archiveCalls(db: any, opts: { callId?: string; limit?: number; budgetMs?: number } = {}): Promise<string> {
  const started = Date.now(), budget = opts.budgetMs ?? 110_000, limit = opts.limit ?? 3;
  let rows: any[] = [];
  if (opts.callId) { const { data } = await db.from("quo_calls").select(COLS).eq("id", opts.callId).eq("provider", "callizy").maybeSingle(); rows = data ? [data] : []; }
  else { const { data } = await db.from("quo_calls").select(COLS).eq("provider", "callizy").is("archived_at", null).order("occurred_at", { ascending: false }).limit(60); rows = ((data ?? []) as any[]).filter((r) => wantsArchive(r, Date.now())); }
  const tally = { archived: 0, transcribed: 0, skipped: 0, failed: 0 };
  let done = 0;
  for (const call of rows) {
    if (done >= limit || Date.now() - started > budget) break;
    try {
      const r = await archiveOne(db, call);
      tally[r.outcome]++; if (r.transcribed) tally.transcribed++;
      if (r.outcome === "archived" || opts.callId) done++;
    } catch (e) {
      tally.failed++; done++;
      await db.from("quo_calls").update({ archive_note: `Could not copy: ${(e instanceof Error ? e.message : String(e)).slice(0, 180)}`, archive_attempts: (call.archive_attempts ?? 0) + 1 }).eq("id", call.id);
      console.error("[call-archive]", call.id, e);
    }
  }
  return `${tally.archived} copied, ${tally.transcribed} transcribed, ${tally.skipped} left for later, ${tally.failed} failed`;
}
