import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { addMonthsYmd, breakEvenMonths, buildMigrationFindings, chargebackPct, DEFAULT_FCLASS, FCLASS_LATER_KEY, monthlyOverride, dueRows, monthInForce, monthlyFClassFee, parseCsv, parseDate, parseMoney, parseSheet, type MigrationRow } from "../../supabase/functions/_shared/fclass-migration";

const TODAY = "2026-10-31";
const row = (o: Partial<MigrationRow> = {}): MigrationRow => ({
  account: "1000000001", accountType: "TFSA", owner: "Jordan Rivers-Hale", investedOn: "2021-12-24", original: 7_000, loadType: "CB5",
  maturesOn: "2026-12-24", marketValue: 7_698.76, netTransactions: null, ...o,
});

describe("which month of the deposit's life it is", () => {
  it("is 1 for the first twelve months, then 13 once twelve full months have passed", () => {
    expect(monthInForce("2025-10-31", "2025-10-31")).toBe(1);
    expect(monthInForce("2025-10-31", "2026-10-30")).toBe(12);
    expect(monthInForce("2025-10-31", "2026-10-31")).toBe(13);
    expect(monthInForce("2021-12-24", TODAY)).toBe(59);
  });
  it("copes with short months and a date in the future", () => {
    expect(monthInForce("2024-01-31", "2024-02-29")).toBe(1);
    expect(monthInForce("2027-01-01", TODAY)).toBe(1);
  });
  it("adds months without spilling over the end of a short month", () => {
    expect(addMonthsYmd("2026-10-31", 6)).toBe("2027-04-30");
    expect(addMonthsYmd("2026-08-31", 6)).toBe("2027-02-28");
    expect(addMonthsYmd("2026-10-15", 6)).toBe("2027-04-15");
  });
});

describe("the chargeback percentages in the iA schedule", () => {
  it("CB5 steps down 2 points a month from the 13th to nothing after the 60th", () => {
    for (const [n, pct] of [[1, 100], [12, 100], [13, 98], [24, 76], [36, 52], [59, 6], [60, 4], [61, 0], [90, 0]] as const) expect(chargebackPct("CB5", n), `month ${n}`).toBe(pct);
  });
  it("CB3 steps down 4 points a month to nothing after the 36th", () => {
    for (const [n, pct] of [[12, 100], [13, 96], [24, 52], [32, 20], [36, 4], [37, 0]] as const) expect(chargebackPct("CB3", n), `month ${n}`).toBe(pct);
  });
  it("CB2 uses the published steps and is over after the 24th", () => {
    for (const [n, pct] of [[12, 100], [13, 92.3], [19, 46.1], [22, 23], [24, 7.6], [25, 0]] as const) expect(chargebackPct("CB2", n), `month ${n}`).toBe(pct);
  });
});

describe("the monthly F-class fee", () => {
  it("is the market value times 1%, times the advisor's 80%, over twelve months", () => {
    expect(monthlyFClassFee(7_698.76)).toBe(5.13);
    expect(monthlyFClassFee(120_000)).toBe(80);
    expect(monthlyFClassFee(0)).toBe(0);
  });
  it("follows the configured rate and share", () => {
    expect(monthlyFClassFee(120_000, { windowMonths: 6, feeRate: 0.01, advisorShare: 1 })).toBe(100);
  });
});

describe("overrides on the fees", () => {
  it("are 5% of the 80% of the fee paid to the advisor by default: 0.04% of market value a year", () => {
    expect(DEFAULT_FCLASS.overrideRate).toBe(0.05);
    expect(DEFAULT_FCLASS.overrideBasis).toBe("advisor_fee");
    expect(monthlyOverride(120_000)).toBe(4); // $120,000 x 1% x 80% x 5% / 12
    expect(monthlyOverride(8_091)).toBe(0.27);
  });
  it("can instead be 5% of the whole fee the client pays", () => {
    expect(monthlyOverride(120_000, { ...DEFAULT_FCLASS, overrideBasis: "client_fee" })).toBe(5); // $120,000 x 1% x 5% / 12
  });
  it("are nothing when no override is configured", () => {
    expect(monthlyOverride(120_000, { windowMonths: 12, feeRate: 0.01, advisorShare: 0.8 })).toBe(0);
  });
  it("are added to the household's compensation: fee, override and total, with the total in the title", () => {
    const rows = [
      row({ account: "1000000001", original: 22_500, marketValue: 8_091, netTransactions: -18_584 }),
      row({ account: "1000000002", original: 12_500, marketValue: 7_335, netTransactions: -11_150, investedOn: "2022-01-13", maturesOn: "2027-01-13" }),
    ];
    const f = buildMigrationFindings(rows, new Map([["1000000001", "h1"], ["1000000002", "h1"]]), TODAY).findings[0];
    // Fees $5.39 + $4.89 = $10.28; overrides $0.27 + $0.24 = $0.51; total $10.79 a month.
    expect(f.evidence[1]).toEqual({ label: "Monthly F-class fee (your 80% of 1%)", value: "$10.28" });
    expect(f.evidence[2]).toEqual({ label: "Monthly override on the fees (5% of the fee paid to you)", value: "$0.51" });
    expect(f.evidence[3]).toEqual({ label: "Total monthly compensation (fee plus override)", value: "$10.79" });
    expect(f.title).toContain("$10.79 a month in fees and overrides");
  });
  it("shorten the break-even, which is worked out on the total compensation", () => {
    // $9.40 chargeback: $5.39 fee alone is 1.7 months; with the $0.27 override ($5.66) it is still 1.7. A bigger override moves it: at $0.34 ($5.73) it is 1.6.
    const f = buildMigrationFindings([row({ original: 22_500, marketValue: 8_091, netTransactions: -18_584 })], new Map([["1000000001", "h1"]]), TODAY).findings[0];
    expect(f.evidence[6].value).toContain("covered in 1.7 months");
    expect(f.evidence[4].label).toBe("Months of total compensation to cover the chargeback");
    // Break-even on the total: a $100 chargeback against $50 fees + $10 override is 1.7 months, not 2.
    expect(breakEvenMonths(100, 60)).toBe(1.7);
  });
  it("leave the wording and the numbers as before when there is no override", () => {
    const f = buildMigrationFindings([row()], new Map([["1000000001", "h1"]]), TODAY, { windowMonths: 12, feeRate: 0.01, advisorShare: 0.8 }).findings[0];
    expect(f.title).toContain("$5.13 a month in fees");
    expect(f.title).not.toContain("overrides");
    expect(f.evidence[3].value).toBe("$5.13");
  });
});

describe("break-even", () => {
  it("is the chargeback divided by the monthly fee, to one decimal", () => {
    expect(breakEvenMonths(13.72, 10.28)).toBe(1.3);
    expect(breakEvenMonths(9.4, 5.39)).toBe(1.7);
    expect(breakEvenMonths(0, 5)).toBe(0);
  });
  it("is null when there is no fee to count", () => {
    expect(breakEvenMonths(10, 0)).toBeNull();
  });
});

describe("reading the sheet", () => {
  it("parses quoted fields with commas, doubled quotes and either line ending", () => {
    expect(parseCsv('a,"b,c","d ""q"""\r\n1,2,3\n')).toEqual([["a", "b,c", 'd "q"'], ["1", "2", "3"]]);
  });
  it("reads money and dates as the sheet shows them", () => {
    expect(parseMoney("$27,791.95")).toBe(27791.95);
    expect(parseMoney("CA$1,200.00")).toBe(1200);
    expect(parseMoney("(50.00)")).toBe(-50);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("n/a")).toBeNull();
    expect(parseDate("2023-11-30")).toBe("2023-11-30");
    expect(parseDate("11/3/2023")).toBe("2023-11-03");
    expect(parseDate("")).toBeNull();
    expect(parseDate("soon")).toBeNull();
  });
  const csv = [
    "First Name,Last Name,Account Number,Investment Date,Original Investment,Load Type,Contract Status,CB Maturity Date,Account Type,Managed Investments",
    ",,,,,,,,,\"$4,776,920.94\"",
    'JORDAN,RIVERS-HALE,1000000001,2021-12-24,"$100,000.00",cb5,Family,2026-12-24,TFSA,"$7,698.76"',
    "SAM,RIVERS-HALE,1000000002,2025-02-18,,F Class,Sovereign,2025-02-18,RRSP,\"$23,593.70\"",
  ].join("\n");
  it("finds columns by their header names, so the order does not matter, and skips the totals row", () => {
    const { rows, missingColumns } = parseSheet(csv);
    expect(missingColumns).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ account: "1000000001", loadType: "CB5", original: 100000, maturesOn: "2026-12-24", marketValue: 7698.76, owner: "JORDAN RIVERS-HALE" });
    expect(rows[1].original).toBeNull();
  });
  it("reads the optional Net Transactions column as iA prints it, negative for withdrawals", () => {
    const withNet = "Account Number,Investment Date,Original Investment,Load Type,CB Maturity Date,Managed Investments,Net Transactions\n1,2021-12-24,22500,CB5,2026-12-24,\"$8,091.92\",\"-$18,584.17\"\n2,2021-12-24,5000,CB5,2026-12-24,\"$5,100.00\",";
    const { rows, missingColumns } = parseSheet(withNet);
    expect(missingColumns).toEqual([]);
    expect(rows.map((r) => r.netTransactions)).toEqual([-18584.17, null]);
  });
  it("does not require the Net Transactions column", () => {
    expect(parseSheet("Account Number,Investment Date,Original Investment,Load Type,CB Maturity Date,Managed Investments\n1,2021-12-24,100,CB5,2026-12-24,50").missingColumns).toEqual([]);
  });
  it("names the columns that are missing instead of guessing", () => {
    const r = parseSheet("Account Number,Load Type\n1,CB5");
    expect(r.rows).toEqual([]);
    expect(r.missingColumns).toEqual(expect.arrayContaining(["Original Investment", "CB Maturity Date", "Managed Investments", "Investment Date"]));
  });
});

describe("which accounts are due", () => {
  it("takes chargeback accounts maturing within twelve months, including ones already matured", () => {
    const rows = [
      row({ account: "1", maturesOn: "2026-12-24" }), row({ account: "2", maturesOn: "2027-10-31" }), row({ account: "3", maturesOn: "2027-11-01" }),
      row({ account: "4", maturesOn: "2026-09-01" }), row({ account: "5", maturesOn: "2027-04-30" }),
    ];
    expect(dueRows(rows, TODAY).due.map((r) => r.account)).toEqual(["1", "2", "4", "5"]);
  });
  it("follows the configured window", () => {
    const rows = [row({ account: "in", maturesOn: "2027-04-30" }), row({ account: "out", maturesOn: "2027-05-01" })];
    expect(dueRows(rows, TODAY, { windowMonths: 6, feeRate: 0.01, advisorShare: 0.8 }).due.map((r) => r.account)).toEqual(["in"]);
    expect(dueRows(rows, TODAY, { windowMonths: 12, feeRate: 0.01, advisorShare: 0.8 }).due.map((r) => r.account)).toEqual(["in", "out"]);
  });
  it("is twelve months by default", () => {
    expect(DEFAULT_FCLASS.windowMonths).toBe(12);
  });
  it("leaves out F-class, cash and other loads, empty accounts, and counts accounts with no dates", () => {
    const rows = [row({ account: "f", loadType: "FCLASS" }), row({ account: "h", loadType: "HISA" }), row({ account: "z", marketValue: 0 }), row({ account: "n", marketValue: null }), row({ account: "u", maturesOn: null }), row({ account: "ok" })];
    const r = dueRows(rows, TODAY);
    expect(r.due.map((x) => x.account)).toEqual(["ok"]);
    expect(r.undated).toBe(1);
  });
});

describe("the finding for a household", () => {
  const two = [
    row({ account: "1000000001" }),
    row({ account: "1000000002", loadType: "CB3", investedOn: "2024-03-19", maturesOn: "2027-03-19", original: 50_000, marketValue: 135_991, accountType: "RRIF" }),
  ];
  const map = new Map([["1000000001", "h1"], ["1000000002", "h1"]]);

  it("totals the chargeback if moved today and the monthly fee across the household's accounts", () => {
    const r = buildMigrationFindings(two, map, TODAY);
    expect(r.findings).toHaveLength(1);
    const f = r.findings[0];
    // CB5: $7,000 x 4% x 6% (month 59) = $16.80.  CB3: $50,000 x 2.5% x 20% (month 32) = $250.
    expect(f.evidence[0]).toEqual({ label: "Total chargeback if every account moved today", value: "$266.80" });
    // $7,698.76 -> $5.13 and $135,991 -> $90.66 a month at 80% of 1%.
    expect(f.evidence[1]).toEqual({ label: "Monthly F-class fee (your 80% of 1%)", value: "$95.79" });
    expect(f.title).toBe("2 accounts under chargeback, 2 maturing within 12 months: chargeback $266.80 if all moved today, $100.58 a month in fees and overrides");
    expect(f.type).toBe("fclass_migration");
    expect(f.confidence).toBe("high");
    expect(r.gaps).toEqual([]);
  });
  it("lists each account with its month in force, the share charged and its own figures, soonest maturity first", () => {
    const lines = buildMigrationFindings(two, map, TODAY).findings[0].evidence.slice(6);
    expect(lines[0].label).toBe("TFSA ...0001 (CB5, matures 2026-12-24, within 12 months, month 59, 6% charged)");
    expect(lines[0].value).toBe("chargeback $16.80; fee $5.13/month + override $0.26/month; covered in 3.1 months");
    expect(lines[1].label).toContain("RRIF ...0002 (CB3, matures 2027-03-19, within 12 months, month 32, 20% charged)");
  });
  it("says 'at least' and drops to medium confidence when an original investment is missing, and reports the gap", () => {
    const r = buildMigrationFindings([two[0], { ...two[1], original: null }], map, TODAY);
    expect(r.findings[0].title).toContain("chargeback at least $16.80 if all moved today");
    expect(r.findings[0].confidence).toBe("medium");
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0]).toMatchObject({ householdId: "h1", field: "Original investment (migration sheet)", blocks: ["fclass_migration"] });
  });
  it("does not show a zero chargeback when every original investment is missing", () => {
    const r = buildMigrationFindings(two.map((x) => ({ ...x, original: null })), map, TODAY);
    expect(r.findings[0].title).toContain("chargeback not yet known");
    expect(r.findings[0].evidence[0].value).toBe("Not known: original investment missing");
    expect(r.findings[0].title).not.toContain("$0");
  });
  it("makes one finding per household and lists accounts that match no household by their last digits only", () => {
    const rows = [...two, row({ account: "1000000003" }), row({ account: "9999 8888 7777" })];
    const r = buildMigrationFindings(rows, new Map([["1000000001", "h1"], ["1000000002", "h1"], ["1000000003", "h2"]]), TODAY);
    expect(r.findings.map((f) => f.householdId).sort()).toEqual(["h1", "h2"]);
    expect(r.unmatched).toEqual(["7777"]);
    expect(r.dueCount).toBe(4);
  });
  it("matches account numbers however they are punctuated", () => {
    const r = buildMigrationFindings([row({ account: "1000-000-001" })], new Map([["1000000001", "h1"]]), TODAY);
    expect(r.findings).toHaveLength(1);
  });
  it("tells you when nothing is left to charge back", () => {
    const r = buildMigrationFindings([row({ maturesOn: "2026-09-01", investedOn: "2021-08-01" })], new Map([["1000000001", "h1"]]), TODAY);
    expect(r.findings[0].nextStep).toContain("costs nothing in chargeback");
    expect(r.findings[0].evidence[0].value).toBe("$0.00");
  });
  it("uses iA's net transactions when they are in the sheet: the original less what has been withdrawn since", () => {
    // $22,500 opened, net transactions -$18,584.17: $3,915.83 of the deposit is still exposed. CB5 month 59: 4% x 6% = $9.40.
    const r = buildMigrationFindings([row({ original: 22_500, marketValue: 8_091.92, netTransactions: -18_584.17 })], new Map([["1000000001", "h1"]]), TODAY);
    const f = r.findings[0];
    expect(f.evidence[0].value).toBe("$9.40");
    expect(f.evidence[6].value).toBe("chargeback $9.40 on $3,916 ($18,584 of the $22,500 invested already withdrawn); fee $5.39/month + override $0.27/month; covered in 1.7 months");
    expect(f.confidence).toBe("high");
    expect(r.gaps).toEqual([]);
  });
  it("does not use a positive Net Transactions on an account below its original: it flags the sign and keeps the estimate", () => {
    // Withdrawals typed as +18,584 instead of -18,584: reading it as deposits would charge back on the whole $22,500 ($54.00) at high confidence.
    const r = buildMigrationFindings([row({ original: 22_500, marketValue: 8_091, netTransactions: 18_584 })], new Map([["1000000001", "h1"]]), TODAY);
    const f = r.findings[0];
    expect(f.evidence[0].value).toBe("$19.42");
    expect(f.evidence[6].value).toContain("Net Transactions of +$18,584 was not used");
    expect(f.confidence).toBe("medium");
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0].why).toContain("...0001 (+$18,584)");
    expect(r.gaps[0].why).toContain("Check the sign");
  });
  it("uses a positive Net Transactions when the account is not below its original (more was deposited)", () => {
    const r = buildMigrationFindings([row({ original: 6_000, marketValue: 6_900, netTransactions: 500 })], new Map([["1000000001", "h1"]]), TODAY);
    expect(r.findings[0].evidence[0].value).toBe("$14.40");
    expect(r.findings[0].confidence).toBe("high");
    expect(r.gaps).toEqual([]);
  });
  it("keeps the base within zero and the original", () => {
    const base = (netTransactions: number) => buildMigrationFindings([row({ original: 7_000, netTransactions })], new Map([["1000000001", "h1"]]), TODAY).findings[0].evidence[0].value;
    expect(base(-30_000)).toBe("$0.00"); // more withdrawn than deposited
    expect(base(5_000)).toBe("$16.80"); // later deposits do not raise the base: they have their own chargeback clocks
    expect(base(0)).toBe("$16.80");
  });
  it("without net transactions, estimates from the market value and says so, at medium confidence, and asks for the figure", () => {
    // $22,500 invested, $8,091 left: the shortfall is taken as withdrawn. CB5 month 59: 6% of 4% of $8,091 = $19.42.
    const r = buildMigrationFindings([row({ original: 22_500, marketValue: 8_091 })], new Map([["1000000001", "h1"]]), TODAY);
    const f = r.findings[0];
    expect(f.evidence[0].value).toBe("$19.42");
    expect(f.evidence[6].value).toBe("chargeback $19.42 on $8,091 (estimated: $14,409 of the $22,500 invested assumed withdrawn; add Net Transactions to the sheet for the exact figure); fee $5.39/month + override $0.27/month; covered in 3.4 months");
    expect(f.confidence).toBe("medium");
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0]).toMatchObject({ field: "Net transactions (migration sheet)", blocks: ["fclass_migration"] });
    expect(r.gaps[0].why).toContain("...0001");
  });
  it("is unchanged, and asks for nothing, when the market value is at or above the original investment", () => {
    for (const marketValue of [6_164, 6_000]) {
      const r = buildMigrationFindings([row({ original: 6_000, marketValue })], new Map([["1000000001", "h1"]]), TODAY);
      expect(r.findings[0].evidence[0].value).toBe("$14.40"); // $6,000 x 4% x 6%
      expect(r.findings[0].evidence[6].value).not.toContain("withdrawn");
      expect(r.findings[0].confidence).toBe("high");
      expect(r.gaps).toEqual([]);
    }
  });
  it("shows no withdrawal note when nothing has been withdrawn", () => {
    expect(buildMigrationFindings([row({ netTransactions: 0 })], new Map([["1000000001", "h1"]]), TODAY).findings[0].evidence[6].value).toBe("chargeback $16.80; fee $5.13/month + override $0.26/month; covered in 3.1 months");
  });
  it("shows how many months of F-class fees cover the chargeback, for the household and for each account", () => {
    // The live Banfield rows: $9.40 + $4.32 = $13.72 against $5.39 + $4.89 = $10.28 a month.
    const rows = [
      row({ account: "1000000001", original: 22_500, marketValue: 8_091, netTransactions: -18_584.17 }),
      row({ account: "1000000002", original: 12_500, marketValue: 7_335, netTransactions: -11_150, investedOn: "2022-01-13", maturesOn: "2027-01-13", accountType: "RRSP" }),
    ];
    const f = buildMigrationFindings(rows, new Map([["1000000001", "h1"], ["1000000002", "h1"]]), TODAY).findings[0];
    expect(f.evidence[4]).toEqual({ label: "Months of total compensation to cover the chargeback", value: "1.3 months" });
    expect(f.evidence[6].value).toContain("covered in 1.7 months");
    expect(f.evidence[7].value).toContain("covered in 0.8 months");
  });
  it("says so when there is no chargeback left to cover, and adds no per-account break-even", () => {
    const f = buildMigrationFindings([row({ maturesOn: "2026-09-01", investedOn: "2021-08-01" })], new Map([["1000000001", "h1"]]), TODAY).findings[0];
    expect(f.evidence[4].value).toBe("No chargeback to cover");
    expect(f.evidence[6].value).not.toContain("covered in");
  });
  it("says it cannot be worked out when no original investment is known, and 'at least' when only some are", () => {
    const map = new Map([["1000000001", "h1"], ["1000000002", "h1"]]);
    const none = buildMigrationFindings([row({ original: null }), row({ account: "1000000002", original: null })], map, TODAY).findings[0];
    expect(none.evidence[4].value).toBe("Not known: original investment missing");
    const some = buildMigrationFindings([row(), row({ account: "1000000002", original: null })], map, TODAY).findings[0];
    expect(some.evidence[4].value).toMatch(/^At least \d+(\.\d)? months?$/);
  });
  it("brings in a household when only one of its accounts matures inside the window, and totals all of its chargeback accounts", () => {
    // One account matures in two months; the other (CB5 deposited in 2025) not until 2030. Moving the household moves both.
    const rows = [
      row({ account: "1000000001" }),
      row({ account: "1000000002", investedOn: "2025-05-16", maturesOn: "2030-05-16", original: 6_000, marketValue: 6_164, accountType: "RRSP" }),
    ];
    const r = buildMigrationFindings(rows, new Map([["1000000001", "h1"], ["1000000002", "h1"]]), TODAY);
    expect(r.findings).toHaveLength(1);
    const f = r.findings[0];
    // 2025-05-16 to 2026-10-31 is 17 full months, so month 18: CB5 88% of 4% of $6,000 = $211.20; plus $16.80.
    expect(f.evidence[0].value).toBe("$228.00");
    expect(f.title).toContain("2 accounts under chargeback, 1 maturing within 12 months");
    expect(f.evidence).toHaveLength(8);
    expect(r.dueCount).toBe(1);
    expect(r.includedCount).toBe(2);
  });
  it("tags only the accounts inside the window, and dates the finding by the household's earliest maturity", () => {
    const rows = [
      row({ account: "1000000001", maturesOn: "2026-12-24" }),
      row({ account: "1000000002", investedOn: "2025-05-16", maturesOn: "2030-05-16", original: 6_000, marketValue: 6_164 }),
    ];
    const f = buildMigrationFindings(rows, new Map([["1000000001", "h1"], ["1000000002", "h1"]]), TODAY).findings[0];
    expect(f.evidence[6].label).toContain("within 12 months");
    expect(f.evidence[7].label).not.toContain("within 12 months");
    expect(f.dueOn).toBe("2026-12-24");
  });
  it("puts a household on the later list when none of its accounts matures inside the window", () => {
    const r = buildMigrationFindings([row({ maturesOn: "2030-05-16", investedOn: "2025-05-16" })], new Map([["1000000001", "h1"]]), TODAY);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].key).toBe(FCLASS_LATER_KEY);
    expect(r.findings[0].title).toContain("none maturing within 12 months (the first on 2030-05-16)");
    expect(r.findings[0].dueOn).toBe("2030-05-16");
    expect(r.includedCount).toBe(0);
    expect(r.dueCount).toBe(0);
  });
  it("works the later household's figures the same way: chargeback, fee, override, total and break-even", () => {
    // $35,089 less $2,092 withdrawn = $32,997; CB5 month 46 charges 32%: $32,997 x 4% x 32% = $422.36. Fee $49,404 x 1% x 80% / 12 = $32.94.
    const f = buildMigrationFindings([row({ original: 35_089, netTransactions: -2_092, marketValue: 49_404, investedOn: "2023-01-16", maturesOn: "2028-01-16" })], new Map([["1000000001", "h1"]]), TODAY).findings[0];
    expect(f.evidence[0].value).toBe("$422.36");
    expect(f.evidence[1].value).toBe("$32.94");
    expect(f.evidence[2].value).toBe("$1.65");
    expect(f.evidence[3].value).toBe("$34.59");
    expect(f.evidence[4].value).toBe("12.2 months");
  });
  it("asks for no missing data on a later household, so the live list's requests are not buried", () => {
    const r = buildMigrationFindings([row({ original: null, maturesOn: "2030-05-16", investedOn: "2025-05-16" })], new Map([["1000000001", "h1"]]), TODAY);
    expect(r.findings[0].key).toBe(FCLASS_LATER_KEY);
    expect(r.gaps).toEqual([]);
  });
  it("keeps a household on the live list when only some of its accounts mature later", () => {
    const rows = [row({ account: "1000000001" }), row({ account: "1000000002", investedOn: "2025-05-16", maturesOn: "2030-05-16" })];
    const r = buildMigrationFindings(rows, new Map([["1000000001", "h1"], ["1000000002", "h1"]]), TODAY);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].key).toBe("fclass-migration");
  });
  it("does not count F-class accounts in a household's chargeback, and still lists the household", () => {
    const rows = [row({ account: "1000000001" }), row({ account: "1000000002", loadType: "FCLASS", maturesOn: "2025-02-18" })];
    const r = buildMigrationFindings(rows, new Map([["1000000001", "h1"], ["1000000002", "h1"]]), TODAY);
    expect(r.findings[0].title).toContain("1 account under chargeback");
    expect(r.includedCount).toBe(1);
  });
  it("asks for the original investment on every chargeback account in a listed household, not only those maturing soon", () => {
    const rows = [row({ account: "1000000001" }), row({ account: "1000000002", investedOn: "2025-05-16", maturesOn: "2030-05-16", original: null })];
    const r = buildMigrationFindings(rows, new Map([["1000000001", "h1"], ["1000000002", "h1"]]), TODAY);
    expect(r.gaps.find((g) => g.field === "Original investment (migration sheet)")?.why).toContain("1 account under chargeback has no original investment");
    expect(r.findings[0].title).toContain("chargeback at least $16.80 if all moved today");
  });
  it("reports chargeback accounts that match no household by their last digits, whether or not they mature soon", () => {
    const rows = [row({ account: "1000000001" }), row({ account: "9999 8888 7777", maturesOn: "2030-05-16", investedOn: "2025-05-16" })];
    expect(buildMigrationFindings(rows, new Map([["1000000001", "h1"]]), TODAY).unmatched).toEqual(["7777"]);
  });
  it("never writes an estimated value, so no figure is presented as revenue", () => {
    expect(buildMigrationFindings(two, map, TODAY).findings[0].estValue).toBeNull();
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("the sheet is only read: one export request, no writes", () => {
    const src = read("supabase/functions/_shared/fclass-migration-service.ts");
    expect(src).toContain("/export?");
    expect(src).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)/);
    expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
  it("the pure rule module has no imports besides types, and no network or database access", () => {
    const src = read("supabase/functions/_shared/fclass-migration.ts");
    expect(src.match(/^import .*$/gm)).toEqual(['import type { DataGap, Finding } from "./opportunity-rules.ts";']);
    expect(src).not.toMatch(/fetch\(|\.from\(/);
  });
  it("the weekly run reads the sheet, and leaves these findings alone when it cannot", () => {
    const src = read("supabase/functions/_shared/opportunity-run.ts");
    expect(src).toContain("loadMigrationCsv(db)");
    expect(src).toContain('"fclass_migration"');
    expect(src).toContain("migration,");
  });
  it("the later list stays off the briefing and has its own kind on the page, with the count in the run", () => {
    expect(read("supabase/functions/daily-briefing-generate/index.ts")).toContain('.neq("key", FCLASS_LATER_KEY)');
    expect(read("supabase/functions/_shared/briefing-refresh.ts")).toContain('.neq("key", FCLASS_LATER_KEY)');
    expect(read("supabase/functions/_shared/opportunity-run.ts")).toContain("later: rep.findings.filter");
    expect(read("src/modules/crm/pages/BookOfBusiness.tsx")).toContain(`const LATER_KEY = "${FCLASS_LATER_KEY}"`);
  });
  it("the migration allows the new type and the page labels it", () => {
    expect(read("supabase/migrations/20270109120000_opportunity_fclass_type.sql")).toContain("'fclass_migration'");
    expect(read("src/modules/crm/pages/BookOfBusiness.tsx")).toContain('fclass_migration: "F-class migration"');
  });
});
