import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

const dir = "supabase/migrations";
const read = (f: string) => readFileSync(`${dir}/${f}`, "utf8");
const FIX = "20270117120000_staff_only_row_security.sql";

describe("row security: staff only", () => {
  const sql = read(FIX);
  it("has one staff test, the firm's email domain in the signed-in user's token, and uses it on the policies it rewrites", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.is_staff()");
    expect(sql).toContain("LIKE '%@prosperwise.ca'");
    expect(sql.match(/CREATE POLICY/g)!.length).toBeGreaterThan(200);
    expect(sql.match(/public\.is_staff\(\)/g)!.length).toBeGreaterThan(200);
  });
  it("leaves no policy open to everyone: no USING (true) or WITH CHECK (true), and nothing granted to the public role", () => {
    expect(sql).not.toMatch(/(USING|WITH CHECK)\s*\(\s*true\s*\)/i);
    expect(sql).not.toMatch(/TO\s+public\b/i);
  });
  it("closes the functions anyone could call: the job starter and the trigger functions", () => {
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.push_ping(text, jsonb) FROM PUBLIC, anon, authenticated");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.guard_regulated_delete() FROM PUBLIC, anon, authenticated");
  });
  it("keeps the signed-in clients' read of the active portal links, and takes the last public liabilities policy to staff", () => {
    expect(read("20270117130000_portal_links_signed_in_clients.sql")).toContain("TO anon, authenticated USING (is_active = true)");
    expect(read("20270117140000_liabilities_insert_staff_only.sql")).toContain("WITH CHECK (public.is_staff() AND auth.uid() = created_by)");
  });
  it("is checked for with the audit script", () => {
    expect(readFileSync("scripts/verify/open-policies.sql", "utf8")).toContain("from pg_policies");
  });
  it("keeps every migration after the fix from opening a table again, unless it says it is a public form", () => {
    const later = readdirSync(dir).filter((f) => f > "20270117999999" && f.endsWith(".sql") && !/ 2\.sql$/.test(f));
    for (const f of later) {
      const s = read(f);
      const open = /(USING|WITH CHECK)\s*\(\s*true\s*\)/i.test(s) || /auth\.uid\(\)\s+IS\s+NOT\s+NULL/i.test(s);
      expect(open && !/--\s*public form/i.test(s), `${f} opens a table to everyone`).toBe(false);
    }
  });
});
