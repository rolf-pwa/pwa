import type { BriefingSections } from "../../../../supabase/functions/_shared/briefing-facts";

export interface PriorityItem { label: string; reason: string; link: string | null; next_step?: string; key?: string }
export interface DailyBriefing {
  generation_status: "generating" | "complete" | "error";
  generation_error: string | null;
  greeting: string | null;
  summary_line: string | null;
  priority_items: PriorityItem[];
  sections?: BriefingSections | null;
  generated_at?: string | null;
}

const zone = "America/Vancouver";
/** "9:30 a.m." in Pacific time, or "All day". */
export const clock = (iso: string, allDay: boolean) => (allDay ? "All day" : new Date(iso).toLocaleTimeString("en-CA", { timeZone: zone, hour: "numeric", minute: "2-digit" }).replace(" AM", " a.m.").replace(" PM", " p.m.").replace("a.m.", "a.m.").toLowerCase());
/** "Tue, Oct 20". */
export const dayLabel = (isoDate: string) => new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-CA", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
