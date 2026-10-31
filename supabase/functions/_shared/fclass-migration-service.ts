// fclass-migration-service.ts: reads the migration plan sheet and matches its accounts to households. Reads only.
// The sheet is read through the same Google connection as the meeting notes; nothing is written back to it.

import { getServiceGoogleAccessToken } from "./google-token.ts";
import { digits } from "./fclass-migration.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

const DRIVE = "https://www.googleapis.com/drive/v3";
/** "PWA 3.0 - Migration Plan" (a sheet with one tab, Data). */
export const MIGRATION_SHEET_ID = "1ePW7EoSKFjwtJX3h7FyILBQQZ9aLZsOjBv3rt36gR3A";
const TIMEOUT_MS = 30_000;

/** The first tab of the sheet as CSV. */
export async function loadMigrationCsv(db: SupabaseClient, sheetId: string = MIGRATION_SHEET_ID): Promise<string> {
  const token = await getServiceGoogleAccessToken(db);
  const res = await fetch(`${DRIVE}/files/${sheetId}/export?${new URLSearchParams({ mimeType: "text/csv", supportsAllDrives: "true" })}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Could not read the migration sheet [${res.status}]`);
  return await res.text();
}

/** Account number (digits only) -> household id, from the investment accounts and the holding tank. */
export async function accountHouseholds(db: SupabaseClient, activeHouseholds: Set<string>): Promise<Map<string, string>> {
  const [{ data: vine, error: e1 }, { data: tank, error: e2 }, { data: contacts, error: e3 }] = await Promise.all([
    db.from("vineyard_accounts").select("account_number, contact_id").not("account_number", "is", null).limit(5000),
    db.from("holding_tank").select("account_number, contact_id").not("account_number", "is", null).limit(5000),
    db.from("contacts").select("id, household_id").not("household_id", "is", null).limit(5000),
  ]);
  const err = e1 || e2 || e3;
  if (err) throw new Error(`Could not match accounts to households: ${err.message}`);
  // deno-lint-ignore no-explicit-any
  const household = new Map<string, string>(((contacts ?? []) as any[]).map((c) => [c.id as string, c.household_id as string]));
  const out = new Map<string, string>();
  // deno-lint-ignore no-explicit-any
  for (const a of [...((vine ?? []) as any[]), ...((tank ?? []) as any[])]) {
    const hh = household.get(a.contact_id);
    const key = digits(String(a.account_number ?? ""));
    if (hh && key && activeHouseholds.has(hh)) out.set(key, hh);
  }
  return out;
}
