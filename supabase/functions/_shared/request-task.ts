// request-task.ts: what happens when a client submits a request through Ask Georgia (portal or VFO). Pure.
// The request is acknowledged and closed; anything further continues in a client-visible task assigned to Rolf.

import { pacificParts, type Availability } from "./support-context.ts";

export const REQUEST_TASK_TITLE: Record<string, string> = {
  banking_withdrawal: "Banking and withdrawal request",
  personal_info: "Personal information update",
  document_request: "Document request",
  data_access: "Personal information access request",
  general_inquiry: "General inquiry",
};

export const requestTaskTitle = (type: string): string => REQUEST_TASK_TITLE[type] ?? "Request";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dayName = (ymd: string): string => DAYS[new Date(`${ymd}T12:00:00Z`).getUTCDay()];

/** What Georgia says when she has logged the request: what happens now, when Rolf is back if he is away, and where it continues. */
export function requestAcknowledgement(o: { firstName: string | null; type: string; availability: Availability }): string {
  const label = (REQUEST_TASK_TITLE[o.type] ?? "request").toLowerCase();
  const hi = o.firstName ? `Thanks, ${o.firstName}. ` : "Thanks. ";
  const away = o.availability.away && o.availability.backOn ? ` Rolf is out of the office and back on ${dayName(o.availability.backOn)}, so he will see it then.` : "";
  return `${hi}I have received your ${label} and logged it as a task in your portal, where Rolf will pick it up.${away} This request is now closed here. If anything further is required, we will do it through that task.`;
}

/** Two business days after the later of today and the day Rolf is back; weekends are skipped. */
export function requestDueDate(todayYmd: string, backOnYmd: string | null): string {
  let d = new Date(`${backOnYmd && backOnYmd > todayYmd ? backOnYmd : todayYmd}T12:00:00Z`);
  let left = 2;
  while (left > 0) {
    d = new Date(d.getTime() + 86_400_000);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

export const todayPacific = (now: Date): string => pacificParts(now).date;
