// Matching a statement's coverage line to an existing insurance_policies row.
//
// One policy number can carry several coverages: a Universal Life base plus term riders, each with its own
// amount and (for terms) renewal date. Each coverage is its own row, so a policy number alone is not an
// identity. A line only matches a row of the same policy number, insured AND coverage type; two lines of
// the same type are told apart by renewal date.

export interface PolicyRow {
  id: string;
  carrier: string;
  policy_number: string | null;
  insured_name: string;
  policy_type?: string | null;
  renewal_date?: string | null;
}
export interface PolicyLine {
  carrier?: string | null;
  policy_number?: string | null;
  insured_name?: string | null;
  policy_type?: string | null;
  renewal_date?: string | null;
}

const tok = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function findPolicyRow<T extends PolicyRow>(line: PolicyLine, rows: T[]): T | undefined {
  const insured = tok(line.insured_name);
  const num = tok(line.policy_number);
  // Unknown type on either side is compatible (older rows and sparse extractions).
  const typeOk = (r: T) => !line.policy_type || !r.policy_type || line.policy_type === r.policy_type;

  if (num) {
    const sameNumber = rows.filter((r) => r.policy_number && tok(r.policy_number) === num && tok(r.insured_name) === insured);
    if (sameNumber.length) {
      const sameType = sameNumber.filter(typeOk);
      // Rows exist for this policy number but none of this coverage type: a rider or added coverage.
      if (!sameType.length) return undefined;
      const exact = sameType.find((r) => r.renewal_date && line.renewal_date && r.renewal_date === line.renewal_date);
      if (exact) return exact;
      // Same type, and either side has no renewal date to compare: the same coverage, filling in details.
      const open = sameType.find((r) => !r.renewal_date || !line.renewal_date);
      return open; // else: same type but a different renewal date, so a separate coverage
    }
  }
  // No row carries this number. Fall back to carrier + insured for rows that have no number of their own
  // (or for lines that have none), never to a row that belongs to a different policy number.
  const carrier = tok(line.carrier);
  return rows.find((r) => tok(r.carrier) === carrier && tok(r.insured_name) === insured && typeOk(r) && (!num || !r.policy_number));
}
