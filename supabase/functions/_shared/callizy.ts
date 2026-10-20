// callizy.ts: Callizy (callizy.ca) as a second phone provider beside Quo. Pure helpers plus one send call. Docs: https://callizy.ca/docs
// Webhooks are signed with HMAC-SHA256 of the raw body in X-Callizy-Signature (hex). The SMS and voicemail event bodies are not described
// in their schema, so the readers below accept the likely field names and the raw payload is always logged to quo_webhook_events.

// deno-lint-ignore-file no-explicit-any
export type Provider = "quo" | "callizy";

const API = "https://api.callizy.ca/api/v1";
// Read through globalThis so the pure helpers can also be unit-tested outside Deno.
const env = (name: string): string | undefined => (globalThis as any).Deno?.env.get(name);

export function callizyCreds(): { key: string; secret: string } | null {
  const key = env("CALLIZY_API_KEY"), secret = env("CALLIZY_API_SECRET");
  return key && secret ? { key, secret } : null;
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** True when the signature header is the HMAC-SHA256 (hex) of the raw body under the signing secret. */
export async function verifyCallizySignature(rawBody: string, header: string | null, secret: string | undefined): Promise<boolean> {
  if (!header || !secret) return false;
  const enc = new TextEncoder();
  const given = header.trim().toLowerCase().replace(/^sha256=/, "");
  // More than one webhook can be registered, each with its own signing secret: the setting may hold several, separated by commas.
  for (const one of secret.split(",").map((x) => x.trim()).filter(Boolean)) {
    const key = await crypto.subtle.importKey("raw", enc.encode(one), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const expected = hex(await crypto.subtle.sign("HMAC", key, enc.encode(rawBody)));
    if (given.length !== expected.length) continue;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
    if (diff === 0) return true;
  }
  return false;
}

/** Why a signature failed, without revealing anything secret: which signature-like headers came, how long, and whether a secret is set. */
export function signatureDiagnosis(headers: Headers, secret: string | undefined): string {
  const sig = [...headers.entries()].filter(([k]) => /sig|hmac|callizy|webhook/i.test(k)).map(([k, v]) => `${k}(len ${v.length}${/^sha256=/i.test(v) ? ", sha256= prefix" : ""})`);
  const parts = (secret ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return `bad signature; headers: ${sig.join(", ") || "none"}; secrets set: ${parts.length}${parts.length ? ` (lengths ${parts.map((x) => x.length).join("/")})` : ""}`;
}

const first = (...vals: unknown[]): string => { for (const v of vals) if (v !== undefined && v !== null && String(v) !== "") return String(v); return ""; };

export function e164(phone: string): string {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return phone?.startsWith("+") ? phone : digits ? `+${digits}` : "";
}

export interface CallizySms { id: string; direction: "inbound" | "outbound"; from: string; to: string; body: string; at: string }
export function smsFromEvent(event: string, data: any, timestamp?: string): CallizySms {
  const inbound = event === "sms.received";
  return {
    id: first(data?.sms_id, data?.message_id, data?.messageId, data?.id),
    direction: inbound ? "inbound" : "outbound",
    from: e164(first(data?.from_number, data?.from, data?.sender, data?.fromE164)),
    to: e164(first(data?.to_number, data?.to, data?.recipient, data?.toE164)),
    body: first(data?.message, data?.body, data?.text, data?.content),
    at: first(data?.created_at, data?.sent_at, data?.received_at, timestamp) || new Date().toISOString(),
  };
}

export interface CallizyCall { id: string; direction: "inbound" | "outbound"; from: string; to: string; status: string; duration: number; at: string; transcript: string; summary: string }
export function callFromEvent(event: string, data: any, timestamp?: string): CallizyCall {
  return {
    id: first(data?.call_id, data?.id),
    direction: first(data?.direction) === "outbound" ? "outbound" : "inbound",
    from: e164(first(data?.from_number, data?.from)),
    to: e164(first(data?.to_number, data?.to)),
    status: event === "call.missed" ? "missed" : first(data?.status) || "completed",
    duration: Number(data?.duration ?? 0) || 0,
    at: first(data?.ended_at, data?.started_at, timestamp) || new Date().toISOString(),
    transcript: first(data?.transcript),
    summary: first(data?.conversation_summary),
  };
}

export interface CallizyVoicemail { id: string; from: string; to: string; transcript: string; url: string; duration: number; at: string }
export function voicemailFromEvent(data: any, timestamp?: string): CallizyVoicemail {
  return {
    id: first(data?.call_id, data?.voicemail_id, data?.id),
    from: e164(first(data?.from_number, data?.from, data?.caller)),
    to: e164(first(data?.to_number, data?.to)),
    transcript: first(data?.transcription, data?.transcript),
    url: first(data?.audio_url, data?.recording_url, data?.url),
    duration: Number(data?.duration ?? 0) || 0,
    at: first(data?.created_at, data?.received_at, timestamp) || new Date().toISOString(),
  };
}

/** The company line texts go out from: CALLIZY_FROM_NUMBER if set, else the first line the API says it may use. */
export async function callizyFromNumber(): Promise<string> {
  const fixed = env("CALLIZY_FROM_NUMBER");
  if (fixed) return e164(fixed);
  const c = callizyCreds();
  if (!c) throw new Error("Callizy is not set up (CALLIZY_API_KEY / CALLIZY_API_SECRET)");
  const r = await fetch(`${API}/numbers/`, { headers: { "X-API-Key": c.key, "X-API-Secret": c.secret } });
  if (!r.ok) throw new Error(`Callizy numbers ${r.status}`);
  const picked = pickFromLine(await r.json());
  if (!picked) throw new Error("Callizy has no line this key may send from");
  return picked;
}

/** The company line a text can go out from, from the /numbers/ answer ({ results: [{ phone_e164, kind, api_usable }] }). Null when there is none. */
export function pickFromLine(answer: any): string | null {
  const list: any[] = Array.isArray(answer) ? answer : answer?.results ?? [];
  const line = list.find((n) => n?.kind === "company" && n?.api_usable === true);
  const num = first(line?.phone_e164, line?.e164, line?.number);
  return num ? e164(num) : null;
}

/** Sends one text through Callizy. Returns the id Callizy gives it and the number it was sent from. */
export async function callizySend(to: string, message: string): Promise<{ id: string; from: string }> {
  const c = callizyCreds();
  if (!c) throw new Error("Callizy is not set up (CALLIZY_API_KEY / CALLIZY_API_SECRET)");
  const from = await callizyFromNumber();
  const r = await fetch(`${API}/sms/`, { method: "POST", headers: { "X-API-Key": c.key, "X-API-Secret": c.secret, "Content-Type": "application/json" }, body: JSON.stringify({ toE164: e164(to), message, fromE164: from }) });
  const text = await r.text();
  let j: any = {};
  try { j = text ? JSON.parse(text) : {}; } catch { /* leave empty */ }
  if (!r.ok) throw new Error(`Callizy ${r.status}: ${j.error ?? text.slice(0, 200)}${j.code ? ` (${j.code})` : ""}`);
  return { id: first(j.id), from };
}

/** Which provider the CRM sends through. Quo unless Rolf has switched it. */
export async function currentProvider(db: any): Promise<Provider> {
  const { data } = await db.from("phone_provider_config").select("provider").eq("id", true).maybeSingle();
  return data?.provider === "callizy" ? "callizy" : "quo";
}
