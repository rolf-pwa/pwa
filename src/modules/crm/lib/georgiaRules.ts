import { supabase } from "@/shared/integrations/supabase/client";

const URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/daily-briefing-generate`;

export interface Rule { id: string; kind: "mute_sender" | "note"; value: string; source: "asked" | "learned"; area: string | null; created_at: string }
export interface Suggestion { id: string; rule: string; area: string | null; evidence: string; times: number; created_at: string }
export interface Activity { id: string; kind: string; summary: string; at: string; undone: boolean; canUndo: boolean }
export interface Rulebook { rules: Rule[]; suggestions: Suggestion[]; activity: Activity[] }

async function call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data: sess } = await supabase.auth.getSession();
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token ?? ""}`, "x-region": "ca-central-1" },
    body: JSON.stringify({ action, ...payload }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}

export const getRulebook = () => call<Rulebook>("ea_rules");
export const addRule = (value: string) => call<{ ok: true }>("ea_rule_add", { value });
export const forgetRule = (prefId: string) => call<{ ok: true }>("ea_forget", { prefId });
export const decideSuggestion = (id: string, decision: "accept" | "dismiss") => call<{ ok: true }>("ea_suggestion", { id, decision });
export const undoActivity = (actionId: string) => call<{ ok: true }>("ea_undo", { actionId });
export const scanForRules = () => call<{ ok: true; added: number }>("ea_rules_scan");

/** What Georgia does by built-in design, not by a rule Rolf set. Shown so nothing she does on her own is hidden. */
export const BUILT_IN_RULES: { area: string; text: string }[] = [
  { area: "Notices", text: "iA and Adobe Sign notices are handled every 30 minutes. She comments on the client's matching task (the client sees it if the task is shared), closes it only when the notice clearly completes the work, and never closes money tasks, repeating tasks or tasks with open subtasks. Anything uncertain or reporting a problem is left for you." },
  { area: "Texts", text: "When you are in a meeting, away, after hours or on a weekend, she answers a client's text once as Georgia, your assistant. She gives no account details, alerts you in the app for urgent matters, and holds off for two hours after you reply yourself." },
  { area: "Email", text: "Mail she handles or goes through with you is marked read, labelled Georgia/Handled and taken out of the Inbox. Nothing is deleted. Starred mail is left alone." },
  { area: "Always", text: "She never sends email, never moves money, never deletes, and never contacts a client outside the portal and the text rule above." },
];
