// Uses Deno.serve (no std import needed)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const ASANA_ACCESS_TOKEN = Deno.env.get("ASANA_ACCESS_TOKEN");
const ASANA_WORKSPACE_ID = Deno.env.get("ASANA_WORKSPACE_ID");

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
      "authorization, x-client-info, apikey, content-type, x-dump-secret",
  };
}

// ---------- Google token helper ----------
async function getValidToken(sb: any, userId: string): Promise<string> {
  const { data, error } = await sb.from("google_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (error || !data) throw new Error(`No google_tokens row for user_id ${userId}`);

  if (new Date(data.token_expiry) <= new Date()) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: data.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    const tokens = await res.json();
    if (tokens.error) throw new Error(`Token refresh failed: ${tokens.error}`);
    const newExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    await sb.from("google_tokens").update({ access_token: tokens.access_token, token_expiry: newExpiry }).eq("user_id", userId);
    return tokens.access_token;
  }
  return data.access_token;
}

// ---------- Types ----------
interface ActivityRow {
  label: string;      // Short kind: "Portal Request", "SMS", "Call", …
  summary: string;    // One-line description
  detail?: string;    // Optional nested detail line(s)
}

// ---------- Main ----------
Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const expectedSecret = Deno.env.get("DAILY_DUMP_SECRET");
    const provided = req.headers.get("x-dump-secret");
    if (!expectedSecret || provided !== expectedSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const folderIdRaw = Deno.env.get("DAILY_DUMP_DRIVE_FOLDER_ID");
    const googleUserId = Deno.env.get("DAILY_DUMP_GOOGLE_USER_ID");
    if (!folderIdRaw) throw new Error("DAILY_DUMP_DRIVE_FOLDER_ID not configured");
    const folderId = (folderIdRaw.match(/folders\/([a-zA-Z0-9_-]+)/) || [null, folderIdRaw.trim()])[1];
    if (!googleUserId) throw new Error("DAILY_DUMP_GOOGLE_USER_ID not configured");

    let targetDate: string;
    try {
      const body = await req.json();
      targetDate = body?.date || defaultYesterday();
    } catch {
      targetDate = defaultYesterday();
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const dayStart = `${targetDate}T00:00:00Z`;
    const dayEnd = `${targetDate}T23:59:59Z`;

    // ---------- Pull activity rows ----------
    const [
      portalReqRes,
      pipelineRes,
      contactsRes,
      holdingRes,
      auditRes,
      reviewRes,
      quoMsgRes,
      quoCallRes,
      manualRes,
      requestMsgRes,
    ] = await Promise.all([
      sb.from("portal_requests")
        .select("id, contact_id, request_type, request_description, status")
        .gte("created_at", dayStart).lte("created_at", dayEnd),
      sb.from("business_pipeline")
        .select("contact_id, category, status, amount, notes")
        .gte("updated_at", dayStart).lte("updated_at", dayEnd),
      sb.from("contacts")
        .select("id, households(governance_status)")
        .gte("updated_at", dayStart).lte("updated_at", dayEnd),
      sb.from("holding_tank")
        .select("contact_id, account_name, status, current_value")
        .gte("updated_at", dayStart).lte("updated_at", dayEnd),
      sb.from("sovereignty_audit_trail")
        .select("contact_id, action_type, action_description")
        .gte("created_at", dayStart).lte("created_at", dayEnd),
      sb.from("review_queue")
        .select("contact_id, action_type, action_description, status")
        .gte("created_at", dayStart).lte("created_at", dayEnd),
      sb.from("quo_messages")
        .select("contact_id, direction, body, pii_blocked, pii_block_reason")
        .gte("occurred_at", dayStart).lte("occurred_at", dayEnd),
      sb.from("quo_calls")
        .select("contact_id, direction, duration_seconds, summary, is_voicemail")
        .gte("occurred_at", dayStart).lte("occurred_at", dayEnd),
      sb.from("manual_activity_log")
        .select("contact_id, kind, direction, subject, body, duration_minutes")
        .gte("occurred_at", dayStart).lte("occurred_at", dayEnd),
      sb.from("portal_request_messages")
        .select("request_id, sender_type, sender_name, content")
        .gte("created_at", dayStart).lte("created_at", dayEnd),
    ]);

    // Portal-request-message contact lookup
    const requestMessages = requestMsgRes.data || [];
    const requestIds = [...new Set(requestMessages.map((m: any) => m.request_id).filter(Boolean))];
    const requestIdToContact: Record<string, string> = {};
    if (requestIds.length) {
      const { data: reqs } = await sb.from("portal_requests").select("id, contact_id").in("id", requestIds);
      for (const r of reqs || []) requestIdToContact[r.id] = r.contact_id;
    }

    // Collect all contact_ids we need names for
    const contactIds = new Set<string>();
    const push = (id: any) => id && contactIds.add(id);
    (portalReqRes.data || []).forEach((r: any) => push(r.contact_id));
    (pipelineRes.data || []).forEach((r: any) => push(r.contact_id));
    (contactsRes.data || []).forEach((r: any) => push(r.id));
    (holdingRes.data || []).forEach((r: any) => push(r.contact_id));
    (auditRes.data || []).forEach((r: any) => push(r.contact_id));
    (reviewRes.data || []).forEach((r: any) => push(r.contact_id));
    (quoMsgRes.data || []).forEach((r: any) => push(r.contact_id));
    (quoCallRes.data || []).forEach((r: any) => push(r.contact_id));
    (manualRes.data || []).forEach((r: any) => push(r.contact_id));
    requestMessages.forEach((m: any) => push(requestIdToContact[m.request_id]));

    const contactNames: Record<string, string> = {};
    if (contactIds.size) {
      const { data: cs } = await sb.from("contacts").select("id, full_name").in("id", [...contactIds]);
      for (const c of cs || []) contactNames[c.id] = c.full_name || "(Unnamed contact)";
    }

    // Group activity by contact
    const byContact: Record<string, ActivityRow[]> = {};
    const addRow = (contactId: string | null | undefined, row: ActivityRow) => {
      const key = contactId || "__unassigned__";
      (byContact[key] ||= []).push(row);
    };

    for (const r of portalReqRes.data || []) {
      addRow(r.contact_id, {
        label: "Portal Request",
        summary: `${r.request_type || "Request"} — ${r.status || "open"}`,
        detail: r.request_description || undefined,
      });
    }
    for (const r of pipelineRes.data || []) {
      const amt = r.amount != null ? ` — $${Number(r.amount).toLocaleString()}` : "";
      addRow(r.contact_id, {
        label: "Pipeline",
        summary: `${r.category || "Item"} → ${r.status || "updated"}${amt}`,
        detail: r.notes || undefined,
      });
    }
    for (const r of contactsRes.data || []) {
      addRow(r.id, {
        label: "Contact Updated",
        summary: r.households?.governance_status ? `Governance: ${r.households.governance_status}` : "Profile updated",
      });
    }
    for (const r of holdingRes.data || []) {
      const val = r.current_value != null ? ` — $${Number(r.current_value).toLocaleString()}` : "";
      addRow(r.contact_id, {
        label: "Holding Tank",
        summary: `${r.account_name || "Account"} (${r.status || "updated"})${val}`,
      });
    }
    for (const r of auditRes.data || []) {
      addRow(r.contact_id, {
        label: "Audit Trail",
        summary: `${r.action_type || "action"}`,
        detail: r.action_description || undefined,
      });
    }
    for (const r of reviewRes.data || []) {
      addRow(r.contact_id, {
        label: "Review Queue",
        summary: `${r.action_type || "review"} — ${r.status || "pending"}`,
        detail: r.action_description || undefined,
      });
    }
    for (const r of quoMsgRes.data || []) {
      if (r.pii_blocked) {
        addRow(r.contact_id, {
          label: "SMS Blocked",
          summary: `${r.direction || ""} — PII Shield: ${r.pii_block_reason || "blocked"}`,
        });
      } else {
        addRow(r.contact_id, {
          label: "SMS",
          summary: `${r.direction || ""}`,
          detail: r.body ? truncate(r.body, 200) : undefined,
        });
      }
    }
    for (const r of quoCallRes.data || []) {
      const dur = r.duration_seconds ? ` (${Math.round(r.duration_seconds / 60)}m)` : "";
      addRow(r.contact_id, {
        label: r.is_voicemail ? "Voicemail" : "Call",
        summary: `${r.direction || ""}${dur}`,
        detail: r.summary || undefined,
      });
    }
    for (const r of manualRes.data || []) {
      const dur = r.duration_minutes ? ` (${r.duration_minutes}m)` : "";
      addRow(r.contact_id, {
        label: `Manual ${r.kind || "note"}`,
        summary: `${r.direction || ""} ${r.subject || ""}${dur}`.trim(),
        detail: r.body ? truncate(r.body, 300) : undefined,
      });
    }
    for (const m of requestMessages) {
      addRow(requestIdToContact[m.request_id], {
        label: "Request Reply",
        summary: `${m.sender_type || "message"} — ${m.sender_name || ""}`.trim(),
        detail: m.content ? truncate(m.content, 200) : undefined,
      });
    }

    // ---------- Fetch Asana tasks modified/completed on target day ----------
    const asanaTasks = await fetchAsanaTasks(targetDate);

    // ---------- Build markdown ----------
    const displayDate = toDisplayDate(targetDate);
    const md = buildMarkdown({ displayDate, byContact, contactNames, asanaTasks });

    // ---------- Locate today's pre-created Doc & append ----------
    const gToken = await getValidToken(sb, googleUserId);

    // The scheduled job at 10:15 PM PT creates a file named like:
    //   "[July 1, 2026 at 10:15 PM PDT] Daily Dump"
    // We search the folder for any file whose name starts with "[<displayDate>"
    // and append our activity dump after any existing content.
    const namePrefix = `[${displayDate}`;
    const searchQ =
      `'${folderId}' in parents and ` +
      `mimeType='application/vnd.google-apps.document' and ` +
      `name contains ${JSON.stringify(namePrefix)} and trashed=false`;
    const searchUrl =
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(searchQ)}` +
      `&fields=${encodeURIComponent("files(id,name,createdTime)")}` +
      `&orderBy=createdTime desc&pageSize=10`;
    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${gToken}` },
    });
    if (!searchRes.ok) throw new Error(`Drive search failed: ${await searchRes.text()}`);
    const searchJson = await searchRes.json();
    const matches = (searchJson.files || []).filter((f: any) =>
      typeof f.name === "string" && f.name.startsWith(namePrefix),
    );

    let docId: string;
    let docName: string;
    let created = false;

    if (matches.length > 0) {
      docId = matches[0].id;
      docName = matches[0].name;
    } else {
      // Fallback: no pre-created file for today — create one so we don't lose the dump.
      const fallbackName = `[${displayDate}-PWA] Daily Dump`;
      const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
        method: "POST",
        headers: { Authorization: `Bearer ${gToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fallbackName,
          mimeType: "application/vnd.google-apps.document",
          parents: [folderId],
        }),
      });
      if (!createRes.ok) throw new Error(`Drive create failed: ${await createRes.text()}`);
      const docFile = await createRes.json();
      docId = docFile.id;
      docName = fallbackName;
      created = true;
    }

    // Find the current end-of-body index so we can append after existing content.
    const docRes = await fetch(
      `https://docs.googleapis.com/v1/documents/${docId}?fields=body(content(endIndex))`,
      { headers: { Authorization: `Bearer ${gToken}` } },
    );
    if (!docRes.ok) throw new Error(`Docs get failed: ${await docRes.text()}`);
    const docJson = await docRes.json();
    const contentArr = docJson?.body?.content || [];
    const lastEnd = contentArr.length
      ? contentArr[contentArr.length - 1].endIndex
      : 2;
    // Google Docs bodies always end with a trailing newline segment; insert
    // just before it so we don't clobber that required newline.
    const insertIndex = Math.max(1, lastEnd - 1);
    const hasExisting = insertIndex > 1;

    const separator = hasExisting
      ? `\n\n──────────────────────────────\n`
      : "";
    const requests = markdownToDocsRequests(md, separator, insertIndex);
    const updateRes = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${gToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    });
    if (!updateRes.ok) throw new Error(`Docs batchUpdate failed: ${await updateRes.text()}`);

    const webViewLink = `https://docs.google.com/document/d/${docId}/edit`;
    console.log(`[daily-dump-export] Appended to ${docName} (created=${created}) → ${webViewLink}`);

    return new Response(
      JSON.stringify({ ok: true, date: targetDate, docId, docName, appended: !created, webViewLink }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("daily-dump-export error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ---------- Helpers ----------

function truncate(s: string, n: number) {
  if (!s) return s;
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function defaultYesterday(): string {
  // Target the current calendar date in America/Los_Angeles at run time.
  // Cron fires at 05:30 UTC (22:30 PDT / 21:30 PST the prior day), so the PT
  // date at that moment is the day that just finished. Manual runs during the
  // day simply capture "today so far" in PT.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function toDisplayDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

interface AsanaTask {
  gid: string;
  name: string;
  completed: boolean;
  completed_at?: string | null;
  modified_at?: string | null;
  assignee_name?: string | null;
  project_name?: string | null;
  section_name?: string | null;
  parent_name?: string | null;
  due_on?: string | null;
  notes?: string | null;
}

async function fetchAsanaTasks(targetDate: string): Promise<AsanaTask[]> {
  if (!ASANA_ACCESS_TOKEN || !ASANA_WORKSPACE_ID) {
    console.log("[daily-dump-export] Asana not configured; skipping tasks");
    return [];
  }
  try {
    // Search API: tasks modified in the day window
    const dayStart = `${targetDate}T00:00:00Z`;
    const dayEnd = `${targetDate}T23:59:59Z`;
    const url =
      `https://app.asana.com/api/1.0/workspaces/${ASANA_WORKSPACE_ID}/tasks/search` +
      `?modified_at.after=${encodeURIComponent(dayStart)}` +
      `&modified_at.before=${encodeURIComponent(dayEnd)}` +
      `&opt_fields=name,completed,completed_at,modified_at,assignee.name,projects.name,memberships.section.name,parent.name,due_on,notes` +
      `&limit=100`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${ASANA_ACCESS_TOKEN}` },
    });
    if (!res.ok) {
      console.error(`[daily-dump-export] Asana search failed ${res.status}: ${await res.text()}`);
      return [];
    }
    const json = await res.json();
    return (json.data || []).map((t: any) => ({
      gid: t.gid,
      name: t.name,
      completed: !!t.completed,
      completed_at: t.completed_at,
      modified_at: t.modified_at,
      assignee_name: t.assignee?.name || null,
      project_name: t.projects?.[0]?.name || null,
      section_name: t.memberships?.[0]?.section?.name || null,
      parent_name: t.parent?.name || null,
      due_on: t.due_on,
      notes: t.notes ? truncate(t.notes, 300) : null,
    }));
  } catch (e) {
    console.error("[daily-dump-export] Asana fetch error:", e);
    return [];
  }
}

function buildMarkdown(args: {
  displayDate: string;
  byContact: Record<string, ActivityRow[]>;
  contactNames: Record<string, string>;
  asanaTasks: AsanaTask[];
}): string {
  const { displayDate, byContact, contactNames, asanaTasks } = args;
  const lines: string[] = [];
  lines.push(`# [${displayDate}-PWA] Daily Dump`);
  lines.push("");

  // Sort contacts by name; unassigned last
  const keys = Object.keys(byContact).sort((a, b) => {
    if (a === "__unassigned__") return 1;
    if (b === "__unassigned__") return -1;
    return (contactNames[a] || "").localeCompare(contactNames[b] || "");
  });

  if (keys.length === 0) {
    lines.push("_No contact-linked activity for this date._");
    lines.push("");
  } else {
    lines.push("# Activity by Contact");
    lines.push("");
    for (const key of keys) {
      const name = key === "__unassigned__" ? "Unassigned / Internal" : (contactNames[key] || "(Unknown contact)");
      lines.push(`## ${name}`);
      for (const row of byContact[key]) {
        lines.push(`- **${row.label}** — ${row.summary}`);
        if (row.detail) lines.push(`  - ${row.detail}`);
      }
      lines.push("");
    }
  }

  // Tasks section
  lines.push("# Tasks (Asana)");
  lines.push("");
  if (asanaTasks.length === 0) {
    lines.push("_No task activity for this date._");
  } else {
    // Group by project (family)
    const byProject: Record<string, AsanaTask[]> = {};
    for (const t of asanaTasks) {
      const p = t.project_name || "(No project)";
      (byProject[p] ||= []).push(t);
    }
    for (const proj of Object.keys(byProject).sort()) {
      lines.push(`## ${proj}`);
      for (const t of byProject[proj]) {
        const status = t.completed ? "✅ Completed" : "🔄 Updated";
        const parent = t.parent_name ? ` [subtask of: ${t.parent_name}]` : "";
        const section = t.section_name ? ` — ${t.section_name}` : "";
        const assignee = t.assignee_name ? ` — @${t.assignee_name}` : "";
        const due = t.due_on ? ` (due ${t.due_on})` : "";
        lines.push(`- **${status}** ${t.name}${section}${assignee}${due}${parent}`);
        if (t.notes) lines.push(`  - ${t.notes}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Very small markdown -> Google Docs batchUpdate translator.
 * Supports: `# H1`, `## H2`, `- bullet`, `  - nested bullet`, and plain paragraphs.
 * Bold markers (**text**) are stripped in this simple renderer.
 */
function markdownToDocsRequests(md: string, prefix: string, startIndex: number = 1) {
  const requests: any[] = [];
  let index = startIndex;
  const styleOps: any[] = [];

  const pushText = (text: string) => {
    if (!text) return { start: index, end: index };
    requests.push({ insertText: { location: { index }, text } });
    const start = index;
    index += text.length;
    return { start, end: index };
  };

  if (prefix) pushText(prefix);


  const lines = md.split("\n");
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "").replace(/\*\*/g, "");
    if (line.trim() === "") { pushText("\n"); continue; }

    if (line.startsWith("## ")) {
      const r = pushText(line.slice(3) + "\n");
      styleOps.push({
        updateParagraphStyle: {
          range: { startIndex: r.start, endIndex: r.end },
          paragraphStyle: { namedStyleType: "HEADING_2" },
          fields: "namedStyleType",
        },
      });
    } else if (line.startsWith("# ")) {
      const r = pushText(line.slice(2) + "\n");
      styleOps.push({
        updateParagraphStyle: {
          range: { startIndex: r.start, endIndex: r.end },
          paragraphStyle: { namedStyleType: "HEADING_1" },
          fields: "namedStyleType",
        },
      });
    } else if (/^\s*-\s+/.test(line)) {
      const nested = line.startsWith("  ");
      const text = line.replace(/^\s*-\s+/, "") + "\n";
      const r = pushText(text);
      styleOps.push({
        createParagraphBullets: {
          range: { startIndex: r.start, endIndex: r.end },
          bulletPreset: nested ? "BULLET_DIAMONDX_ARROW3D_SQUARE" : "BULLET_DISC_CIRCLE_SQUARE",
        },
      });
    } else {
      pushText(line + "\n");
    }
  }

  return [...requests, ...styleOps];
}
