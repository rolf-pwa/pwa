// georgia-switches.ts: on/off switches for the work Georgia does on her own between meetings. Off means the job still runs but does nothing.

// deno-lint-ignore-file no-explicit-any
export const SWITCHES = [
  { key: "notice_processor", label: "Handle iA and Adobe Sign notices on her own", detail: "Comments on the client's task, closes it only when the notice completes it, files the mail." },
  { key: "calendar_invites", label: "Accept webinar and training invitations on her own", detail: "Clear webinars that fit and do not clash. She never declines on her own." },
] as const;
export type SwitchKey = (typeof SWITCHES)[number]["key"];
export const isSwitchKey = (k: unknown): k is SwitchKey => SWITCHES.some((s) => s.key === k);

/** A switch is on unless its row says otherwise. */
export async function isOn(db: any, key: SwitchKey): Promise<boolean> {
  const { data } = await db.from("georgia_switches").select("enabled").eq("key", key).maybeSingle();
  return data?.enabled !== false;
}
export async function switchStates(db: any): Promise<{ key: string; label: string; detail: string; enabled: boolean }[]> {
  const { data } = await db.from("georgia_switches").select("key, enabled");
  const map = new Map(((data ?? []) as any[]).map((r) => [r.key, r.enabled !== false]));
  return SWITCHES.map((s) => ({ key: s.key, label: s.label, detail: s.detail, enabled: map.get(s.key) ?? true }));
}
export async function setSwitch(db: any, key: unknown, enabled: unknown) {
  if (!isSwitchKey(key)) return { error: "Unknown switch." };
  await db.from("georgia_switches").upsert({ key, enabled: enabled === true, updated_at: new Date().toISOString() }, { onConflict: "key" });
  return { ok: true };
}
