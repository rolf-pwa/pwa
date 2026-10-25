import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("src/modules/crm/pages/Inbox.tsx", "utf8");

describe("the Inbox on a phone", () => {
  it("scrolls its seven tabs sideways instead of running off the page", () => {
    expect(src).toMatch(/data-testid="inbox-tabs"/);
    expect(src).toMatch(/<TabsList className="[^"]*overflow-x-auto[^"]*"/);
  });
  it("wraps the header and drops the subtitle on a small screen", () => {
    expect(src).toMatch(/data-testid="inbox-header"/);
    expect(src).toMatch(/flex flex-wrap items-center justify-between gap-3/);
    expect(src).toContain("hidden text-sm text-muted-foreground sm:block");
  });
});
