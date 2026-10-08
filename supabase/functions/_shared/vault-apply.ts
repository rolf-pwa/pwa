// vault-apply.ts — turns an advisor-approved Stage 2 extraction into
// concrete writes against live records, and applies advisor corrections.
// The planner is pure (no I/O) so it is unit-tested; applyPlan() is the thin
// executor. Matching rules mirror vault-statement-scan's V1 write-through
// (account number, then name; Holding Tank before creating anything), with
// one deliberate difference: a null extracted figure never overwrites an
// existing value (V1 writes 0 for a missing current_value).

// deno-lint-ignore-file no-explicit-any
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computeAvailability } from "./withdrawal-availability.ts";

export const normalizeToken = (v: string | null | undefined) => (v || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Keep in sync with src/shared/lib/custodians.ts (same copy exists in vault-statement-scan).
export function normalizeCustodian(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower.includes("ia financial") || lower.includes("iag financial")) return "iA Financial Group";
  if (lower.includes("justwealth") || lower.includes("just wealth")) return "JustWealth";
  if (/^[a-z]?\d{6,}$/i.test(value)) return null;
  return value;
}

interface Member { id: string; first_name: string; last_name: string; family_role?: string | null }

export function findMemberByLooseName(members: Member[], name: string | null | undefined) {
  const normalized = normalizeToken(name);
  if (!normalized) return null;
  return members.find((m) => {
    const first = normalizeToken(m.first_name);
    const last = normalizeToken(m.last_name);
    return Boolean(first) && Boolean(last) && normalized.includes(first) && normalized.includes(last);
  }) ?? null;
}

export function headOfHousehold(members: Member[]): Member | undefined {
  const rank = (r: string | null | undefined) => {
    const v = (r || "").toLowerCase();
    if (v === "hof" || v === "head_of_family" || v.includes("head of family")) return 0;
    if (v === "hoh" || v === "head_of_household" || v.includes("head of household")) return 1;
    return 2;
  };
  return [...members].sort((a, b) => rank(a.family_role) - rank(b.family_role))[0];
}

// ---- Corrections ---------------------------------------------------------

export const INVESTMENT_FIELDS = ["account_name", "account_number", "account_type", "account_owner", "custodian", "book_value", "current_harvest", "current_value", "net_transactions"] as const;
export const ESTATE_FIELDS = ["document_type", "subject_name", "document_date", "signed", "executor", "beneficiaries", "notes"] as const;
export const INSURANCE_FIELDS = ["carrier", "policy_number", "policy_type", "insured_name", "coverage_amount", "cash_value", "premium_amount", "premium_frequency", "issue_date", "renewal_date"] as const;
const NUMERIC = new Set(["book_value", "current_harvest", "current_value", "net_transactions", "coverage_amount", "cash_value", "premium_amount"]);

export interface Correction { index: number; field: string; value: unknown; notes?: string }
export interface AppliedOverride {
  field_name: string; original_ai_value: unknown; corrected_value: unknown; reasoning_notes: string | null;
}

/** Validates and applies corrections to a copy of the extraction; returns the override rows to record. */
export function applyCorrections(
  kind: "investment" | "insurance" | "estate",
  extraction: Record<string, any>,
  corrections: Correction[],
): { extraction: Record<string, any>; overrides: AppliedOverride[] } {
  const listKey = kind === "investment" ? "accounts" : kind === "estate" ? "documents" : "policies";
  const allowed: readonly string[] = kind === "investment" ? INVESTMENT_FIELDS : kind === "estate" ? ESTATE_FIELDS : INSURANCE_FIELDS;
  const items: Record<string, any>[] = (extraction[listKey] ?? []).map((i: Record<string, any>) => ({ ...i }));
  const overrides: AppliedOverride[] = [];

  for (const c of corrections) {
    if (!Number.isInteger(c.index) || c.index < 0 || c.index >= items.length) throw new Error(`Correction targets a ${listKey.slice(0, -1)} that doesn't exist (index ${c.index})`);
    if (!allowed.includes(c.field)) throw new Error(`"${c.field}" can't be corrected on a ${kind} extraction`);
    let value: unknown = c.value;
    if (NUMERIC.has(c.field)) {
      if (value === null || value === "") value = null;
      else if (typeof value === "number" && Number.isFinite(value)) value = value;
      else throw new Error(`"${c.field}" must be a number`);
    } else if (c.field === "signed") {
      if (value !== null && typeof value !== "boolean") throw new Error('"signed" must be true, false or empty');
    } else if (value !== null && typeof value !== "string") {
      throw new Error(`"${c.field}" must be text`);
    }
    const before = items[c.index][c.field] ?? null;
    if (JSON.stringify(before) === JSON.stringify(value)) continue; // not actually a change
    items[c.index][c.field] = value;
    overrides.push({
      field_name: `${listKey}[${c.index}].${c.field}`,
      original_ai_value: before, corrected_value: value, reasoning_notes: c.notes?.trim() || null,
    });
  }
  return { extraction: { ...extraction, [listKey]: items }, overrides };
}

// ---- Planning ------------------------------------------------------------

export type PlannedWrite =
  | { op: "update"; table: "vineyard_accounts" | "storehouses" | "holding_tank" | "insurance_policies"; id: string; values: Record<string, unknown>; label: string }
  | { op: "insert"; table: "holding_tank" | "insurance_policies"; values: Record<string, unknown>; label: string; key?: string }
  | { op: "snapshot"; target: { table: "vineyard_accounts" | "storehouses" | "holding_tank"; id?: string; key?: string }; values: Record<string, unknown>; label: string }
  | { op: "upsert"; table: "estate_documents"; onConflict: string; values: Record<string, unknown>; label: string };

export interface InvestmentContext {
  householdId: string;
  members: Member[];
  vineyard: Array<{ id: string; account_name: string; account_number: string | null; contact_id?: string | null }>;
  storehouses: Array<{ id: string; label: string | null; asset_type: string | null; contact_id?: string | null }>;
  holdingTank: Array<{ id: string; account_name: string; account_number: string | null; contact_id?: string | null }>;
  sourceFile: string | null;
  /** The statement's date (YYYY-MM-DD), recorded as the as-of date of the income funds figure. */
  statementDate?: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const dayAfter = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

/**
 * Start-of-year (BOY) snapshots an approved statement supports for one account:
 *  1. the statement's own beginning-of-year figure (book_value, read from the statement's year-to-date column), kept for
 *     the statement's year; and
 *  2. when the statement is a December 31 statement, its closing value as the BOY of the NEXT year (dated Jan 1), the
 *     fallback for accounts whose statements don't print a BOY.
 * A non-positive or missing figure is never written: "no BOY" must not look like a zero start.
 */
export function boySnapshots(a: Record<string, any>, statementDate: string | null | undefined): Array<Record<string, unknown>> {
  if (!statementDate || !ISO_DATE.test(statementDate)) return [];
  const year = Number(statementDate.slice(0, 4));
  const current = typeof a.current_value === "number" && Number.isFinite(a.current_value) ? a.current_value : null;
  const boy = typeof a.book_value === "number" && Number.isFinite(a.book_value) && a.book_value > 0 ? a.book_value : null;
  const out: Array<Record<string, unknown>> = [];
  if (boy !== null && current !== null) {
    const gain = typeof a.current_harvest === "number" && Number.isFinite(a.current_harvest) ? a.current_harvest : current - boy;
    out.push({ reporting_year: year, snapshot_date: statementDate, boy_value: boy, current_value: current, ytd_value: current, current_harvest: gain, boy_source: "statement", notes: "BOY read from the approved statement" });
  }
  if (statementDate.endsWith("-12-31") && current !== null && current > 0) {
    out.push({ reporting_year: year + 1, snapshot_date: dayAfter(statementDate), boy_value: current, current_value: current, ytd_value: current, current_harvest: 0, boy_source: "prior_year_end", notes: "Closing value of the December 31 statement" });
  }
  return out;
}

const numericOnly = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === "number"));

export function planInvestmentApply(accounts: Record<string, any>[], ctx: InvestmentContext): PlannedWrite[] {
  const vByNum = new Map(ctx.vineyard.filter((a) => a.account_number).map((a) => [normalizeToken(a.account_number), a]));
  const vByName = new Map(ctx.vineyard.map((a) => [normalizeToken(a.account_name), a]));
  const sByName = new Map(ctx.storehouses.flatMap((s) => [s.label, s.asset_type].filter(Boolean).map((v) => [normalizeToken(v), s] as const)));
  const hByNum = new Map(ctx.holdingTank.filter((h) => h.account_number).map((h) => [normalizeToken(h.account_number), h]));
  const hByName = new Map(ctx.holdingTank.map((h) => [normalizeToken(h.account_name), h]));
  const head = headOfHousehold(ctx.members);
  const writes: PlannedWrite[] = [];

  for (const a of accounts) {
    const num = normalizeToken(a.account_number);
    const name = normalizeToken(a.account_name);
    const figures = numericOnly({ book_value: a.book_value, current_value: a.current_value });
    const label = String(a.account_name ?? a.account_number ?? "account");
    // Income funds are remembered only when the statement's fund list was proven complete (it adds up
    // to the statement value); an unconfirmed figure is never written. Storehouses have no such column.
    const av = computeAvailability(a);
    const income = av.status === "confirmed" && av.income_funds !== null && /^\d{4}-\d{2}-\d{2}$/.test(ctx.statementDate ?? "")
      ? { income_funds_value: av.income_funds, income_funds_as_of: ctx.statementDate as string }
      : {};
    // Withdrawals from income funds (from the statement's transaction details): kept whenever they were read,
    // since the advisor approves the statement; null (not read) never overwrites a stored figure.
    const withdrawals = av.withdrawals_ytd !== null && /^\d{4}-\d{2}-\d{2}$/.test(ctx.statementDate ?? "")
      ? { withdrawals_ytd: av.withdrawals_ytd, withdrawals_as_of: ctx.statementDate as string }
      : {};

    const live = (num && vByNum.get(num)) || vByName.get(name) || sByName.get(name);
    if (live) {
      const isVineyard = "account_name" in live;
      const values = isVineyard ? { ...figures, ...income, ...withdrawals } : figures;
      if (Object.keys(values).length) writes.push({ op: "update", table: isVineyard ? "vineyard_accounts" : "storehouses", id: live.id, values, label });
      if ((live as any).contact_id) for (const snap of boySnapshots(a, ctx.statementDate)) writes.push({ op: "snapshot", target: { table: isVineyard ? "vineyard_accounts" : "storehouses", id: live.id }, values: { ...snap, contact_id: (live as any).contact_id }, label });
      continue;
    }
    const tank = (num && hByNum.get(num)) || hByName.get(name);
    if (tank) {
      const values = { ...figures, ...income, ...withdrawals };
      if (Object.keys(values).length) writes.push({ op: "update", table: "holding_tank", id: tank.id, values, label });
      if ((tank as any).contact_id) for (const snap of boySnapshots(a, ctx.statementDate)) writes.push({ op: "snapshot", target: { table: "holding_tank", id: tank.id }, values: { ...snap, contact_id: (tank as any).contact_id }, label });
      continue;
    }
    const owner = findMemberByLooseName(ctx.members, a.account_owner) || head;
    const insertKey = `new:${num || name}`;
    writes.push({
      op: "insert", table: "holding_tank", label, key: insertKey,
      values: {
        contact_id: owner?.id, household_id: ctx.householdId, account_name: a.account_name, account_number: a.account_number ?? null,
        account_type: a.account_type || "Portfolio", account_owner: a.account_owner ?? null, custodian: normalizeCustodian(a.custodian),
        book_value: a.book_value ?? null, current_value: a.current_value ?? null, notes: a.notes ?? null,
        source_file: ctx.sourceFile, status: "holding", ...income, ...withdrawals,
      },
    });
    if (owner?.id) for (const snap of boySnapshots(a, ctx.statementDate)) writes.push({ op: "snapshot", target: { table: "holding_tank", key: insertKey }, values: { ...snap, contact_id: owner.id }, label });
    // Register so a duplicate within this same approval matches instead of re-inserting.
    const stub = { id: "pending-insert", account_name: String(a.account_name ?? ""), account_number: a.account_number ?? null };
    if (stub.account_number) hByNum.set(normalizeToken(stub.account_number), stub);
    hByName.set(normalizeToken(stub.account_name), stub);
  }
  // A "pending-insert" match above resolves to an update with a fake id; drop those (the insert already carries the values).
  return writes.filter((w) => !(w.op === "update" && w.id === "pending-insert"));
}

export interface InsuranceContext {
  members: Member[];
  corporations: Array<{ id: string; name: string }>;
  policies: Array<{ id: string; carrier: string; policy_number: string | null; insured_name: string }>;
  vaultFolderId: string | null;
  fileName: string | null;
}

export function planInsuranceApply(policies: Record<string, any>[], ctx: InsuranceContext): PlannedWrite[] {
  const byNumInsured = new Map(ctx.policies.filter((p) => p.policy_number).map((p) => [normalizeToken(`${p.policy_number}${p.insured_name}`), p]));
  const byCarrierInsured = new Map(ctx.policies.map((p) => [normalizeToken(`${p.carrier}${p.insured_name}`), p]));
  const corpByName = new Map(ctx.corporations.map((c) => [normalizeToken(c.name), c]));
  const head = headOfHousehold(ctx.members);
  const writes: PlannedWrite[] = [];

  for (const p of policies) {
    const label = String(p.policy_number ?? p.carrier ?? "policy");
    const update: Record<string, unknown> = {};
    for (const f of ["coverage_amount", "cash_value", "premium_amount"] as const) if (typeof p[f] === "number") update[f] = p[f];
    for (const f of ["premium_frequency", "issue_date", "renewal_date"] as const) if (p[f]) update[f] = p[f];

    const matched =
      (p.policy_number && byNumInsured.get(normalizeToken(`${p.policy_number}${p.insured_name}`))) ||
      byCarrierInsured.get(normalizeToken(`${p.carrier}${p.insured_name}`));
    if (matched) {
      if (matched.id !== "pending-insert" && Object.keys(update).length) writes.push({ op: "update", table: "insurance_policies", id: matched.id, values: update, label });
      continue;
    }
    const member = findMemberByLooseName(ctx.members, p.insured_name);
    const corp = !member ? corpByName.get(normalizeToken(p.insured_name)) : null;
    writes.push({
      op: "insert", table: "insurance_policies", label,
      values: {
        contact_id: corp ? null : (member?.id ?? head?.id ?? null), corporation_id: corp ? corp.id : null,
        carrier: p.carrier, policy_number: p.policy_number ?? null, policy_type: p.policy_type || "other", insured_name: p.insured_name,
        coverage_amount: p.coverage_amount ?? 0, cash_value: p.cash_value ?? 0, premium_amount: p.premium_amount ?? null,
        premium_frequency: p.premium_frequency ?? null, issue_date: p.issue_date ?? null, renewal_date: p.renewal_date ?? null,
        notes: `Created from approved V2 review of "${ctx.fileName ?? "document"}".`, vault_folder_id: ctx.vaultFolderId,
      },
    });
    const stub = { id: "pending-insert", carrier: String(p.carrier ?? ""), policy_number: p.policy_number ?? null, insured_name: String(p.insured_name ?? "") };
    if (stub.policy_number) byNumInsured.set(normalizeToken(`${stub.policy_number}${stub.insured_name}`), stub);
    byCarrierInsured.set(normalizeToken(`${stub.carrier}${stub.insured_name}`), stub);
  }
  return writes;
}

export interface EstateContext {
  householdId: string;
  members: Member[];
  driveId: string | null;
  fileName: string | null;
  auditId: string | null;
  approvedBy: string | null;
}

const ESTATE_TYPE_SET = new Set(["will", "power_of_attorney", "trust", "representation_agreement", "other"]);

/** Approved estate documents become (or refresh) one row per file and type, owned by the matching member. */
export function planEstateApply(documents: Record<string, any>[], ctx: EstateContext): PlannedWrite[] {
  if (!ctx.driveId) return []; // nothing to key the record on (not a Vault file)
  const writes: PlannedWrite[] = [];
  const seen = new Set<string>();
  for (const d of documents) {
    const type = ESTATE_TYPE_SET.has(String(d.document_type)) ? String(d.document_type) : "other";
    if (seen.has(type)) continue; // one row per file and type (the unique key); the first wins
    seen.add(type);
    const member = findMemberByLooseName(ctx.members, d.subject_name);
    writes.push({
      op: "upsert", table: "estate_documents", onConflict: "drive_id,document_type",
      label: `${type}${d.subject_name ? ` (${d.subject_name})` : ""}`,
      values: {
        household_id: ctx.householdId, contact_id: member?.id ?? null, document_type: type,
        subject_name: d.subject_name ?? null, document_date: ISO_DATE.test(String(d.document_date ?? "")) ? d.document_date : null,
        signed: typeof d.signed === "boolean" ? d.signed : null, executor: d.executor ?? null,
        beneficiaries: d.beneficiaries ?? null, notes: d.notes ?? null,
        drive_id: ctx.driveId, file_name: ctx.fileName, source_audit_id: ctx.auditId, approved_by: ctx.approvedBy,
        updated_at: new Date().toISOString(),
      },
    });
  }
  return writes;
}

// ---- Execution -----------------------------------------------------------

export interface ApplyResult { updated: number; inserted: number; writes: Array<{ op: string; table: string; label: string }> }

const SNAPSHOT_KEY = { vineyard_accounts: "vineyard_account_id", holding_tank: "holding_tank_id", storehouses: "storehouse_id" } as const;

export async function applyPlan(admin: any, plan: PlannedWrite[]): Promise<ApplyResult> {
  const result: ApplyResult = { updated: 0, inserted: 0, writes: [] };
  const insertedIds = new Map<string, string>();
  for (const w of plan) {
    if (w.op === "snapshot") {
      // A start-of-year snapshot is a record kept alongside the account, so a failure here never undoes the approval.
      try {
        const id = w.target.id ?? (w.target.key ? insertedIds.get(w.target.key) : undefined);
        if (!id || id === "pending-insert") continue;
        const keyField = SNAPSHOT_KEY[w.target.table];
        const { data: existing, error: selErr } = await admin.from("account_harvest_snapshots").select("id").eq(keyField, id).eq("snapshot_date", w.values.snapshot_date).limit(1);
        if (selErr) throw new Error(selErr.message);
        const row = { ...w.values, [keyField]: id };
        const { error } = existing?.[0]?.id ? await admin.from("account_harvest_snapshots").update(row).eq("id", existing[0].id) : await admin.from("account_harvest_snapshots").insert(row);
        if (error) throw new Error(error.message);
        result.writes.push({ op: "snapshot", table: "account_harvest_snapshots", label: w.label });
      } catch (e) {
        console.error("vault-apply: BOY snapshot not saved:", w.label, e instanceof Error ? e.message : String(e));
      }
      continue;
    }
    if (w.op === "insert") {
      // The new row's id is only fetched when a later snapshot needs it.
      const { data, error } = w.key ? await admin.from(w.table).insert(w.values).select("id").maybeSingle() : await admin.from(w.table).insert(w.values);
      if (error) throw new Error(`insert ${w.table} (${w.label}) failed: ${error.message}`);
      if (w.key && (data as { id?: string } | null)?.id) insertedIds.set(w.key, (data as { id: string }).id);
      result.inserted += 1;
      result.writes.push({ op: w.op, table: w.table, label: w.label });
      continue;
    }
    const q = w.op === "update" ? admin.from(w.table).update(w.values).eq("id", w.id) : admin.from(w.table).upsert(w.values, { onConflict: w.onConflict });
    const { error } = await q;
    if (error) throw new Error(`${w.op} ${w.table} (${w.label}) failed: ${error.message}`);
    if (w.op === "update") result.updated += 1; else result.inserted += 1; // an upsert counts as added
    result.writes.push({ op: w.op, table: w.table, label: w.label });
  }
  return result;
}
