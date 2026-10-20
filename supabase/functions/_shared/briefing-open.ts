// briefing-open.ts: is a briefing item still open? Each priority and list item carries a key naming the thing it is about (a task, a request, an
// email, a notification). Once Rolf has dealt with it, it drops off the briefing and moves to "handled". Pure: the current state is passed in.
//
// Keys: task:overdue:<id>  task:today:<id>  task:upcoming:<id>  request:<id>  email:<id>  quo:msg:<id>  quo:call:<id>
//       esc:<id>  import:<id>  scans  sweep  note:<id>  conflict:<a>|<b>

export interface OpenState {
  today: string;
  tasks: Map<string, { status: string; due: string | null }>;
  requests: Map<string, { status: string; awaitingStaff: boolean }>;
  /** Null when Gmail could not be read: email items then stay, rather than vanishing on a failed check. */
  emails: Map<string, { inInbox: boolean; lastFromMe: boolean }> | null;
  quo: Map<string, { read: boolean }>;
  escalations: Map<string, { status: string }>;
  imports: Map<string, { status: string }>;
  pendingScans: number;
  /** Sweep sorts from the last day still to rate, or rated right as Would archive but not yet archived (Clients mail needs nothing). Undefined: not known, so the item stays. */
  sweepPending?: number;
  notes: Map<string, { read: boolean }>;
}

export interface OpenResult { open: boolean; label?: string }

export function isStillOpen(key: string | undefined | null, s: OpenState, within = 7): OpenResult {
  if (!key) return { open: true };
  const [kind, a, b] = key.split(":");
  const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  switch (kind) {
    case "task": {
      const t = s.tasks.get(b);
      if (!t || t.status === "done") return { open: false };
      // Overdue stays only while still past due; due today only while due today; upcoming only while still due in the next week.
      if (a === "overdue") return { open: !!t.due && t.due < s.today };
      if (a === "today") return { open: t.due === s.today };
      return { open: !!t.due && t.due >= s.today && t.due <= addDays(s.today, within) };
    }
    case "request": { const r = s.requests.get(a); return { open: !!r && r.status !== "resolved" && r.awaitingStaff }; }
    case "email": {
      if (!s.emails) return { open: true };
      const e = s.emails.get(a);
      return { open: !e ? true : e.inInbox && !e.lastFromMe };
    }
    case "quo": { const q = s.quo.get(`${a}:${b}`); return { open: !q ? true : !q.read }; }
    case "esc": { const e = s.escalations.get(a); return { open: !!e && e.status === "escalated" }; }
    case "import": { const i = s.imports.get(a); return { open: !!i && (i.status === "ready" || i.status === "held") }; }
    case "scans": return s.pendingScans > 0 ? { open: true, label: `${s.pendingScans} scanned document${s.pendingScans === 1 ? "" : "s"} waiting for approval` } : { open: false };
    case "sweep": return { open: s.sweepPending === undefined || s.sweepPending > 0 };
    case "note": { const n = s.notes.get(a); return { open: !!n && !n.read }; }
    default: return { open: true };
  }
}

/** Splits items into those still open and those handled, relabelling where the label carries a count. */
export function applyOpen<T extends { key?: string }>(items: T[], s: OpenState): { open: T[]; handled: T[] } {
  const open: T[] = [], handled: T[] = [];
  for (const it of items) {
    const r = isStillOpen(it.key, s);
    // A count in a label (such as "4 scanned documents") is kept current on the item that has a label.
    if (r.open) open.push(r.label && "label" in it ? { ...it, label: r.label } : it); else handled.push(it);
  }
  return { open, handled };
}

/** Sorts still to deal with: not yet rated, or Would archive and rated right but still in the Inbox. Mail from clients is shown, never sorted by hand. */
export function sweepPending(rows: { bucket: string; feedback: string | null; archived_at: string | null }[]): number {
  return rows.filter((r) => r.bucket !== "client" && !r.archived_at && (r.feedback === null || (r.bucket === "archivable" && r.feedback === "right"))).length;
}
