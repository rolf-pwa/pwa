import { describe, it, expect } from "vitest";
import { callFromEvent, e164, smsFromEvent, verifyCallizySignature, voicemailFromEvent } from "../../supabase/functions/_shared/callizy";

const hmac = async (body: string, secret: string) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, "0")).join("");
};

describe("Callizy webhook signature", () => {
  it("accepts the HMAC-SHA256 of the raw body and rejects anything else", async () => {
    const body = JSON.stringify({ event: "sms.received", data: { x: 1 } });
    const good = await hmac(body, "s3cret");
    expect(await verifyCallizySignature(body, good, "s3cret")).toBe(true);
    expect(await verifyCallizySignature(body, good.toUpperCase(), "s3cret")).toBe(true);
    expect(await verifyCallizySignature(body, good, "other")).toBe(false);
    expect(await verifyCallizySignature(body + " ", good, "s3cret")).toBe(false);
    expect(await verifyCallizySignature(body, null, "s3cret")).toBe(false);
    expect(await verifyCallizySignature(body, good, undefined)).toBe(false);
  });
});

describe("reading Callizy events", () => {
  it("normalizes phone numbers to E.164", () => {
    expect(e164("(438) 555-1234")).toBe("+14385551234");
    expect(e164("14385551234")).toBe("+14385551234");
    expect(e164("+14385551234")).toBe("+14385551234");
  });
  it("reads an inbound text whatever the field names", () => {
    const m = smsFromEvent("sms.received", { sms_id: "sms_1", from_number: "438-555-1234", to_number: "+14385440797", message: "hi" }, "2026-10-21T10:00:00Z");
    expect(m).toMatchObject({ id: "sms_1", direction: "inbound", from: "+14385551234", to: "+14385440797", body: "hi", at: "2026-10-21T10:00:00Z" });
    expect(smsFromEvent("sms.sent", { id: "sms_2", from: "+14385440797", to: "+14385551234", body: "yo" }).direction).toBe("outbound");
  });
  it("reads a call and marks a missed one", () => {
    const c = callFromEvent("call.missed", { call_id: "cal_1", direction: "inbound", from_number: "+14385551234", to_number: "+14385440797", duration: 0 });
    expect(c).toMatchObject({ id: "cal_1", status: "missed", direction: "inbound" });
    expect(callFromEvent("call.completed", { call_id: "cal_2", duration: 125, transcript: "hi", conversation_summary: "s" }).duration).toBe(125);
  });
  it("reads a voicemail", () => {
    expect(voicemailFromEvent({ voicemail_id: "vml_1", from_number: "+14385551234", transcription: "call me", audio_url: "https://x/a.mp3", duration: 12 })).toMatchObject({ id: "vml_1", transcript: "call me", url: "https://x/a.mp3", duration: 12 });
  });
});

describe("more than one signing secret", () => {
  it("accepts a signature made with any secret in a comma-separated list", async () => {
    const body = "{\"event\":\"sms.sent\"}";
    const sig = await hmac(body, "second");
    expect(await verifyCallizySignature(body, sig, "first, second")).toBe(true);
    expect(await verifyCallizySignature(body, sig, "first,third")).toBe(false);
  });
});

describe("choosing the line a text goes out from", () => {
  it("takes the first company line the API can use, from Callizy's /numbers/ answer", async () => {
    const { pickFromLine } = await import("../../supabase/functions/_shared/callizy");
    const answer = { results: [
      { phone_e164: "+14385550001", kind: "ai_agent", api_usable: false, label: "", is_toll_free: false },
      { phone_e164: "+14385550002", kind: "company", api_usable: false, label: "", is_toll_free: false },
      { phone_e164: "+14385550003", kind: "company", api_usable: true, label: "Main", is_toll_free: false },
    ] };
    expect(pickFromLine(answer)).toBe("+14385550003");
    expect(pickFromLine({ results: [{ phone_e164: "+14385550002", kind: "company", api_usable: false }] })).toBeNull();
    expect(pickFromLine({ results: [] })).toBeNull();
  });
});

describe("Callizy error messages", () => {
  it("shows their reason, or a plain sentence instead of an HTML error page", async () => {
    const { callizyErrorText } = await import("../../supabase/functions/_shared/callizy");
    expect(callizyErrorText(400, "{}", { error: "Opted out", code: "OPTED_OUT" })).toBe("Callizy 400: Opted out (OPTED_OUT)");
    expect(callizyErrorText(500, "<!doctype html><title>Server Error (500)</title>", {})).toMatch(/server error \(500\)/i);
    expect(callizyErrorText(500, "<!doctype html>", {})).not.toContain("<");
    expect(callizyErrorText(429, "slow down", {})).toBe("Callizy 429: slow down");
  });
});

describe("Callizy softphone calls and recording links", () => {
  it("does not turn a softphone identity into a phone number", async () => {
    const { e164: e, callFromEvent: call } = await import("../../supabase/functions/_shared/callizy");
    expect(e("client:agent_336_258")).toBe("");
    const c = call("call.completed", { call_id: "cal_1", direction: "outbound", from_number: "client:agent_336_258", to_number: "+17787215208", duration: 12 });
    expect(c.from).toBe(""); // no CALLIZY_FROM_NUMBER in tests
    expect(c.to).toBe("+17787215208");
  });
  it("finds the first web address in a recording answer", async () => {
    const { firstUrl } = await import("../../supabase/functions/_shared/callizy");
    expect(firstUrl({ call_id: "cal_1", recordings: [{ id: 1, kind: "call", url: "https://api.callizy.ca/r/abc" }] })).toBe("https://api.callizy.ca/r/abc");
    expect(firstUrl({ recordings: [] })).toBeNull();
    expect(firstUrl(null)).toBeNull();
  });
});

describe("photos in Callizy texts", () => {
  it("keeps the attachment links and drops anything that is not a web address", async () => {
    const { smsFromEvent: sms } = await import("../../supabase/functions/_shared/callizy");
    const m = sms("sms.received", { sms_id: "sms_9", from_number: "+14385551234", to_number: "+17787215084", message: "", has_media: true, media_urls: ["https://api.callizy.ca/m/1.jpg", "not a link", 5] });
    expect(m.media).toEqual(["https://api.callizy.ca/m/1.jpg"]);
    expect(sms("sms.received", { sms_id: "sms_10", message: "hi" }).media).toEqual([]);
  });
});

describe("click-to-call follows the provider", () => {
  it("opens Callizy's softphone link when Callizy is the provider, and keeps Quo's links otherwise", async () => {
    const { readFileSync } = await import("node:fs");
    const dial = readFileSync("src/shared/lib/quo-dial.ts", "utf8");
    expect(dial).toContain("https://app.callizy.ca/call?number=");
    expect(dial).toContain("openphone://dial");
    expect(dial).toMatch(/provider === "callizy"/);
    expect(readFileSync("src/modules/crm/pages/Inbox.tsx", "utf8")).toContain("setDialProvider(next)");
  });
});
