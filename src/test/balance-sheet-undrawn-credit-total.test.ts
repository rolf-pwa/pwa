import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Assets include available credit, so the right-hand total must include the offsetting undrawn-credit line too.
describe("balance sheet total with undrawn credit", () => {
  for (const file of ["src/modules/audit/pages/QuarterlySystemReview.tsx", "src/modules/audit/pages/StabilizationMap.tsx"]) {
    it(`${file} adds undrawn credit into Total Liabilities & Net Worth`, () => {
      const line = readFileSync(file, "utf8").split("\n").find((l) => l.includes('label="Total Liabilities & Net Worth"')) ?? "";
      expect(line).toContain("credit_capacity");
    });
  }
});

describe("quarterly review stores the credit figure", () => {
  it("saves credit_capacity in the stored allocation so the document can show the offset", () => {
    const src = readFileSync("supabase/functions/quarterly-system-review-generate/index.ts", "utf8");
    expect(src).toMatch(/allocation: \{[^}]*credit_capacity: allocation\.creditCapacity/);
  });
});
