// The Daily Briefing: an AI-generated per-staff-member morning summary.
// Pre-generated every morning via pg_cron (see the companion schedule
// migration); a staff member can also trigger their own regeneration
// on-demand from the Dashboard. Not a live sync -- facts are recomputed
// fresh on every generation, cron or manual.
//
// Personal facts (own pm_tasks, own Google Calendar, own Gmail unread) are
// gathered per staff member. Client requests and the Quo inbox are
// firm-wide (neither table has a per-user assignment column in this
// codebase's flat-access model), so those sections are identical across
// every staff member's briefing.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getValidGoogleAccessToken } from "../_shared/google-token.ts";
import { generateVertexContent, parseServiceAccountKey, GEMINI_FLASH_MODEL, withThinking } from "../_shared/vertex-ai.ts";

const ALLOWED_ORIGINS = [
  "https://prosperwise-portal.web.app",
  "https://prosperwise.lovable.app",
  "https://app.prosperwise.ca",
  "https://id-preview--339dfc8f-3e82-4b05-8a36-a9f66fc58449.lovable.app",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-daily-briefing-cron-secret",
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("DAILY_BRIEFING_CRON_SECRET");

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

function isCronCaller(req: Request): boolean {
  if (!CRON_SECRET) return false;
  return req.headers.get("x-daily-briefing-cron-secret") === CRON_SECRET;
}

async function requireStaffUser(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data } = await supabaseUser.auth.getUser();
  return data?.user?.id ?? null;
}

// Kelowna, BC is Pacific Time -- the briefing's "today" must be the Pacific
// calendar day, not the UTC day the Deno runtime's clock uses.
function pacificDateString(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// Pure calendar-date arithmetic (day + n, then reformat through the target
// timezone) -- never raw hour-offset math, which breaks across the DST
// boundary.
function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days, 12)); // noon UTC avoids DST edge cases
  return pacificDateString(dt);
}

// Converts a Pacific-calendar-date's local midnight into a UTC ISO instant,
// detecting PST vs PDT for that date rather than assuming a fixed offset.
function pacificMidnightUtcIso(dateStr: string): string {
  const guess = new Date(`${dateStr}T12:00:00-08:00`);
  const tzName = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Vancouver",
    timeZoneName: "short",
  })
    .formatToParts(guess)
    .find((p) => p.type === "timeZoneName")?.value;
  const offset = tzName === "PDT" ? "-07:00" : "-08:00";
  return new Date(`${dateStr}T00:00:00${offset}`).toISOString();
}

// deno-lint-ignore no-explicit-any
type Db = any;

interface TaskFact { title: string; project: string | null; due_date?: string; link: string | null }
interface TaskFacts { overdue: TaskFact[]; due_today: TaskFact[]; upcoming: TaskFact[] }

// A task can carry contact_id/household_id/family_id/project_id
// simultaneously (pm-service auto-derives household/family from contact) --
// link to whichever surface actually shows this task's own list, most
// specific first: ContactTaskList > HouseholdTaskRollup > FamilyTaskRollup >
// the task's project.
function taskLink(t: { contact_id: string | null; household_id: string | null; family_id: string | null; project_id: string | null }): string | null {
  if (t.contact_id) return `/contacts/${t.contact_id}`;
  if (t.household_id) return `/households/${t.household_id}`;
  if (t.family_id) return `/families/${t.family_id}`;
  if (t.project_id) return `/projects/${t.project_id}`;
  return null;
}

async function gatherTaskFacts(db: Db, userId: string, todayStr: string): Promise<TaskFacts> {
  const { data: tasks } = await db
    .from("pm_tasks")
    .select("id, project_id, contact_id, household_id, family_id, title, due_date")
    .eq("assignee_id", userId)
    .neq("status", "done")
    .order("due_date", { ascending: true });

  // deno-lint-ignore no-explicit-any
  const projectIds = [...new Set((tasks || []).map((t: any) => t.project_id).filter(Boolean))];
  let projectNames: Record<string, string> = {};
  if (projectIds.length) {
    const { data: projects } = await db.from("pm_projects").select("id, name").in("id", projectIds);
    // deno-lint-ignore no-explicit-any
    projectNames = Object.fromEntries((projects || []).map((p: any) => [p.id, p.name]));
  }

  // "Upcoming" is capped to the next 3 days -- a task due next month isn't
  // part of a *daily* briefing. Overdue tasks are never capped: however far
  // past due, they're still relevant today.
  const upcomingCutoff = addDaysToDateString(todayStr, 3);

  const facts: TaskFacts = { overdue: [], due_today: [], upcoming: [] };
  // deno-lint-ignore no-explicit-any
  for (const t of tasks || []) {
    if (!t.due_date) continue; // undated tasks carry no urgency signal, same as MyTasksWidget's own sort
    const project = t.project_id ? projectNames[t.project_id] ?? null : null;
    const link = taskLink(t);
    if (t.due_date < todayStr) facts.overdue.push({ title: t.title, project, due_date: t.due_date, link });
    else if (t.due_date === todayStr) facts.due_today.push({ title: t.title, project, link });
    else if (t.due_date <= upcomingCutoff) facts.upcoming.push({ title: t.title, project, due_date: t.due_date, link });
  }
  return facts;
}

interface CalendarFacts { connected: boolean; events: { summary: string; start: string; link: string | null }[] }

interface EmailFacts { connected: boolean; emails: { subject: string; from: string; snippet: string; link: string }[] }

async function gatherGoogleFacts(
  db: Db,
  userId: string,
  todayStr: string,
): Promise<{ calendar: CalendarFacts; email: EmailFacts }> {
  let accessToken: string;
  try {
    accessToken = await getValidGoogleAccessToken(db, userId);
  } catch {
    return { calendar: { connected: false, events: [] }, email: { connected: false, emails: [] } };
  }

  const calendar: CalendarFacts = await (async () => {
    try {
      const timeMin = pacificMidnightUtcIso(todayStr);
      const timeMax = pacificMidnightUtcIso(addDaysToDateString(todayStr, 1));
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
          new URLSearchParams({ timeMin, timeMax, maxResults: "20", singleEvents: "true", orderBy: "startTime" }),
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) throw new Error(`Calendar API error: ${res.status}`);
      const data = await res.json();
      // deno-lint-ignore no-explicit-any
      const events = (data.items || []).map((e: any) => ({
        summary: e.summary || "(no title)",
        start: e.start?.dateTime || e.start?.date,
        link: e.htmlLink || null,
      }));
      return { connected: true, events };
    } catch {
      return { connected: false, events: [] };
    }
  })();

  const email: EmailFacts = await (async () => {
    try {
      const listRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?` +
          new URLSearchParams({ q: "in:inbox is:unread", maxResults: "10" }),
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!listRes.ok) throw new Error(`Gmail list error: ${listRes.status}`);
      const listData = await listRes.json();
      // deno-lint-ignore no-explicit-any
      const ids = (listData.messages || []).slice(0, 10) as any[];
      const details = await Promise.all(
        ids.map(async (m) => {
          const params = new URLSearchParams({ format: "metadata" });
          params.append("metadataHeaders", "Subject");
          params.append("metadataHeaders", "From");
          const r = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?${params}`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
          );
          return r.ok ? r.json() : null;
        }),
      );
      // deno-lint-ignore no-explicit-any
      const getHeader = (headers: any[], name: string) =>
        // deno-lint-ignore no-explicit-any
        headers?.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
      const emails = details
        .filter(Boolean)
        // deno-lint-ignore no-explicit-any
        .map((msg: any) => ({
          subject: getHeader(msg.payload?.headers || [], "Subject") || "(no subject)",
          from: getHeader(msg.payload?.headers || [], "From"),
          snippet: msg.snippet || "",
          link: `https://mail.google.com/mail/u/0/#all/${msg.id}`,
        }));
      return { connected: true, emails };
    } catch {
      return { connected: false, emails: [] };
    }
  })();

  return { calendar, email };
}

interface RequestFact { contact: string; type: string; description: string; created_at: string; awaiting_staff_reply: boolean; link: string }

async function gatherRequestFacts(db: Db): Promise<RequestFact[]> {
  const { data } = await db
    .from("portal_requests")
    .select(
      "id, request_type, request_description, status, created_at, contacts(full_name), portal_request_messages(sender_type, created_at)",
    )
    .neq("status", "resolved")
    .order("created_at", { ascending: true })
    .limit(15);

  // deno-lint-ignore no-explicit-any
  return (data || []).map((r: any) => {
    const messages = r.portal_request_messages || [];
    const latest = messages.length
      ? [...messages].sort(
          // deno-lint-ignore no-explicit-any
          (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )[0]
      : null;
    const awaiting_staff_reply = !latest || latest.sender_type === "client";
    return {
      contact: r.contacts?.full_name || "Unknown contact",
      type: r.request_type,
      description: r.request_description,
      created_at: r.created_at,
      awaiting_staff_reply,
      link: "/requests",
    };
  });
}

interface QuoFacts {
  unread: { label: string; contact: string | null; link: string }[];
  unmatchedCount: number;
  voicemailCount: number;
}

async function gatherQuoFacts(db: Db): Promise<QuoFacts> {
  const [{ data: messages }, { data: calls }] = await Promise.all([
    db.from("quo_messages").select("id, contact_id, direction, body, occurred_at, read_at").order("occurred_at", { ascending: false }).limit(200),
    db.from("quo_calls").select("id, contact_id, direction, occurred_at, read_at, is_voicemail").order("occurred_at", { ascending: false }).limit(200),
  ]);

  // deno-lint-ignore no-explicit-any
  const allMsgs = (messages || []) as any[];
  // deno-lint-ignore no-explicit-any
  const allCalls = (calls || []) as any[];

  const contactIds = [
    ...new Set([...allMsgs, ...allCalls].map((r) => r.contact_id).filter(Boolean)),
  ];
  let contactNames: Record<string, string> = {};
  if (contactIds.length) {
    const { data: contacts } = await db.from("contacts").select("id, first_name, last_name").in("id", contactIds);
    contactNames = Object.fromEntries(
      // deno-lint-ignore no-explicit-any
      (contacts || []).map((c: any) => [c.id, `${c.first_name} ${c.last_name || ""}`.trim()]),
    );
  }

  const unreadMsgs = allMsgs.filter((m) => m.direction === "inbound" && !m.read_at);
  const unreadCalls = allCalls.filter((c) => c.direction === "inbound" && !c.read_at && !c.is_voicemail);
  const unread = [...unreadMsgs.slice(0, 5), ...unreadCalls.slice(0, 5)].map((r) => ({
    label: r.body ? (r.body.length > 80 ? r.body.slice(0, 80) + "…" : r.body) : "Missed call",
    contact: r.contact_id ? contactNames[r.contact_id] ?? null : null,
    link: "/inbox",
  }));

  const unmatchedCount = [...allMsgs, ...allCalls].filter((r) => !r.contact_id).length;
  const voicemailCount = allCalls.filter((c) => c.is_voicemail && !c.read_at).length;

  return { unread, unmatchedCount, voicemailCount };
}

interface FactRef { label: string; link: string | null }

// Builds the plain-text block handed to the model, and a parallel, index-
// matched list of {label, link}. The model is only ever asked to cite a
// fact's number (see BRIEFING_TOOL_SCHEMA) -- the label/link a priority item
// ends up with are always resolved server-side from this list, never from
// AI-generated text, so a link can never be hallucinated or malformed.
function buildFactsBlockAndRefs(
  tasks: TaskFacts,
  calendar: CalendarFacts,
  email: EmailFacts,
  requests: RequestFact[],
  quo: QuoFacts,
): { block: string; refs: FactRef[] } {
  const lines: string[] = [];
  const refs: FactRef[] = [];
  const add = (label: string, link: string | null, text: string) => {
    refs.push({ label, link });
    lines.push(`[${refs.length}] ${text}`);
  };

  lines.push(`Overdue tasks (${tasks.overdue.length}):`);
  tasks.overdue.forEach((t) => {
    const label = `${t.title}${t.project ? ` [${t.project}]` : ""}`;
    add(label, t.link, `${label} (was due ${t.due_date})`);
  });
  lines.push(`Due today (${tasks.due_today.length}):`);
  tasks.due_today.forEach((t) => {
    const label = `${t.title}${t.project ? ` [${t.project}]` : ""}`;
    add(label, t.link, label);
  });
  lines.push(`Upcoming in the next 3 days (${tasks.upcoming.length}):`);
  tasks.upcoming.forEach((t) => {
    const label = `${t.title}${t.project ? ` [${t.project}]` : ""}`;
    add(label, t.link, `${label} (due ${t.due_date})`);
  });

  if (calendar.connected) {
    lines.push(`Today's calendar events (${calendar.events.length}):`);
    calendar.events.forEach((e) => add(e.summary, e.link, `${e.summary} at ${e.start}`));
  } else {
    lines.push("Calendar: not connected.");
  }

  if (email.connected) {
    lines.push(`Unread inbox emails (${email.emails.length}):`);
    email.emails.forEach((e) => add(e.subject, e.link, `From ${e.from}: "${e.subject}" — ${e.snippet}`));
  } else {
    lines.push("Email: not connected.");
  }

  lines.push(`Open client requests, firm-wide (${requests.length}):`);
  requests.forEach((r) => {
    const label = `${r.contact}: ${r.type}`;
    add(
      label,
      r.link,
      `${label} — "${r.description}"${r.awaiting_staff_reply ? " (awaiting our reply)" : ""} (opened ${r.created_at})`,
    );
  });

  lines.push(
    `Quo inbox, firm-wide: ${quo.unread.length} unread items shown, ${quo.unmatchedCount} unmatched to any contact, ${quo.voicemailCount} unheard voicemails.`,
  );
  quo.unread.forEach((u) => {
    const label = u.contact ? u.contact : "Unknown number";
    add(label, u.link, `${label}: "${u.label}"`);
  });

  return { block: lines.join("\n"), refs };
}

const BRIEFING_TOOL_SCHEMA = {
  functionDeclarations: [
    {
      name: "populate_daily_briefing",
      description: "Populate the Daily Briefing shown to a staff member on their dashboard.",
      parameters: {
        type: "OBJECT",
        properties: {
          greeting: { type: "STRING" },
          summary_line: { type: "STRING" },
          priority_items: {
            type: "ARRAY",
            description: "At most 7 items, ranked by urgency. Each must cite the bracketed [N] number of the fact it refers to -- never describe a fact that isn't numbered below.",
            items: {
              type: "OBJECT",
              properties: {
                fact_index: { type: "INTEGER", description: "The bracketed [N] number of the fact this item is about." },
                reason: { type: "STRING", description: "One short phrase on why this is a priority right now." },
              },
              required: ["fact_index", "reason"],
            },
          },
        },
        required: ["greeting", "summary_line", "priority_items"],
      },
    },
  ],
};

async function generateBriefingForUser(db: Db, userId: string, todayStr: string): Promise<void> {
  const [tasks, google, requests, quo] = await Promise.all([
    gatherTaskFacts(db, userId, todayStr),
    gatherGoogleFacts(db, userId, todayStr),
    gatherRequestFacts(db),
    gatherQuoFacts(db),
  ]);
  const facts = { tasks, calendar: google.calendar, email: google.email, requests, quo };

  await db.from("daily_briefings").upsert(
    {
      staff_user_id: userId,
      briefing_date: todayStr,
      facts,
      generation_status: "generating",
      generation_error: null,
    },
    { onConflict: "staff_user_id,briefing_date" },
  );

  try {
    const sa = await parseServiceAccountKey(Deno.env.get("GCP_SERVICE_ACCOUNT_KEY"));
    const { block, refs } = buildFactsBlockAndRefs(tasks, google.calendar, google.email, requests, quo);
    const prompt = `You are writing "The Daily Briefing" for a ProsperWise advisory-firm staff member's dashboard.
Write a short greeting line, a one-sentence summary of their day, and a short prioritized list of items.
Rules:
- Never invent a task, meeting, email, client request, or inbox item not present in the facts below.
- Every priority item MUST cite the bracketed [N] number of the exact fact line it refers to.
- If a category is empty, say so plainly and briefly in summary_line -- don't manufacture urgency, and don't cite it as a priority item.
- Keep greeting to a few words (e.g. "Good morning"). Keep summary_line to one sentence.
- priority_items should have at most 7 entries, ranked by genuine urgency across ALL categories (not grouped by category) -- overdue tasks and things awaiting our reply usually rank highest.
- The client-requests and Quo inbox sections are firm-wide, shared by every staff member -- treat them as "things happening at the firm right now", not personal assignments.
Call populate_daily_briefing with all fields filled.

Facts:
${block}`;

    const result = await generateVertexContent(
      sa,
      GEMINI_FLASH_MODEL,
      [{ role: "user", parts: [{ text: prompt }] }],
      withThinking(GEMINI_FLASH_MODEL, { temperature: 0.3, maxOutputTokens: 2048 }, "low"),
      {
        tools: [BRIEFING_TOOL_SCHEMA],
        toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["populate_daily_briefing"] } },
      },
    );

    // deno-lint-ignore no-explicit-any
    const parts = result.candidates?.[0]?.content?.parts || [];
    // deno-lint-ignore no-explicit-any
    const fnCall = parts.find((p: any) => p.functionCall)?.functionCall;
    if (!fnCall?.args) throw new Error("AI did not return structured data");

    // Resolve each cited fact_index back to its real, deterministically-built
    // label/link -- never trust AI-generated text as a URL. Out-of-range or
    // duplicate indices are silently dropped rather than surfaced as broken
    // items.
    const rawItems = Array.isArray(fnCall.args.priority_items) ? fnCall.args.priority_items : [];
    const seen = new Set<number>();
    const priorityItems = rawItems
      // deno-lint-ignore no-explicit-any
      .filter((it: any) => {
        const idx = Number(it?.fact_index);
        if (!Number.isInteger(idx) || idx < 1 || idx > refs.length || seen.has(idx)) return false;
        seen.add(idx);
        return true;
      })
      .slice(0, 7)
      // deno-lint-ignore no-explicit-any
      .map((it: any) => {
        const ref = refs[Number(it.fact_index) - 1];
        return { label: ref.label, link: ref.link, reason: String(it.reason || "") };
      });

    await db
      .from("daily_briefings")
      .update({
        greeting: String(fnCall.args.greeting || ""),
        summary_line: String(fnCall.args.summary_line || ""),
        priority_items: priorityItems,
        generation_status: "complete",
        generation_error: null,
        generated_at: new Date().toISOString(),
      })
      .eq("staff_user_id", userId)
      .eq("briefing_date", todayStr);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .from("daily_briefings")
      .update({ generation_status: "error", generation_error: message.slice(0, 500) })
      .eq("staff_user_id", userId)
      .eq("briefing_date", todayStr);
    throw err;
  }
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const db = admin();
  const todayStr = pacificDateString(new Date());
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (isCronCaller(req)) {
    const { data: staff } = await db.from("profiles").select("user_id, email").ilike("email", "%@prosperwise.ca");
    let generated = 0;
    let skipped = 0;
    const errors: { userId: string; message: string }[] = [];
    // deno-lint-ignore no-explicit-any
    for (const s of (staff || []) as any[]) {
      try {
        await generateBriefingForUser(db, s.user_id, todayStr);
        generated++;
      } catch (e) {
        skipped++;
        errors.push({ userId: s.user_id, message: e instanceof Error ? e.message : String(e) });
      }
    }
    return json({ generated, skipped, errors });
  }

  const userId = await requireStaffUser(req);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  try {
    await generateBriefingForUser(db, userId, todayStr);
    const { data: briefing } = await db
      .from("daily_briefings")
      .select("*")
      .eq("staff_user_id", userId)
      .eq("briefing_date", todayStr)
      .maybeSingle();
    return json({ ok: true, briefing });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
