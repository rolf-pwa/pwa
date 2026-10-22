// fact-find-rules.ts: the fact find (know-your-client) for one person on an insurance file. Pure.
// Some facts come straight from the file (identity, family, liabilities, policies, estate contacts, onboarding notes) and are certain. The rest are
// proposed by the model from meeting notes and call transcripts, and only kept when it quotes the source: the quote must appear in that source's text,
// word for word, so nothing is invented. Anything not found is shown as missing. Rolf edits and confirms, then the client confirms it in the portal.

export type SectionKey = "personal" | "family" | "employment" | "finances" | "health" | "insurance" | "estate" | "goals";
export const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: "personal", label: "About you" }, { key: "family", label: "Your family" }, { key: "employment", label: "Work and income" }, { key: "finances", label: "Your finances" },
  { key: "health", label: "Health and lifestyle" }, { key: "insurance", label: "Insurance" }, { key: "estate", label: "Estate planning" }, { key: "goals", label: "Goals and what matters to you" },
];

export interface FieldDef { key: string; label: string; section: SectionKey; origin: "file" | "model"; ask: string }
export const FIELDS: FieldDef[] = [
  { key: "legal_name", label: "Legal name", section: "personal", origin: "file", ask: "Confirm your full legal name" },
  { key: "date_of_birth", label: "Date of birth", section: "personal", origin: "file", ask: "Date of birth" },
  { key: "contact", label: "Contact details", section: "personal", origin: "file", ask: "Phone, email and address" },
  { key: "marital_status", label: "Marital status", section: "personal", origin: "model", ask: "Marital or relationship status" },
  { key: "tobacco_use", label: "Tobacco and nicotine use", section: "personal", origin: "model", ask: "Tobacco or nicotine use, now and in the past 12 months" },
  { key: "dependants", label: "Children and dependants", section: "family", origin: "file", ask: "Children and other dependants, with ages" },
  { key: "occupation", label: "Occupation", section: "employment", origin: "model", ask: "Occupation and duties" },
  { key: "employer", label: "Employer or business", section: "employment", origin: "model", ask: "Employer or own business" },
  { key: "annual_income", label: "Annual income", section: "employment", origin: "model", ask: "Annual income before tax" },
  { key: "other_income", label: "Other income", section: "employment", origin: "model", ask: "Other income (rental, pension, investments)" },
  { key: "assets", label: "Assets on file", section: "finances", origin: "file", ask: "Savings, investments, property and other assets" },
  { key: "liabilities", label: "Debts on file", section: "finances", origin: "file", ask: "Mortgage and other debts" },
  { key: "retirement_plans", label: "Retirement plans", section: "finances", origin: "model", ask: "When and how you plan to retire" },
  { key: "health_notes", label: "Health", section: "health", origin: "model", ask: "Health conditions, treatments or medications" },
  { key: "hazardous_activities", label: "Hazardous activities and travel", section: "health", origin: "model", ask: "Risky sports, aviation, or travel abroad" },
  { key: "existing_coverage", label: "Insurance in force", section: "insurance", origin: "file", ask: "Existing life, disability and critical illness coverage, including through work" },
  { key: "insurance_goal", label: "What you want insurance to do", section: "insurance", origin: "model", ask: "What you want the insurance to accomplish" },
  { key: "concerns", label: "Concerns", section: "insurance", origin: "model", ask: "Concerns about cost, health or underwriting" },
  { key: "estate", label: "Will, executor and power of attorney", section: "estate", origin: "file", ask: "Whether you have a will, an executor and a power of attorney" },
  { key: "vision", label: "Vision and values", section: "goals", origin: "file", ask: "What you want your money and family to be able to do" },
  { key: "pressures", label: "What is weighing on you", section: "goals", origin: "file", ask: "Pressures or decisions on your mind" },
];
export const MODEL_KEYS = new Set(FIELDS.filter((f) => f.origin === "model").map((f) => f.key));

export type SourceType = "file" | "onboarding" | "meeting" | "call" | "client" | "none";
export interface FactSource { type: SourceType; label: string; quote?: string; date?: string }
export type FactStatus = "proposed" | "edited" | "confirmed" | "missing";
export interface Fact { key: string; label: string; section: SectionKey; value: string; source: FactSource; status: FactStatus }

export interface Evidence { id: string; type: "meeting" | "call"; label: string; date: string; text: string }

const norm = (s: string) => String(s ?? "").toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

/** Facts the model proposed, kept only if the key is known, the source exists and the quote really appears in it. */
export function validateModelFacts(raw: unknown, evidence: Evidence[]): { facts: Fact[]; dropped: number } {
  const list = Array.isArray(raw) ? raw : [];
  const facts: Fact[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const r of list as any[]) {
    const def = FIELDS.find((f) => f.key === r?.key && f.origin === "model");
    const ev = evidence.find((e) => e.id === r?.evidence_id);
    const value = String(r?.value ?? "").trim().slice(0, 400);
    const quote = String(r?.quote ?? "").trim();
    if (!def || !ev || !value || quote.length < 10 || quote.length > 300 || !norm(ev.text).includes(norm(quote)) || seen.has(def.key)) { dropped++; continue; }
    seen.add(def.key);
    facts.push({ key: def.key, label: def.label, section: def.section, value, source: { type: ev.type, label: ev.label, quote, date: ev.date }, status: "proposed" });
  }
  return { facts, dropped };
}

/** One fact per field, in the order of the form: from the file if there, else the model's, else missing. */
export function assemble(fileFacts: Fact[], modelFacts: Fact[]): Fact[] {
  return FIELDS.map((f) => {
    const hit = fileFacts.find((x) => x.key === f.key && x.value.trim()) ?? modelFacts.find((x) => x.key === f.key);
    return hit ?? { key: f.key, label: f.label, section: f.section, value: "", source: { type: "none", label: "Not found" }, status: "missing" as const };
  });
}

export const missingFacts = (facts: Fact[]) => facts.filter((f) => !f.value.trim());
export const askList = (facts: Fact[]) => missingFacts(facts).map((f) => FIELDS.find((d) => d.key === f.key)?.ask ?? f.label);

/** The document the client reads and confirms: each fact with where it came from (never the raw quotes), and what is still to be provided. */
export function factFindMarkdown(name: string, facts: Fact[]): string {
  const sourceNote = (f: Fact) => f.status === "edited" || f.source.type === "client" ? "" : f.source.type === "meeting" ? " (from our meeting on " + (f.source.date ?? "") + ")" : f.source.type === "call" ? " (from our call on " + (f.source.date ?? "") + ")" : "";
  const out: string[] = [
    `Hi ${name.split(" ")[0]},`,
    "Below is what I have on file about you and your circumstances. It comes from your onboarding, the information you have shared with me, and our conversations. Please read it carefully. If anything is missing or not right, tell me before you confirm, and I will correct it.",
  ];
  for (const s of SECTIONS) {
    const rows = facts.filter((f) => f.section === s.key);
    if (!rows.length) continue;
    out.push(`## ${s.label}`);
    for (const f of rows) out.push(`**${f.label}:** ${f.value.trim() ? f.value.trim().replace(/\n+/g, "; ") + sourceNote(f) : "Not yet provided"}`);
  }
  return out.join("\n\n");
}

export const FACT_FIND_STATEMENT = "I confirm that the information about me in this document is correct and complete to the best of my knowledge, and that I have had the chance to correct it. I understand that typing my name below is my electronic signature, and that it has the same effect as signing on paper.";

/** The text for the model: each source with its id, so every fact can point at one. */
export function evidencePrompt(person: string, evidence: Evidence[]): string {
  return [
    `You are reading the notes of meetings and calls between a financial advisor (Rolf) and clients. Extract facts about ${person} only, for an insurance know-your-client form.`,
    "Rules: a fact must be stated in the text, about this person, not guessed. Health, tobacco and income only if said plainly. Leave out anything about other people unless it is clearly about this person. If the speaker is unclear, leave it out.",
    `For each fact give: key (one of ${[...MODEL_KEYS].join(", ")}), value (a short plain statement), evidence_id (the id of the source), and quote (an exact copy of 10 to 200 characters from that source that supports it, word for word). One fact per key. If nothing is stated for a key, do not include it.`,
    "",
    ...evidence.map((e) => `=== SOURCE ${e.id}: ${e.label} ===\n${e.text}`),
  ].join("\n");
}

// ── Facts that come straight from the file ───────────────────────────────────────────────────────────────────────────
export interface FileInput {
  contact: { full_name?: string | null; first_name?: string | null; last_name?: string | null; email?: string | null; phone?: string | null; address?: string | null; date_of_birth?: string | null; lawyer_name?: string | null; lawyer_firm?: string | null; executor_name?: string | null; executor_firm?: string | null; poa_name?: string | null; poa_firm?: string | null };
  household: { vision_notes?: string | null; values_notes?: string | null; purpose_notes?: string | null; pressure_types?: string[] | null; pressure_note?: string | null };
  minors: { name: string; date_of_birth?: string | null }[];
  liabilities: { liability_type: string; current_balance: number | string | null }[];
  storehouses: { asset_type?: string | null; current_value: number | string | null }[];
  policies: { carrier: string; policy_type: string; coverage_amount: number | string | null }[];
  today: string;
}
const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const words = (s: string) => s.replace(/_/g, " ");
export const ageOn = (dob: string | null | undefined, today: string): number | null => {
  if (!dob || !/^\d{4}-\d{2}-\d{2}/.test(dob)) return null;
  const [y, m, d] = dob.slice(0, 10).split("-").map(Number), [ty, tm, td] = today.split("-").map(Number);
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
};

export function buildFileFacts(i: FileInput): Fact[] {
  const out: Fact[] = [];
  const add = (key: string, value: string, type: SourceType, label: string) => {
    const d = FIELDS.find((f) => f.key === key)!;
    out.push({ key, label: d.label, section: d.section, value: value.trim(), source: { type, label }, status: "proposed" });
  };
  const c = i.contact;
  const name = (c.full_name || `${c.first_name ?? ""} ${c.last_name ?? ""}`).trim();
  if (name) add("legal_name", name, "file", "ProsperWise file");
  if (c.date_of_birth) { const a = ageOn(c.date_of_birth, i.today); add("date_of_birth", `${c.date_of_birth.slice(0, 10)}${a !== null ? ` (age ${a})` : ""}`, "file", "ProsperWise file"); }
  const contact = [c.phone && `Phone ${c.phone}`, c.email && `Email ${c.email}`, c.address && `Address ${c.address}`].filter(Boolean).join("; ");
  if (contact) add("contact", contact, "file", "ProsperWise file");
  if (i.minors.length) add("dependants", i.minors.map((m) => { const a = ageOn(m.date_of_birth, i.today); return a !== null ? `${m.name} (${a})` : m.name; }).join("; "), "file", "ProsperWise file");
  const liab = i.liabilities.filter((l) => num(l.current_balance) > 0);
  if (liab.length) { const by = new Map<string, number>(); for (const l of liab) by.set(l.liability_type, (by.get(l.liability_type) ?? 0) + num(l.current_balance)); add("liabilities", `${[...by].map(([k, v]) => `${words(k)} ${money(v)}`).join("; ")}; total ${money([...by.values()].reduce((a, b) => a + b, 0))}`, "file", "Liabilities on file"); }
  const held = i.storehouses.filter((s) => num(s.current_value) > 0);
  if (held.length) add("assets", `${held.length} account${held.length === 1 ? "" : "s"} on file, current value ${money(held.reduce((a, s) => a + num(s.current_value), 0))}`, "file", "Accounts on file");
  if (i.policies.length) add("existing_coverage", i.policies.map((p) => `${words(p.policy_type)}, ${p.carrier}${num(p.coverage_amount) ? `, ${money(num(p.coverage_amount))}` : ""}`).join("; "), "file", "Policies on file");
  const est = [c.lawyer_name && `Lawyer ${c.lawyer_name}${c.lawyer_firm ? ` (${c.lawyer_firm})` : ""}`, c.executor_name && `Executor ${c.executor_name}${c.executor_firm ? ` (${c.executor_firm})` : ""}`, c.poa_name && `Power of attorney ${c.poa_name}${c.poa_firm ? ` (${c.poa_firm})` : ""}`].filter(Boolean).join("; ");
  if (est) add("estate", est, "file", "ProsperWise file");
  const h = i.household;
  const vision = [h.vision_notes && `Vision: ${h.vision_notes}`, h.values_notes && `Values: ${h.values_notes}`, h.purpose_notes && `Purpose: ${h.purpose_notes}`].filter(Boolean).join("; ");
  if (vision) add("vision", vision, "onboarding", "Onboarding");
  const pressures = [(h.pressure_types ?? []).map(words).join(", "), h.pressure_note ?? ""].filter((x) => x.trim()).join(": ");
  if (pressures) add("pressures", pressures, "onboarding", "Onboarding");
  return out;
}
