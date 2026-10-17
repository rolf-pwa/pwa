// ea-handlers.ts: the database and Google side of Georgia's morning meeting. The loop and the tools' definitions are in ea-agent.ts.
// Every tool she uses is recorded in ea_actions (what she did, or what she is proposing and Rolf has not yet acted on).

// deno-lint-ignore-file no-explicit-any
import {
  buildContextBlock, calendarTemplateUrl, defaultHouseholdLabel, gmailComposeUrl, isIsoDate, normalizeMembers, runAgentTurn, SYSTEM_PROMPT, TOOL_DECLARATIONS,
  type Content, type Part, type ToolOutcome,
} from "./ea-agent.ts";
import { fetchWithVertexRetry, getGcpAccessToken, GEMINI_DRAFTING_MODEL, parseServiceAccountKey, vertexModelUrl, withThinking, type ServiceAccountKey } from "./vertex-ai.ts";
import { getValidGoogleAccessToken } from "./google-token.ts";

const DAILY_MESSAGE_CAP = 200;
const zone = "America/Vancouver";
const nowLabel = () => new Date().toLocaleString("en-CA", { timeZone: zone, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }) + " Pacific";
const pacificDate = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(d);

export interface EaAction { id: string; kind: string; status: string; summary: string; payload: Record<string, unknown>; message_id: string | null }
export interface EaMessage { id: string; role: "user" | "assistant"; content: string; created_at: string; actions: EaAction[] }

/** Today's meeting: the conversation with each message's actions, and what she has been asked to remember. */
export async function eaHistory(db: any, userId: string) {
  const date = pacificDate();
  const [{ data: msgs }, { data: acts }, { data: prefs }] = await Promise.all([
    db.from("ea_messages").select("id, role, content, created_at").eq("staff_user_id", userId).eq("conversation_date", date).order("created_at", { ascending: true }),
    db.from("ea_actions").select("id, kind, status, summary, payload, message_id").eq("staff_user_id", userId).eq("conversation_date", date).order("created_at", { ascending: true }),
    db.from("ea_preferences").select("id, kind, value, created_at").eq("staff_user_id", userId).eq("active", true).order("created_at", { ascending: true }),
  ]);
  const byMsg = new Map<string, EaAction[]>();
  for (const a of (acts ?? []) as EaAction[]) if (a.message_id) byMsg.set(a.message_id, [...(byMsg.get(a.message_id) ?? []), a]);
  return { date, messages: ((msgs ?? []) as any[]).map((m) => ({ ...m, actions: byMsg.get(m.id) ?? [] })) as EaMessage[], preferences: prefs ?? [] };
}

/** Rolf's decision on a proposal: he used it ("done") or put it aside ("dismissed"). Georgia never acts on one herself. */
export async function eaDecide(db: any, userId: string, actionId: string, decision: "done" | "dismissed") {
  const { error } = await db.from("ea_actions").update({ status: decision, decided_at: new Date().toISOString() }).eq("id", actionId).eq("staff_user_id", userId).eq("status", "proposed");
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function eaForget(db: any, userId: string, prefId: string) {
  await db.from("ea_preferences").update({ active: false }).eq("id", prefId).eq("staff_user_id", userId);
  return { ok: true };
}

async function briefingText(db: any, userId: string, date: string): Promise<string> {
  const { data: b } = await db.from("daily_briefings").select("greeting, summary_line, priority_items, sections, generation_status").eq("staff_user_id", userId).eq("briefing_date", date).maybeSingle();
  if (!b || b.generation_status !== "complete") return "";
  const s = b.sections ?? {};
  const lines: string[] = [`Summary: ${b.summary_line ?? ""}`, "Priorities:"];
  (b.priority_items ?? []).forEach((p: any, i: number) => lines.push(`${i + 1}. ${p.label} (${p.reason})${p.next_step ? ` Suggested: ${p.next_step}` : ""}`));
  const tm = (iso: string, allDay: boolean) => (allDay ? "all day" : new Date(iso).toLocaleTimeString("en-CA", { timeZone: zone, hour: "numeric", minute: "2-digit" }));
  lines.push("Today's schedule:", ...((s.schedule ?? []).map((e: any) => `- ${tm(e.start, e.allDay)} ${e.summary}${e.conflict ? " (overlaps another event)" : ""}`)), ...((s.schedule ?? []).length ? [] : ["- nothing"]));
  lines.push("The week ahead:", ...((s.week ?? []).flatMap((d: any) => d.items.map((e: any) => `- ${d.date} ${tm(e.start, e.allDay)} ${e.summary}`))), ...((s.week ?? []).length ? [] : ["- nothing"]));
  lines.push("Email from people:", ...((s.replies ?? []).map((e: any) => `- ${e.from}: ${e.subject}`)), ...((s.replies ?? []).length ? [] : ["- none"]));
  lines.push("iA and Adobe Sign notices:", ...((s.ia ?? []).map((e: any) => `- ${e.subject}`)), ...((s.ia ?? []).length ? [] : ["- none"]));
  lines.push("Texts and voicemails:", ...((s.texts ?? []).map((t: any) => `- ${t.contact ?? "Unknown"}: ${t.label}`)), ...((s.texts ?? []).length ? [] : ["- none"]));
  lines.push("Waiting on Rolf:", ...((s.firm ?? []).map((f: any) => `- ${f.label}`)), ...((s.firm ?? []).length ? [] : ["- nothing"]));
  return lines.join("\n");
}

async function callGemini(sa: ServiceAccountKey, systemText: string, contents: Content[]): Promise<{ parts: Part[] }> {
  const token = await getGcpAccessToken(sa);
  const res = await fetchWithVertexRetry(vertexModelUrl(sa.project_id, GEMINI_DRAFTING_MODEL), {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemText }] }, contents,
      tools: [{ functionDeclarations: TOOL_DECLARATIONS }], toolConfig: { functionCallingConfig: { mode: "AUTO" } },
      generationConfig: withThinking(GEMINI_DRAFTING_MODEL, { temperature: 0.4, maxOutputTokens: 2048 }, "low"),
    }),
  });
  if (!res.ok) throw new Error(`Vertex AI error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const parts = j.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) throw new Error("The assistant returned nothing.");
  return { parts };
}

/** A search grounded in Google Search, in its own call (the model cannot mix search and tools in one). */
async function groundedSearch(sa: ServiceAccountKey, query: string) {
  const token = await getGcpAccessToken(sa);
  const res = await fetchWithVertexRetry(vertexModelUrl(sa.project_id, GEMINI_DRAFTING_MODEL), {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `${query}\n\nAnswer briefly with specifics (names, addresses, hours, prices) and say what you could not confirm.` }] }],
      tools: [{ googleSearch: {} }], generationConfig: { temperature: 0.2, maxOutputTokens: 1500 },
    }),
  });
  if (!res.ok) throw new Error(`Search is unavailable (${res.status}).`);
  const j = await res.json();
  const cand = j.candidates?.[0];
  const answer = (cand?.content?.parts ?? []).map((p: Part) => p.text ?? "").join("").trim();
  const sources = ((cand?.groundingMetadata?.groundingChunks ?? []) as any[]).map((c) => ({ title: c.web?.title ?? c.web?.uri, url: c.web?.uri })).filter((s) => s.url).slice(0, 8);
  return { answer, sources };
}

/** One turn: Rolf says something (or the meeting starts); Georgia answers, using tools. */
export async function eaChat(db: any, userId: string, text: string, start: boolean) {
  const date = pacificDate();
  const { count } = await db.from("ea_messages").select("id", { count: "exact", head: true }).eq("staff_user_id", userId).eq("conversation_date", date);
  if ((count ?? 0) >= DAILY_MESSAGE_CAP) throw new Error("That is a lot of messages for one day. Start again tomorrow.");
  const userText = start ? "(The morning meeting is starting. Open it: say good morning, give me the shape of the day in a few lines, name the one or two things you most need a decision on, and ask what I want to start with.)" : String(text ?? "").trim().slice(0, 4000);
  if (!userText) throw new Error("Say something first.");

  const { data: prior } = await db.from("ea_messages").select("role, content").eq("staff_user_id", userId).eq("conversation_date", date).order("created_at", { ascending: true }).limit(40);
  if (!start) await db.from("ea_messages").insert({ staff_user_id: userId, conversation_date: date, role: "user", content: userText });

  const [briefing, { data: tasks }, { data: prefs }] = await Promise.all([
    briefingText(db, userId, date),
    db.from("pm_tasks").select("id, title, due_date").eq("assignee_id", userId).neq("status", "done").order("due_date", { ascending: true, nullsFirst: false }).limit(25),
    db.from("ea_preferences").select("kind, value").eq("staff_user_id", userId).eq("active", true),
  ]);
  const system = `${SYSTEM_PROMPT}\n\n${buildContextBlock({ nowLabel: nowLabel(), briefing, tasks: ((tasks ?? []) as any[]).map((t) => ({ id: t.id, title: t.title, due: t.due_date })), preferences: ((prefs ?? []) as any[]).map((p) => (p.kind === "mute_sender" ? `Do not show mail from: ${p.value}` : p.value)) })}`;
  const history: Content[] = ((prior ?? []) as any[]).map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.content }] }));
  // The model's first turn must be the user's: the opening of the meeting is Georgia's own, so give it a stand-in.
  if (history.length && history[0].role === "model") history.unshift({ role: "user", parts: [{ text: "(The morning meeting has started.)" }] });
  history.push({ role: "user", parts: [{ text: userText }] });

  const sa = await parseServiceAccountKey(Deno.env.get("GCP_SERVICE_ACCOUNT_KEY"));
  const recorded: string[] = [];
  const record = async (kind: string, status: "done" | "proposed" | "failed", summary: string, payload: Record<string, unknown> = {}) => {
    const { data } = await db.from("ea_actions").insert({ staff_user_id: userId, conversation_date: date, kind, status, summary, payload }).select("id").single();
    if (data?.id) recorded.push(data.id);
  };
  let googleToken: string | null = null;
  const google = async () => (googleToken ??= await getValidGoogleAccessToken(db, userId));

  const runTool = async (name: string, a: Record<string, unknown>): Promise<ToolOutcome> => {
    const str = (v: unknown, max = 300) => String(v ?? "").trim().slice(0, max);
    switch (name) {
      case "create_task": {
        const title = str(a.title, 200); if (!title) return { ok: false, message: "A task needs a title." };
        const due = isIsoDate(a.due_date) ? (a.due_date as string) : null;
        const { data, error } = await db.from("pm_tasks").insert({ title, description: str(a.notes, 1000) || null, status: "open", client_visible: false, assignee_id: userId, created_by: userId, due_date: due }).select("id").single();
        if (error) { await record("task_created", "failed", `Could not create: ${title}`); return { ok: false, message: `Could not create the task: ${error.message}` }; }
        await record("task_created", "done", `Task: ${title}${due ? ` (due ${due})` : ""}`, { task_id: data.id, due });
        return { ok: true, message: `Task created: ${title}${due ? `, due ${due}` : ""}.` };
      }
      case "complete_task": case "reschedule_task": {
        const id = str(a.task_id, 60);
        const { data: t } = await db.from("pm_tasks").select("id, title").eq("id", id).eq("assignee_id", userId).neq("status", "done").maybeSingle();
        if (!t) return { ok: false, message: "I could not find that open task." };
        if (name === "complete_task") {
          await db.from("pm_tasks").update({ status: "done", completed_at: new Date().toISOString() }).eq("id", id);
          await record("task_completed", "done", `Completed: ${t.title}`, { task_id: id });
          return { ok: true, message: `Marked done: ${t.title}.` };
        }
        if (!isIsoDate(a.due_date)) return { ok: false, message: "I need a real date (YYYY-MM-DD)." };
        await db.from("pm_tasks").update({ due_date: a.due_date }).eq("id", id);
        await record("task_rescheduled", "done", `Moved: ${t.title} to ${a.due_date}`, { task_id: id, due: a.due_date });
        return { ok: true, message: `Moved ${t.title} to ${a.due_date}.` };
      }
      case "check_calendar": {
        if (!isIsoDate(a.from_date) || !isIsoDate(a.to_date)) return { ok: false, message: "I need two real dates (YYYY-MM-DD)." };
        const token = await google();
        const toEnd = new Date(Date.parse(`${a.to_date}T00:00:00Z`) + 2 * 86_400_000).toISOString();
        const fromStart = new Date(Date.parse(`${a.from_date}T00:00:00Z`) - 86_400_000).toISOString();
        const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?` + new URLSearchParams({ timeMin: fromStart, timeMax: toEnd, maxResults: "60", singleEvents: "true", orderBy: "startTime" }), { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) return { ok: false, message: `The calendar is unavailable (${r.status}).` };
        const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso));
        const events = ((await r.json()).items ?? []).filter((e: any) => e.status !== "cancelled")
          .map((e: any) => ({ title: e.summary ?? "(no title)", start: e.start?.dateTime ?? e.start?.date, end: e.end?.dateTime ?? e.end?.date }))
          .filter((e: any) => e.start && dayOf(e.start) >= (a.from_date as string) && dayOf(e.start) <= (a.to_date as string));
        await record("calendar_checked", "done", `Checked the calendar, ${a.from_date} to ${a.to_date}`, { count: events.length });
        return { ok: true, message: `${events.length} event(s) found.`, data: events };
      }
      case "propose_calendar_event": {
        const title = str(a.title, 200); const url = calendarTemplateUrl({ title, start: str(a.start, 20), end: str(a.end, 20), location: str(a.location) || undefined, notes: str(a.notes, 1000) || undefined });
        if (!title || !url) return { ok: false, message: "I need a title and start and end times like 2026-10-23T15:30." };
        await record("calendar_proposal", "proposed", `Calendar: ${title}`, { title, start: a.start, end: a.end, location: a.location ?? null, notes: a.notes ?? null, url });
        return { ok: true, message: "Proposed. Rolf can add it to his calendar with one click; it is not on the calendar yet." };
      }
      case "draft_email": {
        const subject = str(a.subject, 200), body = str(a.body, 6000); if (!subject || !body) return { ok: false, message: "An email needs a subject and a body." };
        const to = str(a.to, 200);
        await record("email_draft", "proposed", `Email draft: ${subject}`, { to: to || null, to_name: str(a.to_name) || null, subject, body, url: gmailComposeUrl({ to: to || undefined, subject, body }) });
        return { ok: true, message: "Draft prepared for Rolf to review and send. It has not been sent." };
      }
      case "draft_text": {
        const body = str(a.body, 1000); if (!body) return { ok: false, message: "A text needs a message." };
        await record("text_draft", "proposed", `Text draft to ${str(a.to_name) || "someone"}`, { to_name: str(a.to_name) || null, to_number: str(a.to_number) || null, body });
        return { ok: true, message: "Text prepared for Rolf to send. It has not been sent." };
      }
      case "web_search": {
        const q = str(a.query, 400); if (!q) return { ok: false, message: "What should I search for?" };
        const r = await groundedSearch(sa, q);
        await record("research", "done", `Searched: ${q}`, { query: q, sources: r.sources });
        return { ok: true, message: "Search results below. Unverified: say what you could not confirm.", data: r };
      }
      case "search_clients": {
        const q = str(a.query, 80).replace(/[%,()]/g, " ").trim(); if (q.length < 2) return { ok: false, message: "Give me at least two letters of a name." };
        // Every word must match somewhere in the name, so "Ed Weiss" finds Ed Weiss.
        const tokens = q.split(/\s+/).filter(Boolean).slice(0, 4);
        let people = db.from("contacts").select("id, first_name, last_name, family_role, household_id, family_id");
        for (const t of tokens) people = people.or(`first_name.ilike.%${t}%,last_name.ilike.%${t}%,full_name.ilike.%${t}%`);
        const [{ data: peopleRows }, { data: hh }] = await Promise.all([
          people.limit(8),
          db.from("households").select("id, label, service_tier").ilike("label", `%${q}%`).limit(5),
        ]);
        return { ok: true, message: `${(peopleRows ?? []).length} contact(s), ${(hh ?? []).length} household(s).`, data: { contacts: (peopleRows ?? []).map((p: any) => ({ name: `${p.first_name} ${p.last_name ?? ""}`.trim(), role: p.family_role, link: p.id ? `/contacts/${p.id}` : null })), households: (hh ?? []).map((h: any) => ({ name: h.label, tier: h.service_tier, link: `/households/${h.id}` })) } };
      }
      case "create_household": {
        const { members, problems } = normalizeMembers(Array.isArray(a.members) ? a.members : []);
        if (problems.length) return { ok: false, message: problems.join(" ") };
        // Never create a second copy of someone who is already in the CRM.
        const dupes: string[] = [];
        for (const m of members) {
          const { data: byName } = await db.from("contacts").select("id, first_name, last_name, household_id").ilike("first_name", m.first_name).ilike("last_name", m.last_name).limit(3);
          const { data: byEmail } = m.email ? await db.from("contacts").select("id, first_name, last_name").ilike("email", m.email).limit(3) : { data: [] };
          for (const x of [...(byName ?? []), ...(byEmail ?? [])] as any[]) dupes.push(`${x.first_name} ${x.last_name ?? ""}`.trim());
        }
        if (dupes.length) return { ok: false, message: `Already in the CRM: ${[...new Set(dupes)].join(", ")}. I did not create anything. Ask Rolf whether this is the same person or a different one.` };
        const familyName = str(a.family_name, 100) || members[0].last_name;
        const { data: sameFamily } = await db.from("families").select("id, name").ilike("name", familyName).limit(3);
        if ((sameFamily ?? []).length) return { ok: false, message: `A family called "${familyName}" already exists. I did not create anything. Ask Rolf whether to add these people to it or use a different family name.` };
        const label = str(a.household_label, 120) || defaultHouseholdLabel(members);
        const { data: fam, error: fe } = await db.from("families").insert({ name: familyName, created_by: userId }).select("id").single();
        if (fe) return { ok: false, message: `Could not create the family: ${fe.message}` };
        const { data: hh, error: he } = await db.from("households").insert({ family_id: fam.id, label, address: str(a.address, 400) || null }).select("id").single();
        if (he) return { ok: false, message: `Could not create the household: ${he.message}` };
        const made: string[] = [];
        for (const m of members) {
          const { error: ce } = await db.from("contacts").insert({ created_by: userId, first_name: m.first_name, last_name: m.last_name, full_name: `${m.first_name} ${m.last_name}`, family_id: fam.id, household_id: hh.id, family_role: m.role, email: m.email, phone: m.phone, date_of_birth: m.date_of_birth, is_minor: m.role === "minor" });
          if (ce) { await record("household_created", "failed", `Household ${label}: could not add ${m.first_name}`, { household_id: hh.id }); return { ok: false, message: `The household was created but ${m.first_name} could not be added: ${ce.message}` }; }
          made.push(`${m.first_name} ${m.last_name} (${m.role.replace(/_/g, " ")})`);
        }
        await record("household_created", "done", `Household created: ${label} (${made.length} ${made.length === 1 ? "person" : "people"})`, { household_id: hh.id, family_id: fam.id, link: `/households/${hh.id}` });
        return { ok: true, message: `Created the ${familyName} family and household "${label}" with ${made.join(", ")}. It has no tier, accounts or Vault yet.` };
      }
      case "add_contact": {
        const hn = str(a.household_name, 120); if (!hn) return { ok: false, message: "Which household?" };
        const { members, problems } = normalizeMembers([{ first_name: a.first_name, last_name: a.last_name, role: a.role ?? "beneficiary", email: a.email, phone: a.phone, date_of_birth: a.date_of_birth }]);
        if (problems.length) return { ok: false, message: problems.join(" ") };
        const m = members[0];
        const { data: hhs } = await db.from("households").select("id, label, family_id").or(`label.ilike.%${hn.replace(/[%,()]/g, " ")}%`).limit(5);
        if ((hhs ?? []).length !== 1) return { ok: false, message: (hhs ?? []).length ? `That matches ${(hhs ?? []).map((h: any) => h.label).join(", ")}. Which one?` : `I could not find a household called "${hn}".` };
        const { data: dup } = await db.from("contacts").select("id").ilike("first_name", m.first_name).ilike("last_name", m.last_name).eq("household_id", hhs[0].id).limit(1);
        if ((dup ?? []).length) return { ok: false, message: `${m.first_name} ${m.last_name} is already in ${hhs[0].label}.` };
        const { error } = await db.from("contacts").insert({ created_by: userId, first_name: m.first_name, last_name: m.last_name, full_name: `${m.first_name} ${m.last_name}`, family_id: hhs[0].family_id, household_id: hhs[0].id, family_role: m.role, email: m.email, phone: m.phone, date_of_birth: m.date_of_birth, is_minor: m.role === "minor" });
        if (error) return { ok: false, message: `Could not add them: ${error.message}` };
        await record("contact_added", "done", `Added ${m.first_name} ${m.last_name} to ${hhs[0].label}`, { household_id: hhs[0].id, link: `/households/${hhs[0].id}` });
        return { ok: true, message: `Added ${m.first_name} ${m.last_name} to ${hhs[0].label} as ${m.role.replace(/_/g, " ")}.` };
      }
      case "remember_preference": {
        const kind = a.kind === "mute_sender" ? "mute_sender" : "note"; const value = str(a.value, 300); if (value.length < 3) return { ok: false, message: "What should I remember?" };
        const { data } = await db.from("ea_preferences").insert({ staff_user_id: userId, kind, value }).select("id").single();
        await record("preference", "done", kind === "mute_sender" ? `I will stop showing mail from ${value}` : `Remembered: ${value}`, { id: data?.id, kind, value });
        return { ok: true, message: "Remembered." };
      }
      default: return { ok: false, message: "I do not have that tool." };
    }
  };

  const result = await runAgentTurn(history, { callModel: (contents) => callGemini(sa, system, contents), runTool });
  const answer = result.text || "I did what you asked.";
  const { data: saved } = await db.from("ea_messages").insert({ staff_user_id: userId, conversation_date: date, role: "assistant", content: answer }).select("id, role, content, created_at").single();
  if (saved?.id && recorded.length) await db.from("ea_actions").update({ message_id: saved.id }).in("id", recorded);
  const { data: acts } = recorded.length ? await db.from("ea_actions").select("id, kind, status, summary, payload, message_id").in("id", recorded) : { data: [] };
  return { message: { ...saved, actions: acts ?? [] } as EaMessage };
}

/** 9:00: tell Rolf the meeting is ready, once, if the briefing is done and he has not already started. */
export async function eaNudge(db: any) {
  const date = pacificDate();
  const { data: staff } = await db.from("profiles").select("user_id").ilike("email", "%@prosperwise.ca");
  let sent = 0;
  for (const s of (staff ?? []) as { user_id: string }[]) {
    const { data: b } = await db.from("daily_briefings").select("generation_status, priority_items").eq("staff_user_id", s.user_id).eq("briefing_date", date).maybeSingle();
    if (!b || b.generation_status !== "complete") continue;
    const { count } = await db.from("ea_messages").select("id", { count: "exact", head: true }).eq("staff_user_id", s.user_id).eq("conversation_date", date);
    if ((count ?? 0) > 0) continue;
    await db.from("staff_notifications").insert({ title: "Your morning meeting with Georgia is ready", body: `Your briefing has ${(b.priority_items ?? []).length} priorities. Open Today to go through it.`, link: "/briefing", source_type: "ea_meeting" });
    sent++;
  }
  return { nudged: sent };
}
