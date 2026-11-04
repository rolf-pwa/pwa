// georgia-triage.ts: which client requests Georgia may handle without a task, and what she does with each. Pure; no I/O.
// A fixed gate runs first, on the client's own words and the request type: anything that moves money, touches a beneficiary or ownership,
// asks for advice, is urgent, concerns another person or is a privacy right goes to Rolf whatever the settings or the model say.
// Only then is a category looked for, and the category's mode (off, shadow, draft, auto) says what happens. Nothing here can send a request
// away from Rolf by itself except an explicit "auto" or "draft" mode on a category the gate has let through.

export type Category = "status" | "documents" | "meetings" | "ia_self_serve" | "contact_details";
export const CATEGORIES: Category[] = ["status", "documents", "meetings", "ia_self_serve", "contact_details"];
export type Mode = "off" | "shadow" | "draft" | "auto";
export type Outcome = "answered" | "done" | "drafted" | "handed_over";
export type GateReason =
  | "money_movement" | "banking_details" | "beneficiary" | "ownership" | "advice" | "urgent" | "data_rights" | "other_person" | "name_change";

const has = (text: string, re: RegExp) => re.test(text);

const GATES: { reason: GateReason; test: (t: string, type: string) => boolean }[] = [
  { reason: "money_movement", test: (t) => has(t, /\b(withdraw\w*|transfer\w*|wire|wiring|e-?transfer|redeem|redemption|cash\s?out|pay\s?out|payout|send (me )?(the )?(money|funds|cash)|move (my |the )?(money|funds)|rebalanc\w*|switch(ing)? funds?)\b/) },
  // Banking details on an investment account stay with Rolf; the same words about an insurance premium are iA self-serve.
  { reason: "banking_details", test: (t) => has(t, /\b(bank(ing)?( account| details| info\w*)?|void(ed)? cheque|voided check|institution number|transit number|routing number|direct deposit)\b/) && !has(t, /\b(insurance|policy|premium|payment date)\b/) },
  { reason: "beneficiary", test: (t) => has(t, /\bbeneficiar\w*|\bsuccessor (holder|owner)\b|\btrustee\b/) },
  { reason: "ownership", test: (t) => has(t, /\b(ownership|joint (account|owner)\w*|add (my )?(spouse|husband|wife|partner|child|son|daughter) to|remove \w+ from (the |my )?account|change (the )?owner)\b/) },
  { reason: "advice", test: (t) => has(t, /\b(should (i|we)|do you recommend|what do you recommend|which fund|which investment|is it a good (idea|time)|(buy|sell|invest in)\b|tax (advice|strategy)|legal advice|what would you do|am i (better|worse) off)\b/) },
  { reason: "urgent", test: (t) => has(t, /\b(passed away|has died|\bdied\b|death in|funeral|diagnos\w*|terminal|hospital|fraud\w*|scam\w*|hack\w*|stolen|compromis\w*|unauthori[sz]ed|never arrived|didn'?t arrive|has not arrived|wrong account|suicid\w*|desperate|emergency)\b/) },
  { reason: "data_rights", test: (t, type) => type === "data_access" || has(t, /\b((delete|remove|erase) (all )?(of )?my (personal )?(data|information|records|details)|erase my|copy of (all )?(my )?personal information|privacy (request|complaint)|what (personal )?information do you (hold|have))\b/) },
  { reason: "other_person", test: (t) => has(t, /\b(my|his|her|their) (late )?(husband|wife|spouse|partner|son|daughter|mother|father|mom|dad|brother|sister|parents?|in-laws?|friend|client)'?s?\b.*\b(account|policy|statement|document|information|details|balance)/) || has(t, /\b(for|about|on behalf of) (my )?(husband|wife|spouse|partner|son|daughter|mother|father|mom|dad|brother|sister|parents?)\b/) },
  { reason: "name_change", test: (t) => has(t, /\b(change|update|correct)( of| to)? (my |the |our )?(legal )?(last |first |full )?name\b|\bchanged my (legal |last |first )?name\b|\bmarriage certificate\b|\bname change\b/) },
];

/** Why a request must go to Rolf whatever the settings say: empty when the gate lets it through. */
export function gateReasons(text: string, requestType: string): GateReason[] {
  const t = String(text ?? "").toLowerCase();
  return GATES.filter((g) => g.test(t, requestType)).map((g) => g.reason);
}

const DETECT: { category: Category; test: (t: string) => boolean }[] = [
  { category: "ia_self_serve", test: (t) => has(t, /\b(deposit\w*|contribut\w*|add money|client space|payment date|premium (date|frequency|payment)|pause (my )?(premium|payment)s?|delay (my )?(premium|payment)s?|stop (my )?(premium|payment)s?|change (how|when) i pay)\b/) },
  { category: "contact_details", test: (t) => has(t, /\b(phone|cell|mobile|telephone|address|e-?mail|postal code|mailing)\b/) && has(t, /\b(change|update|new|moved|moving|correct|different|replace)\b/) },
  { category: "meetings", test: (t) => has(t, /\b(meeting|appointment|book(ing)?|re-?schedul\w*|cancel (my|the) (meeting|appointment)|next (meeting|call|review)|call with rolf|zoom|video call)\b/) },
  { category: "documents", test: (t) => has(t, /\b(statement|tax slip|t3\b|t5\b|rl-?1|receipt|confirmation letter|my documents|document|copy of|report|form)\b/) },
  { category: "status", test: (t) => has(t, /\b(status|any (news|update)|where (is|are|'s)|how is|has (it|my|the)|did you (get|receive)|still waiting|following up|update on)\b/) },
];

export interface Triage { category: Category | null; blocked: GateReason[]; ambiguous: boolean }

/** The gate, then the category: exactly one match names it; none or several leave it unnamed, which hands the request to Rolf. */
export function triageRequest(text: string, requestType: string): Triage {
  const blocked = gateReasons(text, requestType);
  if (blocked.length) return { category: null, blocked, ambiguous: false };
  const t = String(text ?? "").toLowerCase();
  const found = DETECT.filter((d) => d.test(t)).map((d) => d.category);
  return { category: found.length === 1 ? found[0] : null, blocked, ambiguous: found.length > 1 };
}

export interface AutonomyConfig { enabled: boolean; modes: Partial<Record<Category, Mode>> }
export interface Decision { outcome: Outcome; category: Category | null; mode: Mode | null; reason: string; /** True when the category is in shadow mode: it is only recorded, and the request still goes to Rolf. */ shadow: boolean }

/** What happens to a request. A gated, unclear or switched-off request is handed to Rolf; "draft" prepares it for his approval; only "auto" lets Georgia finish it. */
export function decide(t: Triage, cfg: AutonomyConfig): Decision {
  const hand = (reason: string, mode: Mode | null = null, shadow = false): Decision => ({ outcome: "handed_over", category: t.category, mode, reason, shadow });
  if (t.blocked.length) return hand(`Rolf's: ${t.blocked.join(", ")}`);
  if (!cfg.enabled) return hand("Georgia's portal autonomy is switched off");
  if (!t.category) return hand(t.ambiguous ? "More than one kind of request in it" : "Not a kind Georgia handles");
  const mode = cfg.modes[t.category] ?? "off";
  if (mode === "off") return hand(`${t.category} is off`, mode);
  if (mode === "shadow") return hand(`${t.category} is in shadow: recorded, still Rolf's`, mode, true);
  if (mode === "draft") return { outcome: "drafted", category: t.category, mode, reason: `${t.category} is drafted for Rolf's approval`, shadow: false };
  return { outcome: t.category === "contact_details" ? "done" : "answered", category: t.category, mode, reason: `${t.category} is automatic`, shadow: false };
}

/** A contract number as it is kept in a stored conversation: the last four digits only. */
export function maskContract(value: string): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? `ending ${digits.slice(-4)}` : "a contract number";
}

/** Replaces each number in a text with its masked form, whatever spacing or dashes the number was written with. */
export function redactContracts(text: string, numbers: string[]): string {
  let out = String(text ?? "");
  for (const n of numbers) {
    const digits = String(n ?? "").replace(/\D/g, "");
    if (digits.length < 4) continue;
    const loose = digits.split("").join("[\\s-]*");
    out = out.replace(new RegExp(loose, "g"), maskContract(digits));
  }
  return out;
}
