// insurance-file-rules.ts: what an insurance file must contain, whether it is complete, and the index document for the audit package. Pure.
// The checklist follows what an insurer or regulator asks for on a sale: disclosures, the client's facts, the needs analysis, the alternatives
// considered, the recommendation and its reasons, the application, and the record of meetings.

export type FileKind = "new_sale" | "replacement" | "in_force_review";
export interface ChecklistItem { kind: string; label: string; hint: string; requiredFor: FileKind[] }

export const CHECKLIST: ChecklistItem[] = [
  { kind: "advisor_disclosure", label: "Advisor disclosure", hint: "Signed by the client", requiredFor: ["new_sale", "replacement"] },
  { kind: "privacy_consent", label: "Privacy consent", hint: "Signed by the client", requiredFor: ["new_sale", "replacement", "in_force_review"] },
  { kind: "fact_find", label: "Fact find / know your client", hint: "The client's circumstances, income, assets, health and goals", requiredFor: ["new_sale", "replacement"] },
  { kind: "needs_analysis", label: "Needs analysis", hint: "How the amount and type of cover were worked out", requiredFor: ["new_sale", "replacement", "in_force_review"] },
  { kind: "alternatives", label: "Evidence of alternatives considered", hint: "Quotes or illustrations compared, with carriers and products", requiredFor: ["new_sale", "replacement"] },
  { kind: "recommendation", label: "Recommendation and reasons (reason-why letter)", hint: "What you recommended and why it suits the client", requiredFor: ["new_sale", "replacement", "in_force_review"] },
  { kind: "illustration", label: "Illustration", hint: "The illustration for the recommended policy", requiredFor: ["new_sale", "replacement"] },
  { kind: "replacement_disclosure", label: "Replacement disclosure", hint: "Required when an existing policy is being replaced", requiredFor: ["replacement"] },
  { kind: "application", label: "Signed application", hint: "As submitted to the carrier", requiredFor: ["new_sale", "replacement"] },
  { kind: "delivery_confirmation", label: "Delivery of the policy", hint: "Confirmation the client received the policy", requiredFor: ["new_sale", "replacement"] },
  { kind: "meeting_records", label: "Meeting records", hint: "At least one meeting record for the client discussions", requiredFor: ["new_sale", "replacement", "in_force_review"] },
  { kind: "underwriting_notes", label: "Underwriting notes and cover letter", hint: "Anything sent to or received from the underwriter", requiredFor: [] },
  { kind: "other", label: "Other supporting documents", hint: "Anything else that belongs in the file", requiredFor: [] },
];
export const KIND_LABEL: Record<FileKind, string> = { new_sale: "New sale", replacement: "Replacement", in_force_review: "In-force review" };
export const checklistFor = (kind: FileKind): ChecklistItem[] => CHECKLIST.filter((c) => c.requiredFor.includes(kind));

export interface ItemRow { kind: string; status: "provided" | "not_applicable" }
export interface FileStatus { required: number; done: number; missing: ChecklistItem[]; complete: boolean }
/** A required item is done when it has evidence attached or has been marked not applicable. */
export function fileStatus(kind: FileKind, items: ItemRow[]): FileStatus {
  const req = checklistFor(kind);
  const have = new Set(items.map((i) => i.kind));
  const missing = req.filter((c) => !have.has(c.kind));
  return { required: req.length, done: req.length - missing.length, missing, complete: missing.length === 0 };
}

/** A Drive file id from a pasted link or a bare id; null if it is neither. */
export function parseDriveId(input: string): string | null {
  const s = String(input ?? "").trim();
  const m = s.match(/\/d\/([A-Za-z0-9_-]{15,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{15,})/) || s.match(/\/folders\/([A-Za-z0-9_-]{15,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{25,}$/.test(s) ? s : null;
}

const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export interface IndexInput {
  title: string; kindLabel: string; household: string; client: string | null; policy: string | null; openedYmd: string; createdYmd: string; createdBy: string;
  rows: { label: string; required: boolean; status: "provided" | "not_applicable" | "missing"; evidence: string; url: string | null; addedYmd: string | null; addedBy: string | null; note: string | null }[];
  complete: boolean;
}
/** The index document at the front of the package: what the file is, and every checklist item with its evidence and when it was added. */
export function indexHtml(i: IndexInput): string {
  const row = (r: IndexInput["rows"][number]) => `<tr><td>${esc(r.label)}${r.required ? "" : " (optional)"}</td><td>${r.status === "provided" ? "Provided" : r.status === "not_applicable" ? "Not applicable" : "<b>Missing</b>"}</td><td>${r.url ? `<a href="${esc(r.url)}">${esc(r.evidence || "Document")}</a>` : esc(r.evidence)}${r.note ? `<br><i>${esc(r.note)}</i>` : ""}</td><td>${esc(r.addedYmd ?? "")}${r.addedBy ? ` (${esc(r.addedBy)})` : ""}</td></tr>`;
  return `<html><body style="font-family:Arial,sans-serif">
<h1>Insurance file: ${esc(i.title)}</h1>
<p><b>Type:</b> ${esc(i.kindLabel)}<br><b>Household:</b> ${esc(i.household)}${i.client ? `<br><b>Client:</b> ${esc(i.client)}` : ""}${i.policy ? `<br><b>Policy:</b> ${esc(i.policy)}` : ""}<br><b>File opened:</b> ${esc(i.openedYmd)}<br><b>This package created:</b> ${esc(i.createdYmd)} by ${esc(i.createdBy)}</p>
<p><b>${i.complete ? "All required items are in the file." : "Some required items are missing (marked Missing below)."}</b></p>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%"><tr style="background:#eee"><th align="left">Item</th><th align="left">Status</th><th align="left">Evidence</th><th align="left">Added</th></tr>
${i.rows.map(row).join("\n")}
</table>
<p style="color:#666;font-size:11px">Copies of the documents above are in this folder. Dates and names are as recorded in the ProsperWise system when each item was added.</p>
</body></html>`;
}
