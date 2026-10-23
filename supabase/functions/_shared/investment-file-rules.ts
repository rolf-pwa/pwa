// investment-file-rules.ts: what a segregated funds file must contain (the MGA's checklist) and whether it is complete. Pure. Investments are kept apart from
// Insurance: their own checklist, their own files. Only the client's signed disclosure is shared, because it belongs to the client, not to a product.

export type FileKind = "new_sale" | "review";
export interface ChecklistItem { kind: string; label: string; hint: string; requiredFor: FileKind[] }

export const CHECKLIST: ChecklistItem[] = [
  { kind: "advisor_disclosure", label: "Advisor disclosure", hint: "Signed by the client (the same signed disclosure as for insurance)", requiredFor: ["new_sale"] },
  { kind: "privacy_consent", label: "Privacy consent", hint: "Signed by the client with the disclosure", requiredFor: ["new_sale"] },
  { kind: "casl_consent", label: "CASL consent", hint: "The client's choice about commercial electronic messages, recorded with the disclosure", requiredFor: ["new_sale"] },
  { kind: "fact_find", label: "Fact find, needs analysis and risk tolerance", hint: "The investor profile and needs analysis, with the risk profile from the investor profile completed with the iA application", requiredFor: ["new_sale", "review"] },
  { kind: "reason_why", label: "Reason why letter", hint: "What you recommended and why it suits the client", requiredFor: ["new_sale"] },
  { kind: "advisor_notes", label: "Advisor notes", hint: "A meeting record or note for the client discussions", requiredFor: ["new_sale", "review"] },
  { kind: "application", label: "Signed application", hint: "The iA application, including the investor profile", requiredFor: [] },
  { kind: "contract_delivery", label: "Contract and delivery", hint: "The issued contract and confirmation the client received it, with the Fund Facts and information folder", requiredFor: [] },
  { kind: "other", label: "Other supporting documents", hint: "Anything else that belongs in the file", requiredFor: [] },
];
export const FILE_KIND_LABEL: Record<FileKind, string> = { new_sale: "New sale", review: "Review" };
export const FILE_KINDS: FileKind[] = ["new_sale", "review"];
export const checklistFor = (kind: FileKind): ChecklistItem[] => CHECKLIST.filter((c) => c.requiredFor.includes(kind));

/** What the client's signed Advisor Disclosure and Privacy Consent (which carries the CASL choice) covers. */
export const DISCLOSURE_ITEMS = ["advisor_disclosure", "privacy_consent", "casl_consent"];

export interface ItemRow { kind: string; status: "provided" | "not_applicable" }
export interface FileStatus { required: number; done: number; missing: ChecklistItem[]; complete: boolean }
/** A required item is done when it has evidence attached, is marked not applicable, or is covered by a record kept elsewhere (the signed disclosure, a saved profile). */
export function fileStatus(kind: FileKind, items: ItemRow[], covered: Iterable<string> = []): FileStatus {
  const req = checklistFor(kind);
  const have = new Set([...items.map((i) => i.kind), ...covered]);
  const missing = req.filter((c) => !have.has(c.kind));
  return { required: req.length, done: req.length - missing.length, missing, complete: missing.length === 0 };
}
