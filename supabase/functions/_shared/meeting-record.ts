// meeting-record.ts: the standard record of a meeting that is filed when its follow-up task is completed. Pure: no network, no Deno.
// Sections (as set with the compliance review): meeting event, date, time, attendees, meeting recap, tasks, comment thread to completion.

import "./bc-time.ts";
export interface RecordPerson { name: string; role: string }
export interface RecordEvent { title: string; start: string | null; end: string | null; attendees: RecordPerson[]; source: "linked" | "matched" }
export interface RecordTask { title: string; owner: string | null; due: string | null; status: string; completedAt: string | null }
export interface RecordComment { at: string; author: string; role: string; body: string; format: "text" | "html" }
export interface RecordInput {
  clientName: string;
  taskTitle: string;
  taskCreatedAt: string;
  taskCompletedAt: string | null;
  event: RecordEvent | null;
  recap: { body: string; format: "text" | "html" } | null;
  tasks: RecordTask[];
  thread: RecordComment[];
  generatedAt: string;
}

export const esc = (s: unknown): string => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const ALLOWED = new Set(["p", "br", "div", "span", "strong", "b", "em", "i", "u", "ul", "ol", "li", "h3", "h4", "a", "blockquote", "table", "thead", "tbody", "tr", "th", "td", "hr"]);

/** Formatted comment HTML reduced to what a record may carry: no scripts, styles, images or attributes (links keep http/https/mailto addresses). */
export function cleanHtmlForDoc(html: string): string {
  return String(html ?? "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|iframe|object|embed|svg|math)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (m, tag: string, attrs: string) => {
      const t = tag.toLowerCase();
      if (!ALLOWED.has(t)) return "";
      if (m.startsWith("</")) return `</${t}>`;
      if (t === "a") {
        const href = /href\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
        const url = (href?.[2] ?? href?.[3] ?? "").trim();
        return /^(https?:|mailto:)/i.test(url) ? `<a href="${esc(url)}">` : "<a>";
      }
      return `<${t}>`;
    });
}

const bodyHtml = (body: string, format: "text" | "html"): string =>
  format === "html" ? cleanHtmlForDoc(body) : `<p>${esc(body).replace(/\r?\n/g, "<br>")}</p>`;

const PT = "America/Vancouver";
export function pacificDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(+d) ? "" : new Intl.DateTimeFormat("en-CA", { timeZone: PT, weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(d);
}
export function pacificTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(+d) ? "" : new Intl.DateTimeFormat("en-CA", { timeZone: PT, hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short" }).format(d).replace(/\./g, "");
}
export const pacificStamp = (iso: string): string => `${pacificDate(iso)}, ${pacificTime(iso)}`;
export const pacificYmd = (iso: string): string => new Intl.DateTimeFormat("en-CA", { timeZone: PT, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

/** The recap is the first comment Rolf (or Georgia) wrote on the task; the thread is everything after it. With no staff comment, the task's description stands in. */
export function splitRecap(comments: RecordComment[], description: string | null): { recap: { body: string; format: "text" | "html" } | null; thread: RecordComment[] } {
  const sorted = [...comments].sort((a, b) => +new Date(a.at) - +new Date(b.at));
  const i = sorted.findIndex((c) => c.role === "Advisor" || c.role === "Georgia");
  if (i >= 0) return { recap: { body: sorted[i].body, format: sorted[i].format }, thread: sorted.filter((_, k) => k !== i) };
  return { recap: description?.trim() ? { body: description, format: "text" } : null, thread: sorted };
}

export function recordTitle(clientName: string, eventTitle: string | null, ymd: string): string {
  return `Meeting Record - ${clientName}${eventTitle ? ` - ${eventTitle}` : ""} - ${ymd}`.replace(/[\\/]/g, "-").slice(0, 180);
}

const STATUS_LABEL: Record<string, string> = { open: "Open", in_progress: "In progress", done: "Completed" };

/** The HTML Drive turns into the Google Doc. Everything that came from a person is escaped or cleaned. */
export function buildMeetingRecordHtml(i: RecordInput): string {
  const ev = i.event;
  const startIso = ev?.start ?? null;
  const when = startIso
    ? `${esc(pacificTime(startIso))}${ev?.end ? ` to ${esc(pacificTime(ev.end))}` : ""}`
    : "To be confirmed";
  const attendees = ev?.attendees.length
    ? `<ul>${ev.attendees.map((p) => `<li>${esc(p.name)} (${esc(p.role)})</li>`).join("")}</ul>`
    : "<p>To be confirmed</p>";
  const tasks = i.tasks.length
    ? `<table border="1" cellpadding="4"><tr><th>Task</th><th>Owner</th><th>Due</th><th>Status</th><th>Completed</th></tr>${i.tasks
        .map((t) => `<tr><td>${esc(t.title)}</td><td>${esc(t.owner ?? "Not assigned")}</td><td>${esc(t.due ?? "")}</td><td>${esc(STATUS_LABEL[t.status] ?? t.status)}</td><td>${esc(t.completedAt ? pacificDate(t.completedAt) : "")}</td></tr>`)
        .join("")}</table>`
    : "<p>No tasks were recorded.</p>";
  const thread = i.thread.length
    ? i.thread.map((c) => (c.role === "System"
        ? `<p><i>${esc(pacificStamp(c.at))}: ${esc(c.body)}</i></p>`
        : `<p><b>${esc(pacificStamp(c.at))}, ${esc(c.author)} (${esc(c.role)})</b></p>${bodyHtml(c.body, c.format)}`)).join("")
    : "<p>No comments after the recap.</p>";
  const note = !ev
    ? "<p><i>The calendar event for this meeting could not be identified.</i></p>"
    : ev.source === "matched"
      ? "<p><i>The calendar event was matched automatically from the advisor's calendar.</i></p>"
      : "";
  return `<html><body>
<h1>Meeting Record</h1>
<p><b>Client:</b> ${esc(i.clientName)}</p>
<h2>Meeting event</h2><p>${esc(ev?.title ?? "To be confirmed")}</p>${note}
<h2>Date</h2><p>${esc(startIso ? pacificDate(startIso) : "To be confirmed")}</p>
<h2>Time</h2><p>${when}</p>
<h2>Attendees</h2>${attendees}
<h2>Meeting recap</h2>${i.recap ? bodyHtml(i.recap.body, i.recap.format) : "<p>No recap was recorded.</p>"}
<h2>Tasks</h2>${tasks}
<h2>Comment thread to completion</h2>${thread}
<hr>
<p><i>Follow-up: ${esc(i.taskTitle)}. Opened ${esc(pacificDate(i.taskCreatedAt))}${i.taskCompletedAt ? `, completed ${esc(pacificDate(i.taskCompletedAt))}` : ""}. Filed by Georgia on ${esc(pacificDate(i.generatedAt))}.</i></p>
</body></html>`;
}
