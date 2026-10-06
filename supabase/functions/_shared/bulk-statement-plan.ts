// Pure planning for the bulk statement importer: which household a contract belongs to, and what its
// file should be called. No I/O so it can be unit-tested; vault-service supplies the database rows.

import { buildProposedFilename } from "./vault-shoebox-naming.ts";

export interface AccountHit {
  household_id: string | null;
  household_label: string | null;
  vault_root_folder_id: string | null;
  contact_id: string | null;
  first_name: string | null;
  last_name: string | null;
}

export type BulkStatus = "ready" | "already_filed" | "unmatched" | "ambiguous" | "no_vault" | "bad_input";

export interface BulkPlan {
  status: BulkStatus;
  reason?: string;
  hit?: AccountHit;
  fileName?: string;
}

/** Account numbers compare by letters/digits only. */
export const normalizeContract = (s: string | null | undefined) => (s ?? "").replace(/[^a-zA-Z0-9]/g, "");

export const isIsoDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export function planBulkStatement(opts: {
  contract: string;
  statementDate: string;
  hits: AccountHit[];                 // every account row found for this contract number
  existingNames: Iterable<string>;    // file names already in the household's Vault (any folder)
  alreadyFiled: boolean;              // this contract + date was already imported
}): BulkPlan {
  const contract = normalizeContract(opts.contract);
  if (contract.length < 6 || !isIsoDate(opts.statementDate)) return { status: "bad_input", reason: "missing contract number or statement date" };
  if (opts.alreadyFiled) return { status: "already_filed", reason: "this statement was already imported" };

  const households = new Map<string, AccountHit>();
  for (const h of opts.hits) {
    if (!h.household_id) continue;
    const prev = households.get(h.household_id);
    if (!prev || (!prev.contact_id && h.contact_id)) households.set(h.household_id, h);
  }
  if (households.size === 0) return { status: "unmatched", reason: "no account with this number in the CRM" };
  if (households.size > 1) return { status: "ambiguous", reason: "this number belongs to accounts in more than one household" };
  const hit = [...households.values()][0];
  if (!hit.vault_root_folder_id) return { status: "no_vault", reason: "household has no Vault", hit };

  const fileName = buildProposedFilename({
    documentDate: opts.statementDate,
    uploadedAt: new Date(),
    lastName: hit.last_name ?? "",
    firstInitial: hit.first_name ?? "",
    documentTypeLabel: "InvestmentStatement",
    originalExt: ".pdf",
    accountNumber: contract,
  });
  const taken = new Set([...opts.existingNames].map((n) => n.toLowerCase()));
  if (taken.has(fileName.toLowerCase())) return { status: "already_filed", reason: "a file with this name is already in the Vault", hit, fileName };
  return { status: "ready", hit, fileName };
}
