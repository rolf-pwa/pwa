import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { splitLinks, LinkifyText } from "@/shared/components/LinkifyText";
import { PortalPortfolioReview } from "@/modules/portal/components/PortalPortfolioReview";

describe("links in text", () => {
  it("finds every address, even when stuck to a word, and leaves sentence punctuation out of it", () => {
    expect(splitLinks("see https://a.ca/x. Then https://b.ca, or (https://c.ca/y)")).toEqual([
      { text: "see " }, { text: "https://a.ca/x", href: "https://a.ca/x" }, { text: ". Then " },
      { text: "https://b.ca", href: "https://b.ca" }, { text: ", or (" }, { text: "https://c.ca/y", href: "https://c.ca/y" }, { text: ")" },
    ]);
    expect(splitLinks("Ihttps://www.prosperwise.ca/sovereignty-audit")[1]).toEqual({ text: "https://www.prosperwise.ca/sovereignty-audit", href: "https://www.prosperwise.ca/sovereignty-audit" });
  });
  it("only ever links http and https, never script addresses", () => {
    expect(splitLinks("javascript:alert(1) and data:text/html,x").every((p) => !p.href)).toBe(true);
  });
  it("renders each address as a link that opens in a new tab, including the second one", () => {
    render(<p><LinkifyText text="one https://a.ca and two https://b.ca" /></p>);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["https://a.ca", "https://b.ca"]);
    expect(links[0].getAttribute("target")).toBe("_blank");
    expect(links[0].getAttribute("rel")).toContain("noopener");
  });
  it("makes the link in an advisor's note on the client page clickable", () => {
    const view: any = { kind: "rebalance", householdLabel: "Smith", valuesAsOf: "2026-09-30", note: "Book here: https://www.prosperwise.ca/sovereignty-audit", summary: { value: 1, changeYtd: null, ytdPct: null }, accounts: [], history: [], funds: { modelLabel: "Balanced", rows: [], offModelPct: 0, commentary: ["See https://www.prosperwise.ca/model for the model."] }, disclosures: [] };
    render(<PortalPortfolioReview view={view} preview />);
    expect(screen.getByRole("link", { name: "https://www.prosperwise.ca/sovereignty-audit" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "https://www.prosperwise.ca/model" })).toBeTruthy(); // and in the commentary boxes
  });
});
