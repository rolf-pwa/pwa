import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DOC_ITEMS as CLIENT_ITEMS } from "@/shared/lib/insuranceDocuments";
import { CASL_MARKER } from "../../supabase/functions/_shared/insurance-doc-rules";
import { DOC_ITEMS, clientGet, clientPending, clientSign } from "../../supabase/functions/_shared/insurance-doc-client";

// A tiny in-memory stand-in for the Supabase client: eq/neq/in filters, select, insert, update, maybeSingle.
function fakeDb(seed: Record<string, any[]>) {
  const tables: Record<string, any[]> = JSON.parse(JSON.stringify(seed));
  const from = (t: string) => {
    tables[t] ??= [];
    let rows = tables[t]; let op: "select" | "update" | "insert" = "select"; let patch: any = null; const filters: ((r: any) => boolean)[] = [];
    const run = () => rows.filter((r) => filters.every((f) => f(r)));
    const q: any = {
      select: () => q, order: () => q, limit: () => q,
      eq: (k: string, v: any) => { filters.push((r) => r[k] === v); return q; },
      neq: (k: string, v: any) => { filters.push((r) => r[k] !== v); return q; },
      in: (k: string, v: any[]) => { filters.push((r) => v.includes(r[k])); return q; },
      update: (p: any) => { op = "update"; patch = p; return q; },
      insert: (p: any) => { const list = Array.isArray(p) ? p : [p]; list.forEach((x) => rows.push({ id: crypto.randomUUID(), ...x })); return Promise.resolve({ data: null, error: null }); },
      maybeSingle: () => Promise.resolve({ data: run()[0] ?? null }),
      then: (res: any) => { if (op === "update") { const hit = run(); hit.forEach((r) => Object.assign(r, patch)); return Promise.resolve({ data: hit.map((r) => ({ id: r.id })) }).then(res); } return Promise.resolve({ data: run() }).then(res); },
    };
    return q;
  };
  return { db: { from }, tables };
}

const BODY = `**ADVISOR DISCLOSURE**\n\nI, Thomas Wolfe and Sarah Wolfe have been informed.\n\n${CASL_MARKER}\n\nMore text.`;
const seed = () => ({
  insurance_documents: [{ id: "d1", household_id: "h1", status: "sent", title: "Advisor Disclosure and Privacy Consent", body_md: BODY, body_hash: "abc", sent_at: "2026-10-22T00:00:00Z", kind: "disclosure_privacy", task_id: null, file_id: null }],
  insurance_document_signers: [{ id: "s1", document_id: "d1", contact_id: "c1", name: "Thomas Wolfe", status: "pending" }, { id: "s2", document_id: "d1", contact_id: "c2", name: "Sarah Wolfe", status: "pending" }],
  contacts: [{ id: "c1", email: "t@x.ca" }, { id: "c2", email: "s@x.ca" }],
  households: [{ id: "h1", label: "Wolfe", vault_folder_id: null }],
  staff_notifications: [],
});
const good = { typedName: "Thomas Wolfe", agree: true, caslChoice: "yes", caslInitials: "tw", caslEmail: "t@x.ca" };

describe("signing in the portal", () => {
  it("lists a document only for the people who must sign it", async () => {
    const { db } = fakeDb(seed());
    expect(await clientPending(db, "c1")).toHaveLength(1);
    expect(await clientPending(db, "someone-else")).toHaveLength(0);
    expect(await clientGet(db, "someone-else", "d1")).toEqual({ error: "Not available" });
  });
  it("splits the wording around the CASL choice", async () => {
    const { db } = fakeDb(seed());
    const g: any = await clientGet(db, "c1", "d1");
    expect(g.needsCasl).toBe(true);
    expect(g.before).toContain("ADVISOR DISCLOSURE");
    expect(g.after).toContain("More text");
    expect(g.email).toBe("t@x.ca");
  });
  it("rejects a wrong name and records nothing", async () => {
    const { db, tables } = fakeDb(seed());
    const r: any = await clientSign(db, "c1", "d1", { ...good, typedName: "Sarah Wolfe" }, "1.1.1.1", "UA");
    expect(r.error).toMatch(/full name/);
    expect(tables.insurance_document_signers[0].status).toBe("pending");
  });
  it("records the signature with where it came from, and is partly signed until everyone has", async () => {
    const { db, tables } = fakeDb(seed());
    const r: any = await clientSign(db, "c1", "d1", good, "1.1.1.1", "UA");
    expect(r).toMatchObject({ ok: true, complete: false });
    expect(tables.insurance_document_signers[0]).toMatchObject({ status: "signed", typed_name: "Thomas Wolfe", casl_choice: "yes", casl_initials: "TW", ip: "1.1.1.1", user_agent: "UA" });
    expect(tables.insurance_document_signers[0].statement_text).toContain("electronic signature");
    expect(tables.insurance_documents[0].status).toBe("partly_signed");
    expect(await clientPending(db, "c1")).toHaveLength(0);
  });
  it("signing twice changes nothing", async () => {
    const { db, tables } = fakeDb(seed());
    await clientSign(db, "c1", "d1", good, "1.1.1.1", "UA");
    const again: any = await clientSign(db, "c1", "d1", { ...good, typedName: "Thomas Wolfe", caslChoice: "no" }, "9.9.9.9", "other");
    expect(again.alreadySigned).toBe(true);
    expect(tables.insurance_document_signers[0]).toMatchObject({ casl_choice: "yes", ip: "1.1.1.1" });
  });
  it("completes when the last person signs, and then files the signed copy", async () => {
    const { db, tables } = fakeDb(seed());
    const filed: string[] = [];
    await clientSign(db, "c1", "d1", good, "1.1.1.1", "UA", async (id) => { filed.push(id); });
    expect(filed).toEqual([]);
    const r: any = await clientSign(db, "c2", "d1", { ...good, typedName: "Sarah Wolfe", caslEmail: "s@x.ca" }, "2.2.2.2", "UA", async (id) => { filed.push(id); });
    expect(r).toMatchObject({ ok: true, complete: true });
    expect(tables.insurance_documents[0].status).toBe("signed");
    expect(tables.insurance_documents[0].completed_at).toBeTruthy();
    expect(filed).toEqual(["d1"]);
    expect(tables.staff_notifications.some((n: any) => /signed by everyone/.test(n.title))).toBe(true);
  });
  it("will not take a signature on a voided document", async () => {
    const s = seed(); s.insurance_documents[0].status = "void";
    const { db } = fakeDb(s);
    expect(((await clientSign(db, "c1", "d1", good, null, null)) as any).error).toMatch(/no longer/);
  });
});

describe("wiring", () => {
  it("keeps the client's list of covered checklist items in step with the server's", () => { expect(CLIENT_ITEMS).toEqual(DOC_ITEMS); });
  it("has a migration with grants, and the portal and advisor entry points", () => {
    const m = readFileSync("supabase/migrations/20261217120000_insurance_documents.sql", "utf8");
    for (const t of ["insurance_doc_templates", "insurance_documents", "insurance_document_signers"]) expect(m).toMatch(new RegExp(`GRANT [A-Z ,]+ ON public\\.${t} TO service_role;`));
    expect(m).toMatch(/GRANT SELECT ON public\.insurance_doc_templates TO authenticated;/);
    expect(readFileSync("supabase/functions/portal-pm-tasks/index.ts", "utf8")).toMatch(/docSign/);
    expect(readFileSync("supabase/functions/review-agent-admin/index.ts", "utf8")).toMatch(/insDocSend/);
    expect(readFileSync("src/App.tsx", "utf8")).toContain("/portal/:token/documents");
  });
});
