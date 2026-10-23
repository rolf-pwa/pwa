// call-archive-rules.ts: copying call recordings to the client's Advisor Files and transcribing them with our own AI. Pure.
// Nothing is moved or deleted anywhere: Callizy keeps its copy, and the copy in Drive is added beside the client's other files.
import type { Block } from "./simple-pdf.ts";
import { conventionName, type Person } from "./file-naming.ts";

/** Longest recording (bytes) sent to the AI in one go; longer ones are archived to Drive and left for Rolf to listen to. */
export const MAX_TRANSCRIBE_BYTES = 14_000_000;
export const MAX_ARCHIVE_BYTES = 60_000_000;
export const MAX_ATTEMPTS = 5;

export interface CallRow { id: string; is_voicemail: boolean; status: string | null; duration_seconds: number | null; occurred_at: string; archived_at: string | null; archive_attempts: number | null }

/** A call is worth archiving when it was a real conversation or a voicemail, not already copied, and not given up on. */
export function wantsArchive(c: CallRow, nowMs: number, windowDays = 30): boolean {
  if (c.archived_at) return false;
  if ((c.archive_attempts ?? 0) >= MAX_ATTEMPTS) return false;
  if (Date.parse(c.occurred_at) < nowMs - windowDays * 86_400_000) return false;
  if (c.is_voicemail) return true;
  if (/miss|no.?answer|busy|fail|cancel/i.test(String(c.status ?? ""))) return false;
  return (c.duration_seconds ?? 0) >= 5;
}

const KNOWN: Record<string, { mime: string; ext: string }> = {
  "audio/mpeg": { mime: "audio/mpeg", ext: "mp3" }, "audio/mp3": { mime: "audio/mpeg", ext: "mp3" }, "audio/wav": { mime: "audio/wav", ext: "wav" }, "audio/x-wav": { mime: "audio/wav", ext: "wav" },
  "audio/wave": { mime: "audio/wav", ext: "wav" }, "audio/ogg": { mime: "audio/ogg", ext: "ogg" }, "audio/aac": { mime: "audio/aac", ext: "aac" }, "audio/flac": { mime: "audio/flac", ext: "flac" },
  "audio/mp4": { mime: "audio/mp4", ext: "m4a" }, "audio/x-m4a": { mime: "audio/mp4", ext: "m4a" }, "audio/webm": { mime: "audio/webm", ext: "webm" },
};
const BY_EXT: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", aac: "audio/aac", flac: "audio/flac", m4a: "audio/mp4", webm: "audio/webm" };
/** The audio type and file extension, from what the server said or, failing that, the address (an unlabelled file is taken as mp3). */
export function audioType(contentType: string | null, url: string): { mime: string; ext: string } {
  const ct = String(contentType ?? "").split(";")[0].trim().toLowerCase();
  if (KNOWN[ct]) return KNOWN[ct];
  const ext = (url.split("?")[0].match(/\.([a-z0-9]{3,4})$/i)?.[1] ?? "").toLowerCase();
  return BY_EXT[ext] ? { mime: BY_EXT[ext], ext: ext === "m4a" ? "m4a" : ext } : KNOWN["audio/mpeg"];
}

/** "1432" for the time a call began, in Pacific time, so two calls on one day get two names. */
export const callClock = (iso: string): string => new Intl.DateTimeFormat("en-GB", { timeZone: "America/Vancouver", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)).replace(":", "");
const pacificDay = (iso: string): string => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver" }).format(new Date(iso));

/** File names by the house convention: 26-10-23_Issler_R_Call 1432.mp3 and 26-10-23_Issler_R_Call 1432 Transcript.pdf. */
export function callFileNames(occurredAt: string, people: Person[], ext: string, voicemail: boolean): { audio: string; transcript: string } {
  const doc = `${voicemail ? "Voicemail" : "Call"} ${callClock(occurredAt)}`;
  const base = conventionName(pacificDay(occurredAt), people, doc);
  return { audio: `${base}.${ext}`, transcript: `${conventionName(pacificDay(occurredAt), people, `${doc} Transcript`)}.pdf` };
}

export const TRANSCRIBE_PROMPT = [
  "You are transcribing a recorded phone call between a financial advisor (Rolf Issler, ProsperWise Advisors) and a client or prospect.",
  "Transcribe what is said, word for word, in the order it is said. Label each turn with the speaker: use \"Rolf\" for the advisor and \"Client\" for the other person (\"Client 1\" and \"Client 2\" if two clients speak). If you cannot tell who is speaking, use \"Speaker\".",
  "Do not invent anything. Mark a stretch you cannot make out as [inaudible]. Do not add words that were not said. Leave out filler only if it is pure noise.",
  "Then give a summary of at most five sentences, and the next steps that were agreed or promised (who does what, and by when if said). If no next steps were stated, leave the list empty.",
].join("\n");

export interface Transcription { transcript: string; summary: string; nextSteps: string[] }
/** The model's answer, checked: a transcript is required; the summary and steps are trimmed. */
export function checkTranscription(args: unknown): Transcription | null {
  const a = (args ?? {}) as any;
  const transcript = String(a.transcript ?? "").trim();
  if (transcript.length < 5) return null;
  return { transcript: transcript.slice(0, 200_000), summary: String(a.summary ?? "").trim().slice(0, 1500), nextSteps: (Array.isArray(a.next_steps) ? a.next_steps : []).map((s: unknown) => String(s ?? "").trim().slice(0, 300)).filter(Boolean).slice(0, 12) };
}

export function transcriptBlocks(i: { person: string; startedAt: string; durationSeconds: number | null; direction: string | null; t: Transcription }): Block[] {
  const when = new Date(i.startedAt).toLocaleString("en-CA", { timeZone: "America/Vancouver", dateStyle: "long", timeStyle: "short" });
  const mins = i.durationSeconds ? ` ${Math.max(1, Math.round(i.durationSeconds / 60))} minute${Math.round(i.durationSeconds / 60) === 1 ? "" : "s"}.` : "";
  const blocks: Block[] = [
    { kind: "p", small: true, text: `${i.direction === "outbound" ? "Call to" : "Call with"} ${i.person}, ${when} Pacific.${mins} Transcribed by ProsperWise's own AI in Canada from the recording, which is saved beside this file. Check anything important against the recording.` },
  ];
  if (i.t.summary) blocks.push({ kind: "h", text: "Summary" }, { kind: "p", text: i.t.summary });
  if (i.t.nextSteps.length) blocks.push({ kind: "h", text: "Next steps" }, ...i.t.nextSteps.map((s) => ({ kind: "p" as const, text: `• ${s}` })));
  blocks.push({ kind: "h", text: "Transcript" });
  for (const line of i.t.transcript.split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
    const m = line.match(/^([A-Za-z][A-Za-z ]{0,18}\d?):\s+(.*)$/);
    blocks.push(m ? { kind: "kv", label: `${m[1]}:`, value: m[2] } : { kind: "p", text: line });
  }
  return blocks;
}
