// calendar-service.ts: Georgia deals with calendar invitations Rolf has not answered. Webinars and training that fit go in right away (accepted); everything
// else is left for him and flagged in the morning meeting. Rules are in calendar-rules.ts. She never declines on her own.

// deno-lint-ignore-file no-explicit-any
import "./bc-time.ts";
import { ADMIN_INBOX_EMAIL, getServiceGoogleAccessToken, resolveUserIdByEmail } from "./google-token.ts";
import { GEMINI_EXTRACT_MODEL, generateVertexContent, parseServiceAccountKey, withThinking } from "./vertex-ai.ts";
import { isOn } from "./georgia-switches.ts";
import { INVITE_TOOL, clashes, invitePrompt, mayAutoAccept, type InviteCategory, type Slot } from "./calendar-rules.ts";

const zone = "America/Vancouver";
const pacificDate = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(d);
const when = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/** Sets Rolf's own response on an event, keeping every other guest as they were. */
export async function respondToEvent(token: string, eventId: string, response: "accepted" | "declined" | "tentative" | "needsAction", notify: boolean): Promise<{ ok: boolean; title?: string; error?: string }> {
  const base = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`;
  const g = await fetch(base, { headers: { Authorization: `Bearer ${token}` } });
  if (!g.ok) return { ok: false, error: `I could not open that event (${g.status}).` };
  const ev = await g.json();
  if (!(ev.attendees ?? []).some((a: any) => a.self)) return { ok: false, error: "Rolf is not a guest on that event." };
  const attendees = ev.attendees.map((a: any) => (a.self ? { ...a, responseStatus: response } : a));
  const p = await fetch(`${base}?sendUpdates=${notify ? "all" : "none"}`, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ attendees }) });
  return p.ok ? { ok: true, title: ev.summary ?? "(no title)" } : { ok: false, error: `Google said no (${p.status}).` };
}

export async function runCalendarInvites(db: any): Promise<string[]> {
  const out: string[] = [];
  if (!(await isOn(db, "calendar_invites"))) return ["switched off"];
  const rolfId = await resolveUserIdByEmail(db, ADMIN_INBOX_EMAIL);
  const token = await getServiceGoogleAccessToken(db);
  const now = new Date();
  const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?` + new URLSearchParams({ timeMin: now.toISOString(), timeMax: new Date(now.getTime() + 75 * 86_400_000).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "250" }), { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Calendar error: ${r.status}`);
  const events: any[] = ((await r.json()).items ?? []).filter((e: any) => e.status !== "cancelled");
  const pending = events.filter((e) => (e.attendees ?? []).some((a: any) => a.self && a.responseStatus === "needsAction") && !e.organizer?.self);
  if (!pending.length) return out;

  const { data: seenRows } = await db.from("calendar_invites_seen").select("event_id").in("event_id", pending.map((e) => e.id));
  const seen = new Set((seenRows ?? []).map((s: any) => s.event_id));
  const fresh = pending.filter((e) => !seen.has(e.id)).slice(0, 8);
  if (!fresh.length) return out;

  const slotOf = (e: any): Slot | null => (e.start?.dateTime && e.end?.dateTime ? { id: e.id, start: e.start.dateTime, end: e.end.dateTime, title: e.summary ?? "(no title)" } : null);
  const busy: Slot[] = events
    .filter((e) => e.transparency !== "transparent" && !(e.attendees ?? []).some((a: any) => a.self && (a.responseStatus === "declined" || a.responseStatus === "needsAction")))
    .map(slotOf).filter((s): s is Slot => !!s);

  const sa = await parseServiceAccountKey(Deno.env.get("GCP_SERVICE_ACCOUNT_KEY"));
  const date = pacificDate(now);
  const record = (kind: string, status: "done" | "proposed", summary: string, payload: Record<string, unknown>) =>
    db.from("ea_actions").insert({ staff_user_id: rolfId, conversation_date: date, kind, status, summary: summary.slice(0, 300), payload });

  for (const e of fresh) {
    try {
      const slot = slotOf(e);
      const organizer = String(e.organizer?.email ?? "").toLowerCase();
      const title = e.summary ?? "(no title)";
      const [{ count: asClient }, { count: asPro }] = await Promise.all([
        organizer ? db.from("contacts").select("id", { count: "exact", head: true }).ilike("email", organizer) : { count: 0 },
        organizer ? db.from("professionals").select("id", { count: "exact", head: true }).ilike("email", organizer) : { count: 0 },
      ]);
      const known = (asClient ?? 0) > 0 || (asPro ?? 0) > 0;
      const minutes = slot ? Math.round((Date.parse(slot.end) - Date.parse(slot.start)) / 60_000) : 0;
      const result = await generateVertexContent(sa, GEMINI_EXTRACT_MODEL, [{ role: "user", parts: [{ text: invitePrompt({ title, organizer: `${e.organizer?.displayName ?? ""} <${organizer}>`, attendees: (e.attendees ?? []).length, minutes, description: String(e.description ?? "").replace(/<[^>]+>/g, " ") }) }] }], withThinking(GEMINI_EXTRACT_MODEL, { temperature: 0.1, maxOutputTokens: 512 }, "low"), { tools: [{ functionDeclarations: [INVITE_TOOL] }], toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["classify_invite"] } } });
      const d: any = (result.candidates?.[0]?.content?.parts || []).find((p: any) => p.functionCall)?.functionCall?.args ?? {};
      const category = (["webinar_or_training", "meeting_with_person", "sales_or_other"].includes(d.category) ? d.category : "sales_or_other") as InviteCategory;
      const clash = slot ? clashes(slot, busy) : [];
      const decision = mayAutoAccept({ category, confidence: String(d.confidence ?? ""), organizerKnown: known, startIso: slot?.start ?? "", endIso: slot?.end ?? "", nowMs: now.getTime(), clashCount: clash.length, allDay: !slot });

      if (decision.accept) {
        const res = await respondToEvent(token, e.id, "accepted", false);
        if (res.ok) {
          await record("calendar_accepted", "done", `Accepted "${title}" (${when(slot!.start)}): ${String(d.why ?? "a webinar or training").slice(0, 120)}`, { event_id: e.id, title, closed: false });
          await db.from("calendar_invites_seen").upsert({ event_id: e.id, outcome: "accepted" }, { onConflict: "event_id" });
          busy.push(slot!); // so a second invitation at the same time is not accepted too
          out.push(`accepted: ${title.slice(0, 50)}`);
          continue;
        }
        console.error("[calendar-invites] accept failed", res.error);
      }
      const why = decision.accept ? "I could not accept it." : decision.why;
      await record("calendar_flagged", "proposed", `Invitation "${title}" from ${e.organizer?.displayName || organizer || "someone"}${slot ? ` (${when(slot.start)})` : ""}. ${why}${clash.length ? ` Clashes with ${clash.slice(0, 2).map((c) => `"${c.title}"`).join(", ")}.` : ""}`, { event_id: e.id, title, clash: clash.map((c) => c.title) });
      await db.from("calendar_invites_seen").upsert({ event_id: e.id, outcome: "flagged" }, { onConflict: "event_id" });
      out.push(`flagged: ${title.slice(0, 50)}`);
    } catch (err) {
      console.error("[calendar-invites]", e.summary, err);
    }
  }
  return out;
}
