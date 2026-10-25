// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PUSH_CATEGORIES, breaksQuietHours, categoryForSource, isQuietHour, safePath, shouldBuzz, staffPayload, textPayload } from "../../supabase/functions/_shared/push-rules";

const lib = vi.hoisted(() => ({
  pushSupported: vi.fn(() => true), currentSubscription: vi.fn(async () => null as any), enablePush: vi.fn(), disablePush: vi.fn(async () => undefined),
  loadPushPrefs: vi.fn(async () => null as any), savePushPrefs: vi.fn(async () => ({ ok: true })), sendPushTest: vi.fn(async () => ({ sent: 1 })),
  PUSH_CATEGORIES: [{ id: "texts", label: "Texts", hint: "" }, { id: "calls", label: "Voicemails", hint: "" }],
}));
vi.mock("@/shared/lib/push", () => lib);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { PushSettings } from "@/modules/crm/components/PushSettings";

const at = (iso: string) => new Date(iso);
const ALL = { categories: [...PUSH_CATEGORIES], quiet: true };

describe("what buzzes", () => {
  it("buzzes for texts, voicemails, requests, signed documents and failures, and nothing else", () => {
    for (const [src, cat] of [["urgent_text", "texts"], ["voicemail", "calls"], ["new_request", "requests"], ["request_message", "requests"], ["ask_georgia_flag", "requests"], ["task_client_reply", "requests"], ["insurance_document", "documents"], ["system_error", "alerts"]]) expect(categoryForSource(src), src).toBe(cat);
    for (const src of ["voicemail_transcript", "monthly_import", "system_health", "georgia_task", "drive_watch", "retention_review"]) expect(categoryForSource(src), src).toBeNull();
  });
  it("keeps quiet 9pm to 7am Pacific, except for urgent texts and failures", () => {
    expect(isQuietHour(at("2026-10-25T05:00:00Z"))).toBe(true);   // 10pm PDT
    expect(isQuietHour(at("2026-10-25T13:00:00Z"))).toBe(true);   // 6am PDT
    expect(isQuietHour(at("2026-10-25T14:00:00Z"))).toBe(false);  // 7am PDT
    expect(isQuietHour(at("2026-10-26T03:59:00Z"))).toBe(false);  // 8:59pm PDT
    expect(isQuietHour(at("2026-10-26T04:00:00Z"))).toBe(true);   // 9pm PDT
    const night = at("2026-10-25T08:00:00Z");
    expect(shouldBuzz("calls", "voicemail", ALL, night)).toBe(false);
    expect(shouldBuzz("texts", "text", ALL, night)).toBe(false);
    expect(shouldBuzz("texts", "urgent_text", ALL, night)).toBe(true);
    expect(shouldBuzz("alerts", "system_error", ALL, night)).toBe(true);
    expect(shouldBuzz("calls", "voicemail", { ...ALL, quiet: false }, night)).toBe(true);
    expect(breaksQuietHours("voicemail")).toBe(false);
  });
  it("respects the kinds a device has turned off", () => {
    expect(shouldBuzz("calls", "voicemail", { categories: ["texts"], quiet: false }, at("2026-10-25T20:00:00Z"))).toBe(false);
    expect(shouldBuzz("texts", "text", { categories: ["texts"], quiet: false }, at("2026-10-25T20:00:00Z"))).toBe(true);
  });
  it("puts who it is from on the lock screen, never what they said, and only opens pages inside the app", () => {
    const p = staffPayload({ id: "n1", title: "Voicemail from Sam Smith", link: "/contacts/c1", contact_id: "c1", source_type: "voicemail" });
    expect(p).toEqual({ title: "Voicemail from Sam Smith", body: "Tap to open", url: "/contacts/c1", tag: "voicemail-c1" });
    expect(textPayload({ id: "m1", contact_id: "c1" }, "Sam Smith")).toMatchObject({ title: "Text from Sam Smith", url: "/contacts/c1", tag: "text-c1" });
    expect(textPayload({ id: "m2" }, null)).toMatchObject({ title: "New text message", url: "/briefing?tab=messages" });
    expect(safePath("https://evil.example")).toBeNull();
    expect(safePath("//evil.example")).toBeNull();
    expect(staffPayload({ id: "n", title: "x", link: "https://evil.example", source_type: "new_request" }).url).toBe("/briefing");
  });
});

describe("the wiring", () => {
  it("has the database trigger fire for the same notification kinds the rules buzz for", () => {
    const sql = readFileSync("supabase/migrations/20270104120000_push_notifications.sql", "utf8");
    const listed = (sql.match(/source_type IN \(([^)]*)\)/)?.[1] ?? "").match(/'([a-z_]+)'/g)!.map((s) => s.replace(/'/g, "")).sort();
    const rules = readFileSync("supabase/functions/_shared/push-rules.ts", "utf8");
    const mapped = [...rules.slice(rules.indexOf("SOURCE_CATEGORY"), rules.indexOf("};", rules.indexOf("SOURCE_CATEGORY"))).matchAll(/^\s+([a-z_]+):/gm)].map((m) => m[1]).sort();
    expect(listed).toEqual(mapped);
    expect(sql).toContain("GRANT ALL ON public.push_subscriptions TO service_role");
    expect(sql).toContain("direction = 'inbound' AND NEW.occurred_at > now()");
  });
  it("serves the worker uncached and routes the push actions in the briefing function", () => {
    expect(readFileSync("firebase.json", "utf8")).toMatch(/"source": "\/sw\.js"[\s\S]{0,80}no-cache/);
    const sw = readFileSync("public/sw.js", "utf8");
    expect(sw).toContain('addEventListener("push"');
    expect(sw).toContain('addEventListener("notificationclick"');
    const fn = readFileSync("supabase/functions/daily-briefing-generate/index.ts", "utf8");
    for (const a of ["ea_push_key", "ea_push_subscribe", "ea_push_unsubscribe", "ea_push_prefs", "ea_push_test"]) expect(fn).toContain(`"${a}"`);
    expect(fn).toContain('cronBody.job === "push_notify"');
  });
});

describe("the notification settings on the phone", () => {
  beforeEach(() => { vi.clearAllMocks(); lib.pushSupported.mockReturnValue(true); lib.currentSubscription.mockResolvedValue(null); lib.loadPushPrefs.mockResolvedValue(null); });
  it("explains the home screen when this phone cannot do notifications yet", async () => {
    lib.pushSupported.mockReturnValue(false);
    render(<PushSettings />);
    expect(screen.getByTestId("push-settings").textContent).toContain("home screen");
    expect(screen.queryByRole("button", { name: "Turn on" })).toBeNull();
  });
  it("turns them on, then shows what buzzes, with quiet hours, a test and off", async () => {
    const sub = { endpoint: "https://push.example/1" };
    lib.enablePush.mockResolvedValue(sub);
    lib.currentSubscription.mockResolvedValueOnce(null).mockResolvedValue(sub as any);
    lib.loadPushPrefs.mockResolvedValue({ categories: ["texts"], quiet: true });
    render(<PushSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Turn on" }));
    expect(await screen.findByRole("switch", { name: "Quiet hours" })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("switch", { name: "Voicemails" }).getAttribute("aria-checked")).toBe("false"));
    expect(screen.getByRole("switch", { name: "Texts" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("switch", { name: "Voicemails" }));
    expect(lib.savePushPrefs).toHaveBeenCalledWith(sub.endpoint, { categories: ["texts", "calls"] });
    fireEvent.click(screen.getByRole("switch", { name: "Quiet hours" }));
    expect(lib.savePushPrefs).toHaveBeenCalledWith(sub.endpoint, { quiet: false });
    fireEvent.click(screen.getByRole("button", { name: "Send a test" }));
    await waitFor(() => expect(lib.sendPushTest).toHaveBeenCalledWith(sub.endpoint));
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(lib.disablePush).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: "Turn on" })).toBeTruthy();
  });
});
