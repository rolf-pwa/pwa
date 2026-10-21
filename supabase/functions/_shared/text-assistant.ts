// text-assistant.ts: Georgia answers a client's text for Rolf when he cannot (in a meeting, away, after hours, weekend). Answers once, as Georgia,
// identifying herself; gives no account details; alerts Rolf in the app for urgent matters; never talks over him. Rules are in text-reply-rules.ts.

// deno-lint-ignore-file no-explicit-any
import { ADMIN_INBOX_EMAIL, getServiceGoogleAccessToken, resolveUserIdByEmail } from "./google-token.ts";
import { GEMINI_DRAFTING_MODEL, generateVertexContent, parseServiceAccountKey, withThinking } from "./vertex-ai.ts";
import { checkOutboundPii } from "./pii-shield.ts";
import { callizySend, e164 } from "./callizy.ts";
import { HOLD_ROLF_REPLIED_HOURS, ONE_REPLY_HOURS, TEXT_TOOL, gate, textPrompt, whyUnavailable } from "./text-reply-rules.ts";

const zone = "America/Vancouver";
const pacificDate = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(d);
const nowLabel = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
const last10 = (v: string) => String(v ?? "").replace(/\D/g, "").slice(-10);

export type Outcome = "replied" | "held" | "none";

/** The end of the timed calendar event Rolf is in right now, if he is in one he has not declined. */
async function meetingEndsAt(db: any): Promise<string | null> {
  try {
    const token = await getServiceGoogleAccessToken(db);
    const now = new Date();
    const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?` + new URLSearchParams({ timeMin: now.toISOString(), timeMax: new Date(now.getTime() + 60_000).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "10" }), { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const ends = ((await r.json()).items ?? [])
      .filter((e: any) => e.status !== "cancelled" && e.transparency !== "transparent" && e.start?.dateTime && e.end?.dateTime)
      .filter((e: any) => !(e.attendees ?? []).some((a: any) => a.self && a.responseStatus === "declined"))
      .map((e: any) => e.end.dateTime as string)
      .sort();
    return ends.length ? ends[ends.length - 1] : null;
  } catch { return null; }
}

function quoFrom(): string {
  const raw = (Deno.env.get("QUO_DEFAULT_PHONE_NUMBER_ID") || "").trim();
  if (raw.startsWith("PN")) return raw;
  return e164(raw) || raw;
}
async function sendText(provider: "quo" | "callizy", to: string, text: string): Promise<{ id: string | null; from: string }> {
  if (provider === "callizy") { const s = await callizySend(to, text); return { id: s.id || null, from: s.from }; }
  const from = quoFrom();
  const r = await fetch("https://api.openphone.com/v1/messages", { method: "POST", headers: { Authorization: Deno.env.get("QUO_API_KEY") ?? "", "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [to], content: text }) });
  const t = await r.text();
  if (!r.ok) throw new Error(`Quo ${r.status}: ${t.slice(0, 160)}`);
  let j: any = {}; try { j = t ? JSON.parse(t) : {}; } catch { /* leave empty */ }
  const msg = j?.data || j;
  return { id: msg?.id ?? null, from: msg?.from || from };
}

export async function georgiaTextReply(db: any, m: { provider: "quo" | "callizy"; from: string; to: string; body: string; contactId: string | null }): Promise<Outcome> {
  if (!m.contactId) return "none";
  const { data: cfg } = await db.from("text_assistant_config").select("enabled").eq("id", true).maybeSingle();
  if (cfg && cfg.enabled === false) return "held";

  const { data: contact } = await db.from("contacts").select("first_name, last_name, is_minor").eq("id", m.contactId).maybeSingle();
  const name = `${contact?.first_name ?? ""} ${contact?.last_name ?? ""}`.trim() || m.from;
  const now = new Date();
  const [{ data: away }, meetingEnd, rolfId] = await Promise.all([
    db.from("staff_availability").select("away_from, away_until, note").eq("id", true).maybeSingle(),
    meetingEndsAt(db),
    resolveUserIdByEmail(db, ADMIN_INBOX_EMAIL),
  ]);
  const why = whyUnavailable(away ?? null, now, meetingEnd);
  const sinceRolf = new Date(now.getTime() - HOLD_ROLF_REPLIED_HOURS * 3_600_000).toISOString();
  const sinceMine = new Date(now.getTime() - ONE_REPLY_HOURS * 3_600_000).toISOString();
  const peer = last10(m.from);
  const [{ data: recentOut }, { data: mine }] = await Promise.all([
    db.from("quo_messages").select("id").eq("direction", "outbound").like("to_number", `%${peer}`).gte("occurred_at", sinceRolf).limit(10),
    db.from("ea_actions").select("created_at, payload").eq("staff_user_id", rolfId).eq("kind", "text_replied").gte("created_at", sinceMine).limit(10),
  ]);
  const myRecent = ((mine ?? []) as any[]).filter((a) => last10(String(a.payload?.to ?? "")) === peer);
  const myInWindow = myRecent.filter((a) => a.created_at >= sinceRolf).length;
  const g = gate({ matched: true, minor: !!contact?.is_minor, body: m.body, from: m.from, unavailable: !!why, rolfRepliedRecently: ((recentOut ?? []).length) > myInWindow, georgiaRepliedRecently: myRecent.length > 0 });
  if (!g.go) return "held";

  const date = pacificDate(now);
  const record = (kind: string, status: "done" | "proposed", summary: string, payload: Record<string, unknown>) =>
    db.from("ea_actions").insert({ staff_user_id: rolfId, conversation_date: date, kind, status, summary: summary.slice(0, 300), payload });

  const { data: recent } = await db.from("quo_messages").select("direction, body, occurred_at").eq("contact_id", m.contactId).order("occurred_at", { ascending: false }).limit(6);
  const lines = ((recent ?? []) as any[]).reverse().slice(0, 5).map((x) => `${x.direction === "inbound" ? "Client" : "Us"}: ${String(x.body ?? "").slice(0, 160)}`);

  const sa = await parseServiceAccountKey(Deno.env.get("GCP_SERVICE_ACCOUNT_KEY"));
  const result = await generateVertexContent(sa, GEMINI_DRAFTING_MODEL, [{ role: "user", parts: [{ text: textPrompt({ firstName: contact?.first_name ?? "", line: why!.line, nowLabel: nowLabel(now), thread: lines, text: m.body, georgiaRepliedRecently: myRecent.length > 0 }) }] }], withThinking(GEMINI_DRAFTING_MODEL, { temperature: 0.3, maxOutputTokens: 600 }, "low"), { tools: [{ functionDeclarations: [TEXT_TOOL] }], toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["reply_to_text"] } } });
  const d: any = (result.candidates?.[0]?.content?.parts || []).find((p: any) => p.functionCall)?.functionCall?.args;
  if (!d) { await record("text_flagged", "proposed", `${name} texted and I could not work out a reply. Please look at it.`, { to: m.from, contact_id: m.contactId }); return "held"; }

  const urgency = ["urgent", "routine", "none"].includes(String(d.urgency)) ? String(d.urgency) : "routine";
  const summary = String(d.summary || "").slice(0, 240);
  const reply = String(d.reply || "").replace(/[–—]/g, ",").replace(/\s+/g, " ").trim().slice(0, 480);

  if (urgency === "urgent") {
    await db.from("staff_notifications").insert({ title: `Urgent text from ${name}`, body: summary || "Please read their text.", link: `/contacts/${m.contactId}`, contact_id: m.contactId, source_type: "urgent_text" });
  }
  if (!reply) {
    if (urgency !== "none") await record("text_flagged", "proposed", `${name} texted: ${summary}`, { to: m.from, contact_id: m.contactId, urgency });
    return "held";
  }
  const pii = checkOutboundPii(reply);
  if (pii.blocked) { await record("text_flagged", "proposed", `${name} texted: ${summary}. My reply was blocked by the privacy shield, so nothing was sent.`, { to: m.from, contact_id: m.contactId, urgency }); return "held"; }

  try {
    const sent = await sendText(m.provider, m.from, reply);
    await db.from("quo_messages").insert({ quo_message_id: sent.id, provider: m.provider, contact_id: m.contactId, direction: "outbound", from_number: sent.from, to_number: m.from, body: reply, status: "sent", portal_visible: true, occurred_at: new Date().toISOString(), read_at: new Date().toISOString() });
    await record("text_replied", "done", `${name} texted: ${summary} I answered (${why!.reason.replace("_", " ")}).`, { to: m.from, contact_id: m.contactId, urgency, reply });
    if (urgency !== "none") await record("text_flagged", "proposed", `${name}: ${summary} (${urgency}). I told them ${urgency === "urgent" ? "you have been alerted" : "you will reply"}.`, { to: m.from, contact_id: m.contactId, urgency });
    return "replied";
  } catch (e) {
    console.error("[text-assistant] send failed", e);
    await record("text_flagged", "proposed", `${name} texted: ${summary}. I could not send my reply (${String(e instanceof Error ? e.message : e).slice(0, 80)}).`, { to: m.from, contact_id: m.contactId, urgency });
    return "held";
  }
}
