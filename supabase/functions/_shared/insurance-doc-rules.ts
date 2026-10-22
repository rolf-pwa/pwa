// insurance-doc-rules.ts: turning a master Google Doc (exported as Markdown) into the document a client signs in the portal, and checking a signature. Pure.
// The master stays the way Rolf writes it in Word or Docs. The system owns the parts that must be interactive and recorded: the client's name in the
// acknowledgement, the CASL choice with initials, and the signature block. Blank signature lines and the paper Yes/No boxes are dropped, and a marker
// stands where the CASL choice goes. Explicit markers in the master win if they are used: {{client_names}}, {{advisor_contact}}, {{casl_choice}}, {{date}}.

import type { Block } from "./simple-pdf.ts";
export const CASL_MARKER = "{{casl_choice}}";
export const SIGN_STATEMENT_VERSION = "2026-10-a";
export const SIGN_STATEMENT = "I have read this document and I agree to it. I understand that typing my name below is my electronic signature, and that it has the same effect as signing on paper.";

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
export function signedPdfBlocks(i: { md: string; hash: string; templateModified: string | null; templateVersion: string | null; sentAt: string; signers: SignedRecord[] }): Block[] {
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
      else blocks.push({ kind: "p", text: plainOf(t) });
    }
  };
  const parts = i.md.split(CASL_MARKER);
  render(parts[0]);
  if (parts.length > 1) { blocks.push({ kind: "p", text: "Canada's Anti-Spam Legislation (CASL) consent: each signer's choice is recorded in the signature record below.", bold: true }); render(parts.slice(1).join("")); }
  blocks.push({ kind: "gap", h: 10 }, { kind: "h", text: "Electronic signatures" }, { kind: "p", text: SIGN_STATEMENT, small: true });
  for (const s of i.signers) {
    const when = new Date(s.signedAt).toLocaleString("en-CA", { timeZone: "America/Vancouver", dateStyle: "long", timeStyle: "short" });
    const lines = [`Signed ${when} Pacific${s.ip ? `, from IP address ${s.ip}` : ""}`];
    if (s.caslChoice) lines.push(`Commercial electronic messages (CASL): ${s.caslChoice === "yes" ? `agreed, at ${s.caslEmail}` : "not agreed"}. Initials: ${s.caslInitials}`);
    blocks.push({ kind: "card", title: s.typedName.trim().toLowerCase() === s.name.trim().toLowerCase() ? s.typedName : `${s.typedName} (on file as ${s.name})`, lines });
  }
  blocks.push({ kind: "gap", h: 6 }, { kind: "p", small: true, text: `Sent ${new Date(i.sentAt).toLocaleDateString("en-CA", { timeZone: "America/Vancouver", dateStyle: "long" })}. Wording fingerprint (SHA-256): ${i.hash}. Master document version: ${i.templateVersion ?? "not stated"}; last edited ${i.templateModified ?? "unknown"}. Statement version ${SIGN_STATEMENT_VERSION}.` });
  return blocks;
}
