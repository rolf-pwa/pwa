// insurance-doc-rules.ts: turning a master Google Doc (exported as Markdown) into the document a client signs in the portal, and checking a signature. Pure.
// The master stays the way Rolf writes it in Word or Docs. The system owns the parts that must be interactive and recorded: the client's name in the
// acknowledgement, the CASL choice with initials, and the signature block. Blank signature lines and the paper Yes/No boxes are dropped, and a marker
// stands where the CASL choice goes. Explicit markers in the master win if they are used: {{client_names}}, {{advisor_contact}}, {{casl_choice}}, {{date}}.

import type { Block } from "./simple-pdf.ts";
import { FACT_FIND_STATEMENT } from "./fact-find-rules.ts";
export const CASL_MARKER = "{{casl_choice}}";
export const SIGN_STATEMENT_VERSION = "2026-10-a";
export const SIGN_STATEMENT = "I have read this document and I agree to it. I understand that typing my name below is my electronic signature, and that it has the same effect as signing on paper.";
export const SIGN_STATEMENT_LETTER = "I confirm that I have received and read this letter, and that what it says about my needs and circumstances is correct. I understand that typing my name below is my electronic signature, and that it has the same effect as signing on paper.";
/** What the signer agrees to, by kind of document. */
export const statementFor = (kind: string) => (kind === "reason_why" ? SIGN_STATEMENT_LETTER : kind === "fact_find" ? FACT_FIND_STATEMENT : SIGN_STATEMENT);

/** Drive's Markdown export escapes punctuation with a backslash; take those off. */
export const unescapeMd = (s: string) => s.replace(/\\([\\`*_{}\[\]()#+\-.!<>|~])/g, "$1");

const BLANK_LINE = /^\s*[*_]*\s*x?[\s_x]{6,}[*_]*\s*$/i;
const SIGNATURE_LABEL = /^\s*[*_]*\s*Client\s+Signature(\s+Client\s+Signature)?\s+Date\s*[*_]*\s*$/i;
const CASL_OPTION = /(yes,\s*i agree to receive commercial|no,\s*i do not agree to receive commercial)/i;
const CASL_INITIALS = /^\s*client\s+initial\(s\):/i;
const EMPTY_CONTACT = /^\s*[*_]*<>[*_]*\s*$/;
const IMAGE_ONLY = /^\s*(\[image\]|!\[[^\]]*\]\([^)]*\))\s*$/i;

export interface Cleaned { md: string; hasCasl: boolean; usesContactField: boolean }
export function cleanTemplate(raw: string): Cleaned {
  const lines = unescapeMd(String(raw ?? "")).replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let caslPlaced = /\{\{casl_choice\}\}/.test(raw);
  let contactPlaced = false;
  let sawCaslHeading = false;
  for (let line of lines) {
    if (/CASL\)?\s*CONSENT/i.test(line)) sawCaslHeading = true;
    // The paper CASL choice: the Yes and No lines, and the initials and email lines under them, become one interactive choice.
    if (CASL_OPTION.test(line) || CASL_INITIALS.test(line) || (sawCaslHeading && /^\s*(client initial|email address)/i.test(line))) {
      if (!caslPlaced) { out.push(CASL_MARKER); caslPlaced = true; }
      continue;
    }
    if (BLANK_LINE.test(line) || SIGNATURE_LABEL.test(line) || IMAGE_ONLY.test(line)) continue;
    if (EMPTY_CONTACT.test(line)) { if (!contactPlaced) { out.push("{{advisor_contact}}"); contactPlaced = true; } continue; }
    // "I, ______ have been informed" takes the client's name or names.
    line = line.replace(/\bI,\s*_{4,}\s*/g, "I, {{client_names}} ");
    out.push(line);
  }
  const md = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { md, hasCasl: md.includes(CASL_MARKER), usesContactField: contactPlaced || /\{\{advisor_contact\}\}/.test(md) };
}

export const joinNames = (names: string[]): string => names.length <= 1 ? (names[0] ?? "") : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

export function fillTemplate(md: string, v: { names: string[]; advisorContact: string; date: string }): string {
  const contact = v.advisorContact.split("\n").map((l) => l.trim()).filter(Boolean).join("  \n");
  return md.split("{{client_names}}").join(joinNames(v.names)).split("{{advisor_contact}}").join(contact).split("{{date}}").join(v.date);
}

/** The version line at the foot of the master, for example "Ver. 2023-2". */
export const footerVersion = (md: string): string | null => unescapeMd(md).match(/\bVer\.\s*([0-9A-Za-z.\-]+)/)?.[1] ?? null;

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z\s'-]/g, " ").replace(/\s+/g, " ").trim();
/** A typed name counts as the signer's when it has their first and last name, in any case; a middle name or initial is fine. */
export function nameMatches(typed: string, full: string): boolean {
  const t = norm(typed).split(" ").filter(Boolean), f = norm(full).split(" ").filter(Boolean);
  if (f.length === 0 || t.length < 2 && f.length > 1) return false;
  return t.includes(f[0]) && t.includes(f[f.length - 1]);
}

export interface SignInput { typedName?: unknown; agree?: unknown; caslChoice?: unknown; caslInitials?: unknown; caslEmail?: unknown }
export type SignCheck = { ok: true; typedName: string; caslChoice: "yes" | "no" | null; caslInitials: string | null; caslEmail: string | null } | { ok: false; error: string };
export function checkSignature(input: SignInput, signerName: string, needsCasl: boolean): SignCheck {
  const typedName = String(input.typedName ?? "").trim().slice(0, 120);
  if (input.agree !== true) return { ok: false, error: "Please tick the box to confirm you have read and agree to the document." };
  if (!nameMatches(typedName, signerName)) return { ok: false, error: `Type your full name as it appears here: ${signerName}.` };
  if (!needsCasl) return { ok: true, typedName, caslChoice: null, caslInitials: null, caslEmail: null };
  const choice = input.caslChoice === "yes" || input.caslChoice === "no" ? input.caslChoice : null;
  if (!choice) return { ok: false, error: "Choose whether you agree to receive commercial electronic messages." };
  const initials = String(input.caslInitials ?? "").replace(/[^A-Za-z]/g, "").toUpperCase();
  if (initials.length < 2 || initials.length > 5) return { ok: false, error: "Add your initials next to your choice." };
  const email = String(input.caslEmail ?? "").trim().slice(0, 200);
  if (choice === "yes" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Add the email address you agree to be contacted at." };
  return { ok: true, typedName, caslChoice: choice, caslInitials: initials, caslEmail: choice === "yes" ? email : null };
}

/** The blocks of the frozen PDF: the document as signed, then the record of each signature. */
export interface SignedRecord { name: string; typedName: string; signedAt: string; ip: string | null; caslChoice: string | null; caslInitials: string | null; caslEmail: string | null }
export function signedPdfBlocks(i: { statement?: string; md: string; hash: string; templateModified: string | null; templateVersion: string | null; sentAt: string; signers: SignedRecord[] }): Block[] {
  const blocks: Block[] = [];
  const plainOf = (t: string) => t.replace(/\*\*\*?(.+?)\*\*\*?/g, "$1").replace(/(^|[^*])\*(?!\*)(.+?)\*/g, "$1$2").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/^\s*[-*]\s+/, "\u2022 ").replace(/\*{2,3}/g, "").replace(/ {2,}$/, "");
  const render = (md: string) => {
    for (const raw of md.split("\n")) {
      const t = raw.trim();
      if (!t) { blocks.push({ kind: "gap", h: 3 }); continue; }
      if (/^\*{2,3}$/.test(t)) continue; // a bold marker left alone on its line
      const h = t.match(/^#{1,4}\s+(.*)$/);
      // A line that is all bold is a heading; so is one whose bold opens here and closes on a later (now empty) line.
      const wholeBold = /^\*{2,3}[^*]+\*{2,3}:?$/.test(t) || /^\*{2,3}[^*]+$/.test(t);
      if (h) blocks.push({ kind: "h", text: plainOf(h[1]) });
      else if (wholeBold) blocks.push({ kind: "h", text: plainOf(t).replace(/:$/, "") });
      else {
        // A bold lead-in ("**What it costs.** The premium is...") becomes its own bold line, since a line is set in one weight.
        const lead = t.match(/^\*\*([^*]+?)\*\*\s+(\S.*)$/);
        if (lead && lead[1].trim().endsWith(":") && lead[1].length <= 40) blocks.push({ kind: "kv", label: plainOf(lead[1]), value: plainOf(lead[2]) });
        else if (lead) { blocks.push({ kind: "p", text: plainOf(lead[1]), bold: true }, { kind: "p", text: plainOf(lead[2]) }); } else blocks.push({ kind: "p", text: plainOf(t) });
      }
    }
  };
  const parts = i.md.split(CASL_MARKER);
  render(parts[0]);
  if (parts.length > 1) { blocks.push({ kind: "p", text: "Canada's Anti-Spam Legislation (CASL) consent: each signer's choice is recorded in the signature record below.", bold: true }); render(parts.slice(1).join("")); }
  blocks.push({ kind: "gap", h: 10 }, { kind: "h", text: "Electronic signatures" }, { kind: "p", text: i.statement ?? SIGN_STATEMENT, small: true });
  for (const s of i.signers) {
    const when = new Date(s.signedAt).toLocaleString("en-CA", { timeZone: "America/Vancouver", dateStyle: "long", timeStyle: "short" });
    const lines = [`Signed ${when} Pacific${s.ip ? `, from IP address ${s.ip}` : ""}`];
    if (s.caslChoice) lines.push(`Commercial electronic messages (CASL): ${s.caslChoice === "yes" ? `agreed, at ${s.caslEmail}` : "not agreed"}. Initials: ${s.caslInitials}`);
    blocks.push({ kind: "card", title: s.typedName.trim().toLowerCase() === s.name.trim().toLowerCase() ? s.typedName : `${s.typedName} (on file as ${s.name})`, lines });
  }
  blocks.push({ kind: "gap", h: 6 }, { kind: "p", small: true, text: `Sent ${new Date(i.sentAt).toLocaleDateString("en-CA", { timeZone: "America/Vancouver", dateStyle: "long" })}. Wording fingerprint (SHA-256): ${i.hash}. Master document version: ${i.templateVersion ?? "not stated"}; last edited ${i.templateModified ?? "unknown"}. Statement version ${SIGN_STATEMENT_VERSION}.` });
  return blocks;
}

// ── The reason-why letter ─────────────────────────────────────────────────────────────────────────────────────────────
export interface ReasonWhyInput { firstNames: string[]; need: string; product: string; carrier: string; benefits: string[]; extra: string[] }
const BLANK_BULLET = /^\s*[-*]\s*_{3,}\s*$/;
const UNDERSCORES = /_{3,}/;
const stripEnd = (s: string) => s.trim().replace(/[.\s]+$/, "");

/**
 * Fills the "Reason Why" master. The master has blanks to fill, in the order: the need ("coverage for ____"), the product ("The ____ policy"), the carrier
 * ("offered by ____"), then a bullet list of benefits. Explicit markers ({{names}}, {{need}}, {{product}}, {{carrier}}, {{benefits}}, {{extra}}) work too and
 * win. Extra paragraphs (needs summary, cost, alternatives) go after the benefits. `missing` names whatever could not be filled.
 */
export function fillReasonWhy(raw: string, v: ReasonWhyInput): { md: string; missing: string[] } {
  let lines = unescapeMd(String(raw ?? "")).replace(/\r/g, "").split("\n");
  const missing: string[] = [];
  const names = joinNames(v.firstNames);
  const bullets = v.benefits.map((b) => b.trim()).filter(Boolean).map((b) => `- ${b}`);
  const extra = v.extra.filter((e) => e.trim());
  // Greeting
  lines = lines.map((l) => (/^\s*Hi\s+[^\n]*$/i.test(l) && !/\{\{/.test(l) ? `Hi ${names},` : l.split("{{names}}").join(names)));
  // The benefit bullets: the blank bullet lines become the real ones, with the extra paragraphs after them.
  const at = lines.findIndex((l) => BLANK_BULLET.test(l) || l.includes("{{benefits}}"));
  const tail = (extra.length ? ["", ...extra.flatMap((e) => [e, ""])] : []);
  if (at >= 0) {
    const kept = lines.filter((l, i) => i < at || !BLANK_BULLET.test(l));
    kept.splice(at, 0, ...(bullets.length ? bullets : []), ...tail);
    lines = kept.filter((l) => !l.includes("{{benefits}}") || false);
    if (!bullets.length) missing.push("benefits");
  } else {
    const k = lines.findIndex((l) => /following benefits/i.test(l));
    if (k >= 0) lines.splice(k + 1, 0, ...bullets, ...tail); else lines.push("", ...bullets, ...tail);
    if (!bullets.length) missing.push("benefits");
  }
  lines = lines.filter((l) => !l.includes("{{extra}}"));
  // The three blanks, in order, then any named markers.
  const blanks = [stripEnd(v.need), v.product.trim(), v.carrier.trim()];
  const labels = ["what the coverage is for", "the product", "the carrier"];
  let n = 0;
  // The master sometimes runs a blank straight into the next word ("____is a great option"), so a word that follows gets its space back.
  lines = lines.map((l) => l.replace(/_{3,}/g, (m, off: number, str: string) => { const val = blanks[n]; if (!val) missing.push(labels[n] ?? "a blank"); n++; return (val || "____") + (/[A-Za-z0-9]/.test(str[off + m.length] ?? "") ? " " : ""); }));
  const md = lines.join("\n").split("{{need}}").join(blanks[0]).split("{{product}}").join(blanks[1]).split("{{carrier}}").join(blanks[2]).replace(/\n{3,}/g, "\n\n").trim();
  return { md, missing: [...new Set(missing)] };
}

export const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
export interface AnalysisLite { name: string; need: number; available: number; shortfall: number; surplus: number; percentMet: number }

/** The paragraph on how the amount of cover was worked out, from the saved DIME analyses. */
export function needsParagraph(rows: AnalysisLite[], recommendedAmount: number | null): string {
  if (!rows.length) return "";
  const parts = rows.map((r) => `${r.name}: a total need of ${money(r.need)}, against ${money(r.available)} already available (existing insurance, savings you would use, and the CPP death benefit), ${r.shortfall > 0 ? `leaving a shortfall of ${money(r.shortfall)}` : `which covers the need`}.`);
  return [
    "**How we worked out the amount of coverage.** We added up four things: debts other than the mortgage, the income your family would need to replace, the mortgage, and the costs of an estate (final expenses, taxes at death and legal costs). We then took off what your family already has.",
    ...parts.map((p) => `- ${p}`),
    ...(recommendedAmount && recommendedAmount > 0 ? [`The coverage recommended here is ${money(recommendedAmount)}.`] : []),
  ].join("\n");
}
export function costParagraph(premium: number | null, frequency: string | null, product: string): string {
  if (!premium || premium <= 0) return "";
  const per: Record<string, string> = { monthly: "a month", quarterly: "a quarter", semi_annual: "every six months", annual: "a year" };
  return `**What it costs.** The premium for the ${product || "policy"} is ${money(premium)} ${per[frequency ?? ""] ?? ""}`.trim() + ".";
}
export const alternativesParagraph = (t: string) => (t.trim() ? `**Alternatives we considered.** ${t.trim()}` : "");
export const replacementParagraph = (t: string) => (t.trim() ? `**Replacing existing coverage.** ${t.trim()}` : "");
