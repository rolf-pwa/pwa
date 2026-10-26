import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildContextBlock } from "../../supabase/functions/_shared/ea-agent";

const base = { nowLabel: "Monday 11:40", briefing: "BRIEFING", tasks: [], preferences: [] };

describe("what Georgia sees in a long meeting", () => {
  const src = readFileSync("supabase/functions/_shared/ea-handlers.ts", "utf8");
  it("is given the day's latest messages, not the first ones, so she does not go back to the morning's topics", () => {
    const chat = src.slice(src.indexOf("export async function eaChat"), src.indexOf("export async function eaNudge"));
    expect(chat).toContain('order("created_at", { ascending: false }).limit(HISTORY_TURNS)');
    expect(chat).toContain(".reverse()");
    expect(chat).not.toMatch(/from\("ea_messages"\)\.select\("role, content"\)[^\n]*ascending: true/);
  });
  it("lists what arrived after the briefing was made, separately from the briefing", () => {
    const block = buildContextBlock({ ...base, newSince: ['- Email from Sam: "Contract" [message_id abc]'] });
    expect(block).toContain("NEW SINCE THE BRIEFING WAS MADE");
    expect(block.indexOf("BRIEFING")).toBeLessThan(block.indexOf("NEW SINCE THE BRIEFING"));
    expect(block).toContain("message_id abc");
  });
  it("leaves the section out when nothing is new", () => {
    expect(buildContextBlock({ ...base, newSince: [] })).not.toContain("NEW SINCE THE BRIEFING");
    expect(buildContextBlock(base)).not.toContain("NEW SINCE THE BRIEFING");
  });
  it("is fed by the live mail, texts and requests in the chat action", () => {
    const fn = readFileSync("supabase/functions/daily-briefing-generate/index.ts", "utf8");
    expect(fn).toContain("await newSinceBriefing(db, userId)");
  });
});
