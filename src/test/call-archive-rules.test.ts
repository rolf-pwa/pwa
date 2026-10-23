import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, audioType, callClock, callFileNames, checkTranscription, transcriptBlocks, wantsArchive, type CallRow } from "../../supabase/functions/_shared/call-archive-rules";
import { buildBrandedPdf } from "../../supabase/functions/_shared/simple-pdf";

const NOW = Date.parse("2026-10-23T12:00:00Z");
const call = (o: Partial<CallRow> = {}): CallRow => ({ id: "c", is_voicemail: false, status: "completed", duration_seconds: 120, occurred_at: "2026-10-22T21:32:00Z", archived_at: null, archive_attempts: 0, ...o });

describe("which calls are copied", () => {
  it("takes real conversations and voicemails, not missed, tiny, old, done or given-up calls", () => {
    expect(wantsArchive(call(), NOW)).toBe(true);
    expect(wantsArchive(call({ is_voicemail: true, duration_seconds: 0, status: "missed" }), NOW)).toBe(true);
    expect(wantsArchive(call({ status: "missed" }), NOW)).toBe(false);
    expect(wantsArchive(call({ status: "no-answer" }), NOW)).toBe(false);
    expect(wantsArchive(call({ duration_seconds: 2 }), NOW)).toBe(false);
    expect(wantsArchive(call({ occurred_at: "2026-08-01T00:00:00Z" }), NOW)).toBe(false);
    expect(wantsArchive(call({ archived_at: "2026-10-22T23:00:00Z" }), NOW)).toBe(false);
    expect(wantsArchive(call({ archive_attempts: MAX_ATTEMPTS }), NOW)).toBe(false);
  });
});

describe("audio type and file names", () => {
  it("takes the type from the server, then the address, then assumes mp3", () => {
    expect(audioType("audio/mpeg; charset=x", "https://x/y")).toEqual({ mime: "audio/mpeg", ext: "mp3" });
    expect(audioType("audio/x-wav", "https://x/y")).toEqual({ mime: "audio/wav", ext: "wav" });
    expect(audioType("application/octet-stream", "https://x/rec.m4a?sig=1")).toEqual({ mime: "audio/mp4", ext: "m4a" });
    expect(audioType(null, "https://x/y")).toEqual({ mime: "audio/mpeg", ext: "mp3" });
  });
  it("names the recording and transcript by the convention, with the Pacific clock time", () => {
    expect(callClock("2026-10-22T21:32:00Z")).toBe("1432");
    expect(callFileNames("2026-10-22T21:32:00Z", [{ first_name: "Rolf", last_name: "Issler" }], "mp3", false)).toEqual({ audio: "26-10-22_Issler_R_Call 1432.mp3", transcript: "26-10-22_Issler_R_Call 1432 Transcript.pdf" });
    expect(callFileNames("2026-10-22T21:32:00Z", [{ first_name: "Lisa", last_name: "Issler" }], "wav", true).audio).toBe("26-10-22_Issler_L_Voicemail 1432.wav");
  });
});

describe("the AI's transcript", () => {
  it("is checked and trimmed, and refused when empty", () => {
    expect(checkTranscription({ transcript: "Rolf: Hello.\nClient: Hi.", summary: " Short. ", next_steps: [" Send the quote ", "", "Book a call"] })).toEqual({ transcript: "Rolf: Hello.\nClient: Hi.", summary: "Short.", nextSteps: ["Send the quote", "Book a call"] });
    expect(checkTranscription({ transcript: "  " })).toBeNull();
    expect(checkTranscription(undefined)).toBeNull();
  });
  it("makes a branded transcript with speaker rows, summary and next steps", () => {
    const t = checkTranscription({ transcript: "Rolf: Thanks for calling.\nClient: I want to review my coverage.\n[inaudible]", summary: "A coverage review request.", next_steps: ["Rolf sends the quote by Friday"] })!;
    const blocks = transcriptBlocks({ person: "Thomas Wolfe", startedAt: "2026-10-22T21:32:00Z", durationSeconds: 540, direction: "inbound", t });
    const text = JSON.stringify(blocks);
    for (const s of ["Call with Thomas Wolfe", "9 minutes", "Summary", "Next steps", "Rolf sends the quote by Friday", "\"label\":\"Rolf:\"", "\"label\":\"Client:\"", "[inaudible]"]) expect(text).toContain(s);
    expect(new TextDecoder("latin1").decode(buildBrandedPdf({ eyebrow: "ProsperWise Advisors", title: "Call Transcript", footer: "f", blocks })).startsWith("%PDF-1.4")).toBe(true);
  });
});

describe("wiring", () => {
  it("has a migration with the archive columns and the nightly schedule, and a watched job", () => {
    const m = readFileSync("supabase/migrations/20261223120000_call_archive.sql", "utf8");
    for (const s of ["archived_at", "recording_drive_id", "transcript_source", "call-archive", "'{\"job\":\"call_archive\"}'"]) expect(m).toContain(s);
    expect(readFileSync("supabase/functions/_shared/job-health.ts", "utf8")).toContain('key: "call_archive"');
    expect(readFileSync("supabase/functions/daily-briefing-generate/index.ts", "utf8")).toContain('cronBody.job === "call_archive"');
  });
});
