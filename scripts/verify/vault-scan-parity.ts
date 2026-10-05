// V1 parity harness for supabase/functions/vault-statement-scan.
//
// Runs the REAL handler code end to end against a fake world (Supabase auth +
// PostgREST, Google Drive/token, Vertex) and records every write and every
// prompt. The same fixtures go through:
//   A. the version on origin/main                       (the production baseline)
//   B. this branch, household flag OFF                  -> must equal A exactly
//   D. this branch, flag lookup FAILS (e.g. column missing before the migration)
//                                                       -> must equal A exactly
//   C. this branch, flag ON (V2)                        -> must NOT touch live
//      tables, must hold each file's extraction in stage2_verification_audit,
//      and must append only the V2 suffixes (provenance; net-gain terms for investments) to the prompts.
//
// Run: deno run --allow-all --node-modules-dir=none scripts/verify/vault-scan-parity.ts
// Exits non-zero on any mismatch.

// deno-lint-ignore-file no-explicit-any
import { V2_PROVENANCE_PROMPT_SUFFIX } from "../../supabase/functions/_shared/provenance.ts";
import { V2_INVESTMENT_NETGAIN_SUFFIX } from "../../supabase/functions/_shared/stage1-v2-prompts.ts";
const FN_DIR = new URL("../../supabase/functions/vault-statement-scan/", import.meta.url);
const BASELINE = new URL("index.main.ts", FN_DIR);
const CURRENT = new URL("index.ts", FN_DIR);

const HH = "11111111-1111-4111-8111-111111111111";
const SB = "http://fake.supabase.test";

// ---- fixtures ----
const MEMBERS = [
  { id: "c-alex", first_name: "Alex", last_name: "Demo", family_role: "Head of Household" },
  { id: "c-sam", first_name: "Sam", last_name: "Demo", family_role: null },
];
const VINEYARD = [{ id: "v1", contact_id: "c-alex", account_name: "iA - RRSP", account_number: "RR-123" }];
const INVESTMENT_REPLY = {
  statement_date: "2026-09-30", summary: "x", missing_fields: [],
  accounts: [
    { account_name: "iA - RRSP", account_number: "RR-123", account_type: "RRSP", account_owner: "Alex Demo", custodian: "IA Financial", book_value: 100000, current_harvest: 12500, current_value: 112500,
      funds: [{ name: "Bond", category: "Income Funds", value: 2000 }, { name: "Equity", category: "Equity Funds", value: 110500 }] },
    { account_name: "JustWealth - TFSA", account_number: "JW-9", account_type: "TFSA", account_owner: "Sam Demo", custodian: "Just Wealth", book_value: 5000, current_harvest: 400, current_value: 5400 },
  ],
};
const INSURANCE_REPLY = {
  summary: "x", missing_fields: [],
  policies: [{ carrier: "iA", policy_number: "P-1", policy_type: "term", insured_name: "Alex Demo", coverage_amount: 500000, premium_amount: 120, premium_frequency: "monthly", issue_date: "2022-01-01", renewal_date: "2042-01-01" }],
};

// ---- fake world ----
type Flag = "off" | "on" | "error";
interface Run { mutations: string[]; prompts: string[]; maxTokens: number[]; response: any; status: number }

async function makePem(): Promise<string> {
  const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  let bin = ""; for (const b of der) bin += String.fromCharCode(b);
  return `-----BEGIN PRIVATE KEY-----\n${btoa(bin).match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function installWorld(flag: Flag, rec: Run) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    const method = req.method;
    const text = method === "GET" || method === "HEAD" ? "" : await req.clone().text();

    if (url.origin === SB) {
      if (url.pathname === "/auth/v1/user") return jsonRes({ id: "u1", email: "staff@prosperwise.ca", aud: "authenticated" });
      const table = url.pathname.replace("/rest/v1/", "");
      const wantsObject = (req.headers.get("accept") ?? "").includes("vnd.pgrst.object");
      const reply = (rows: any[]) => jsonRes(wantsObject ? (rows[0] ?? null) : rows);

      if (method !== "GET") {
        // Normalise: record method, table, query filters and body (ids are fixture-stable).
        rec.mutations.push(`${method} ${table}${url.search} ${text}`);
        if (table === "holding_tank" && method === "POST") return reply([{ id: "ht-new", account_name: "x", account_number: null }]);
        if (table === "insurance_policies" && method === "POST") return reply([{ id: "pol-new", carrier: "iA", policy_number: "P-1", insured_name: "Alex Demo" }]);
        if (table === "stage2_verification_audit" && method === "POST") return reply([{ id: "audit-1" }]);
        return new Response(null, { status: 204 });
      }
      const select = url.searchParams.get("select") ?? "";
      switch (table) {
        case "profiles": return reply([{ user_id: "u1" }]);
        case "google_tokens": return reply([{ access_token: "gtok", token_expiry: new Date(Date.now() + 3600_000).toISOString(), refresh_token: "r" }]);
        case "households":
          if (select.includes("v2_ai_engine_enabled")) {
            if (flag === "error") return jsonRes({ code: "42703", message: 'column "v2_ai_engine_enabled" does not exist' }, 400);
            return reply([{ v2_ai_engine_enabled: flag === "on" }]);
          }
          return reply([{ id: HH, label: "Demo", vault_root_folder_id: "root" }]);
        case "contacts": return reply(MEMBERS);
        case "shareholders": case "corporations": case "storehouses": case "holding_tank": case "insurance_policies": case "household_ontology_assessments": return reply([]);
        case "vault_folder_templates": return reply([{ display_name: "05 Investment Statements", slug: "investments" }, { display_name: "06 Insurance", slug: "insurance" }]);
        case "vineyard_accounts": return reply(VINEYARD);
        default: return reply([]);
      }
    }
    if (url.hostname === "oauth2.googleapis.com" || url.hostname === "fake.google.test") return jsonRes({ access_token: "tok", expires_in: 3600 });
    if (url.hostname === "www.googleapis.com" && url.pathname === "/drive/v3/files") {
      const q = url.searchParams.get("q") ?? "";
      const folder = "application/vnd.google-apps.folder";
      if (q.includes("'root'")) return jsonRes({ files: [{ id: "fInv", name: "05 Investment Statements", mimeType: folder }, { id: "fIns", name: "06 Insurance", mimeType: folder }] });
      if (q.includes("'fInv'")) return jsonRes({ files: [{ id: "stmt1", name: "statement.pdf", mimeType: "application/pdf" }] });
      if (q.includes("'fIns'")) return jsonRes({ files: [{ id: "pol1", name: "policy.pdf", mimeType: "application/pdf" }] });
      return jsonRes({ files: [] });
    }
    if (url.hostname === "www.googleapis.com" && url.pathname.startsWith("/drive/v3/files/")) return new Response(new TextEncoder().encode("%PDF-fake"), { status: 200 });
    if (url.hostname.endsWith("aiplatform.googleapis.com")) {
      const body = JSON.parse(text);
      const prompt: string = body.contents[0].parts[0].text;
      rec.prompts.push(prompt);
      rec.maxTokens.push(body.generationConfig?.maxOutputTokens);
      const reply = prompt.includes("financial statement parser") ? INVESTMENT_REPLY : INSURANCE_REPLY;
      return jsonRes({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] }, finishReason: "STOP" }] });
    }
    return realFetch(input, init); // esm.sh etc. -- the real network, only for module loading
  }) as typeof fetch;
  return () => { globalThis.fetch = realFetch; };
}

let counter = 0;
async function runScenario(file: URL, flag: Flag): Promise<Run> {
  const rec: Run = { mutations: [], prompts: [], maxTokens: [], response: null, status: 0 };
  const uninstall = installWorld(flag, rec);
  let handler: ((r: Request) => Promise<Response>) | null = null;
  const realServe = Deno.serve;
  (Deno as any).serve = (...args: any[]) => { handler = args[args.length - 1]; return { shutdown() {}, finished: Promise.resolve() } as any; };
  try {
    await import(`${file.href}?run=${++counter}`);
    const res = await handler!(new Request("http://localhost/vault-statement-scan", {
      method: "POST", headers: { Authorization: "Bearer test", Origin: "https://app.prosperwise.ca", "Content-Type": "application/json" },
      body: JSON.stringify({ householdId: HH }),
    }));
    rec.status = res.status;
    rec.response = await res.json();
  } finally { (Deno as any).serve = realServe; uninstall(); }
  return rec;
}

// ---- main ----
Deno.env.set("SUPABASE_URL", SB);
Deno.env.set("SUPABASE_ANON_KEY", "anon");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service");
Deno.env.set("GOOGLE_CLIENT_ID", "id");
Deno.env.set("GOOGLE_CLIENT_SECRET", "secret");
Deno.env.set("GCP_SERVICE_ACCOUNT_KEY", JSON.stringify({ type: "service_account", project_id: "fake-proj", private_key: await makePem(), client_email: "sa@fake.iam", token_uri: "http://fake.google.test/token" }));

const src = await new Deno.Command("git", { args: ["show", "origin/main:supabase/functions/vault-statement-scan/index.ts"], stdout: "piped" }).output();
if (!src.success) throw new Error("could not read origin/main version (run `git fetch origin` first)");
await Deno.writeFile(BASELINE, src.stdout);

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`); if (!ok) failures++; };
// Writes to the live account/policy tables plus the review log: what V1 users depend on.
const live = (m: string) => /^(PATCH|POST|DELETE) (vineyard_accounts|storehouses|holding_tank|insurance_policies|review_queue)/.test(m);

try {
  const A = await runScenario(BASELINE, "off");
  const B = await runScenario(CURRENT, "off");
  const D = await runScenario(CURRENT, "error");
  const C = await runScenario(CURRENT, "on");

  console.log(`baseline wrote ${A.mutations.filter(live).length} live rows, sent ${A.prompts.length} prompts, status ${A.status}`);
  check("baseline sanity: scan succeeded and wrote live records", A.status === 200 && A.mutations.some((m) => m.startsWith("PATCH vineyard_accounts")) && A.mutations.some((m) => m.startsWith("POST holding_tank")) && A.mutations.some((m) => m.startsWith("POST insurance_policies")));
  check("B (flag off) writes identical to baseline", JSON.stringify(B.mutations) === JSON.stringify(A.mutations), `\nA=${JSON.stringify(A.mutations)}\nB=${JSON.stringify(B.mutations)}`);
  check("B (flag off) prompts identical to baseline", JSON.stringify(B.prompts) === JSON.stringify(A.prompts));
  check("B (flag off) response identical to baseline", JSON.stringify(B.response) === JSON.stringify(A.response), `\nA=${JSON.stringify(A.response)}\nB=${JSON.stringify(B.response)}`);
  check("D (flag lookup fails) behaves as V1: writes identical", JSON.stringify(D.mutations) === JSON.stringify(A.mutations));
  check("D (flag lookup fails) prompts and response identical", JSON.stringify(D.prompts) === JSON.stringify(A.prompts) && JSON.stringify(D.response) === JSON.stringify(A.response));

  check("C (V2) writes nothing to live account/policy tables", C.mutations.filter((m) => /^(PATCH|POST|DELETE) (vineyard_accounts|storehouses|holding_tank|insurance_policies)/.test(m)).length === 0, JSON.stringify(C.mutations));
  check("C (V2) holds one audit row per file (2)", C.mutations.filter((m) => m.startsWith("POST stage2_verification_audit")).length === 2);
  check("C (V2) prompts = baseline + provenance (+ net-gain terms for investments) only", C.prompts.length === A.prompts.length && C.prompts.every((p, i) => p !== A.prompts[i] && p.replace(V2_INVESTMENT_NETGAIN_SUFFIX, "").replace(V2_PROVENANCE_PROMPT_SUFFIX, "") === A.prompts[i]), JSON.stringify(C.prompts.map((p) => p.length)));
  check("C (V2) response reports held-for-review", C.status === 200 && C.response.v2HeldForReview === 2 && C.response.investmentAccountsMatched === 0 && C.response.insurancePoliciesCreated === 0, JSON.stringify(C.response));
  check("V1 response has no V2 fields", !("v2HeldForReview" in B.response));
  check("V1 output cap unchanged (8000) in baseline, flag-off and flag-lookup-fails runs", [A, B, D].every((r) => r.maxTokens.length === 2 && r.maxTokens.every((n) => n === 8000)), JSON.stringify([A.maxTokens, B.maxTokens, D.maxTokens]));
  check("C (V2) allows a longer response for investment statements only (16000 / 8000)", JSON.stringify(C.maxTokens) === JSON.stringify([16000, 8000]), JSON.stringify(C.maxTokens));
  const audit = C.mutations.find((m) => m.startsWith("POST stage2_verification_audit") && m.includes('"kind":"investment"')) ?? "";
  check("C (V2) stores the derived availability computed from the fund lines (surplus 12,500; income 2,000; available 2,000)", audit.includes('"availability"') && audit.includes('"surplus":12500') && audit.includes('"income_funds":2000') && audit.includes('"available":2000') && audit.includes('"status":"confirmed"'), audit.slice(0, 300));
  check("C (V2) investment prompt asks for the fund lines; V1 prompt does not", C.prompts[0].includes('"funds"') && !A.prompts[0].includes('"funds"'));
} finally {
  await Deno.remove(BASELINE).catch(() => {});
}
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
Deno.exit(failures === 0 ? 0 : 1);
