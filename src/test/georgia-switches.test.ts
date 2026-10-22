import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SWITCHES, isSwitchKey } from "../../supabase/functions/_shared/georgia-switches";

describe("Georgia's on/off switches", () => {
  it("covers the notice processor and calendar invitations, and nothing else can be set", () => {
    expect(SWITCHES.map((s) => s.key)).toEqual(["notice_processor", "calendar_invites"]);
    expect(isSwitchKey("notice_processor")).toBe(true);
    expect(isSwitchKey("anything_else")).toBe(false);
  });
  it("is checked first by both jobs, and can be set from the rulebook", () => {
    expect(readFileSync("supabase/functions/_shared/notice-service.ts", "utf8")).toContain('isOn(db, "notice_processor")');
    expect(readFileSync("supabase/functions/_shared/calendar-service.ts", "utf8")).toContain('isOn(db, "calendar_invites")');
    expect(readFileSync("supabase/functions/daily-briefing-generate/index.ts", "utf8")).toContain('"ea_switch"');
    expect(readFileSync("src/modules/crm/components/GeorgiaRulebook.tsx", "utf8")).toContain("setGeorgiaSwitch(sw.key");
  });
});
