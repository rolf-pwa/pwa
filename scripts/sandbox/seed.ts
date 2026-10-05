// Seeds the V2 sandbox with a demo household (V2 flag ON), an ontology assessment and three
// held Stage 2 reviews, using the real runStage2. Run: see docs/sandbox/README.md.
// Refuses to run against the production project.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runStage2 } from "../../supabase/functions/_shared/stage2-run.ts";
const url = Deno.env.get("SANDBOX_URL")!;
const serviceKey = Deno.env.get("SANDBOX_SERVICE_ROLE_KEY")!;
if (!url || !serviceKey || url.includes("rpxevcovasrgmrzkpknu")) throw new Error("Set SANDBOX_URL / SANDBOX_SERVICE_ROLE_KEY to the SANDBOX project (never production).");
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const must = <T,>(r: { data: T; error: { message: string } | null }, what: string): NonNullable<T> => { if (r.error || r.data == null) throw new Error(what + ": " + (r.error?.message ?? "no data")); return r.data as NonNullable<T>; };
const { data: users } = await admin.auth.admin.listUsers();
const uid = users.users.find((u) => u.email === "sandbox.staff@prosperwise.ca")!.id;

const family = must(await admin.from("families").insert({ name: "Demo Family (sandbox)", created_by: uid }).select("id").single(), "family");
const hh = must(await admin.from("households").insert({ family_id: family.id, label: "Demo Household", v2_ai_engine_enabled: true }).select("id").single(), "household");
const contacts = must(await admin.from("contacts").insert([
  { first_name: "Alex", last_name: "Demo", full_name: "Alex Demo", household_id: hh.id, created_by: uid },
  { first_name: "Sam", last_name: "Demo", full_name: "Sam Demo", household_id: hh.id, created_by: uid },
]).select("id"), "contacts");
must(await admin.from("household_ontology_assessments").insert({
  household_id: hh.id,
  financial_state: { liquid_capital_cad: 600000, monthly_burn_rate_cad: 20000, tax_liability_identified: true },
  relational_state: { begging_hand_pressure_index: "Critical", spousal_alignment_score: 4 },
  emotional_state: { guilt_survivor_index: 9 },
}).select("id").single(), "ontology");
const va = await admin.from("vineyard_accounts").insert({ contact_id: contacts[0].id, account_name: "iA - RRSP", account_number: "RR-123", current_value: 90000, book_value: 80000 });
if (va.error) console.log("vineyard seed skipped:", va.error.message);

const today = new Date().toISOString().slice(0, 10);
const a = await runStage2(admin, { householdId: hh.id, kind: "investment", source: { file_name: "iA RRSP + TFSA statement.pdf" }, extraction: {
  statement_date: "2024-01-15", // stale on purpose: the demo CONFLICT (a stated gain that differs from value - book is accepted, not a conflict) missing_fields: [],
  accounts: [
    { account_name: "iA - RRSP", account_number: "RR-123", account_type: "RRSP", account_owner: "Alex Demo", custodian: "IA Financial", book_value: 100000, net_transactions: -7500, current_harvest: 20000, current_value: 112500, source: { page_number: 1, bounding_box: [152, 121, 173, 457], quote: "Current value: $112,500.00" } },
    { account_name: "iA - TFSA", account_number: "TF-9", account_type: "TFSA", account_owner: "Sam Demo", custodian: "IA Financial", book_value: null, current_harvest: null, current_value: 5400, source: { page_number: 2, bounding_box: null, quote: null } },
  ] } });
const b = await runStage2(admin, { householdId: hh.id, kind: "investment", source: { file_name: "JustWealth Q3.pdf" }, extraction: {
  statement_date: today, missing_fields: [],
  accounts: [{ account_name: "JustWealth - Non-Registered", account_number: "JW-555", account_type: "Portfolio", account_owner: "Sam Demo", custodian: "Just Wealth", book_value: 40000, current_harvest: 3150, current_value: 43150, source: { page_number: 1, bounding_box: [300, 100, 330, 500], quote: "Market value 43,150.00" } }] } });
const c = await runStage2(admin, { householdId: hh.id, kind: "insurance", source: { file_name: "Term life policy.pdf" }, extraction: {
  missing_fields: ["cash_value"],
  policies: [{ carrier: "iA", policy_number: "P-1001", policy_type: "term", insured_name: "Alex Demo", coverage_amount: 750000, premium_amount: 120, premium_frequency: "monthly", issue_date: "2022-03-01", renewal_date: "2042-03-01", source: { page_number: 1, bounding_box: null, quote: null } }] } });
console.log(JSON.stringify({ household: hh.id, audits: [a, b, c].map((x) => [x.audit_id, x.overall_status]) }));
