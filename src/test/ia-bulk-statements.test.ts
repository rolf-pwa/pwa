import { describe, expect, it } from "vitest";
import { parseAsAtDate, segmentStatements } from "../modules/crm/lib/iaBulkStatements";

const head = (contract: string, n: number, k: number) =>
  `iAFinancialGroup ${contract}-1072IndividualSavings W79-511111-074Page${k}of${n}`;

describe("parseAsAtDate", () => {
  it("reads the as-at date however the text is spaced", () => {
    expect(parseAsAtDate("YOUR INVESTMENT STATEMENT As at June 30, 2026 This statement")).toBe("2026-06-30");
    expect(parseAsAtDate("YOURINVESTMENTSTATEMENTAsatJune30,2026Thisstatement")).toBe("2026-06-30");
    expect(parseAsAtDate("nothing here")).toBeNull();
  });
});

describe("segmentStatements", () => {
  const pages = [
    `${head("1820293483", 2, 1)} YOURINVESTMENTSTATEMENTAsatJune30,2026 more text here to be long`,
    `${head("1820293483", 2, 2)} TRANSACTIONDETAILS some more text so it is not blank`,
    "   ", // duplex padding
    `${head("1817998174", 1, 1)} YOURINVESTMENTSTATEMENTAsatJune30,2026 more text here to be long`,
    "",
  ];
  it("splits at 'Page 1 of N', drops blank pages, and reads contract + date", () => {
    const s = segmentStatements(pages);
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ contract: "1820293483", statementDate: "2026-06-30", pages: [0, 1], declaredPages: 2, problem: null });
    expect(s[1]).toMatchObject({ contract: "1817998174", pages: [3], problem: null });
  });
  it("flags a statement whose page count does not add up", () => {
    const s = segmentStatements([pages[0]]);
    expect(s[0].problem).toMatch(/expected 2 pages, found 1/);
  });
  it("flags a missing date", () => {
    const s = segmentStatements([`${head("1820293483", 1, 1)} no date here but long enough text`]);
    expect(s[0].problem).toMatch(/date/);
  });
});
