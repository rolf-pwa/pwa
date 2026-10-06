// Splits iA Financial's bulk "Investment Statements" download (one big PDF, many contracts) into one
// segment per statement. Pure: works on the text of each page, so it is easy to test. Page text is
// compared with all whitespace removed because PDF text extraction spaces words unpredictably.

export interface StatementSegment {
  contract: string;          // 10-digit contract number
  statementDate: string;     // ISO date the statement is "as at"
  pages: number[];           // 0-based page indexes to keep (blank padding pages dropped)
  declaredPages: number;     // "Page 1 of N" on the first page
  problem: string | null;    // set when the page count doesn't add up
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const squash = (s: string) => s.replace(/\s+/g, "");

export function parseAsAtDate(pageText: string): string | null {
  const m = squash(pageText).match(/Asat([A-Za-z]+)(\d{1,2}),(\d{4})/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month < 0) return null;
  return `${m[3]}-${String(month + 1).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`;
}

export function segmentStatements(pageTexts: string[]): StatementSegment[] {
  const segments: StatementSegment[] = [];
  let cur: StatementSegment | null = null;
  pageTexts.forEach((raw, i) => {
    const t = squash(raw);
    const first = t.match(/Page1of(\d+)/);
    const contract = t.match(/(\d{10})-\d{4}/);
    if (first && contract) {
      cur = {
        contract: contract[1], statementDate: parseAsAtDate(raw) ?? "", pages: [i],
        declaredPages: Number(first[1]), problem: null,
      };
      segments.push(cur);
    } else if (cur && t.length >= 20) {
      cur.pages.push(i);
    }
    // blank pages (duplex padding) and anything before the first statement are dropped
  });
  for (const s of segments) {
    if (!s.statementDate) s.problem = "statement date not found";
    else if (s.pages.length !== s.declaredPages) s.problem = `expected ${s.declaredPages} pages, found ${s.pages.length}`;
  }
  return segments;
}
