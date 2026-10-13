// bulk-import-performance: the monthly import of iA's performance export (plus JustWealth rows added by hand).
//   preview  matches every row to an account and reports, per row, last month's value, this month's value and the change.
//            Routine rows are marked "update"; a move beyond 25%, a drop to zero or a negative value is an "exception" that a
//            person must approve; accounts that are in the system but missing from the file are listed.
//   commit   writes the monthly snapshot and the account's current value for every routine row, and for each exception whose
//            contract number is in `approved_exceptions`. Exceptions not approved are skipped and reported.
// The rules live in _shared/monthly-import.ts (unit-tested).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  CHANGE_THRESHOLD, MANAGED_CUSTODIANS, classifyChange, duplicateContracts, missingFromFile, monthCheck, normalizeCustodian, resolveBoy, yearToDatePct,
  type ExpectedAccount,
} from "../_shared/monthly-import.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
};

interface PerfRow {
  contract: string;
  last_name: string;
  first_name: string;
  product?: string;
  registration?: string;
  custodian?: string | null;
  issue_date?: string | null;
  boy_value?: number | null;
  current_value?: number | null;
  variation_pct?: number | null;
  variation_dollar?: number | null;
  ror_ytd?: number | null;
  ror_6m?: number | null;
  ror_1y?: number | null;
  ror_3y?: number | null;
  ror_5y?: number | null;
  ror_since_inception?: number | null;
  raw_note?: string;
}

type LineStatus = "update" | "new_account" | "exception" | "unmatched" | "no_data" | "duplicate";

interface Line {
  contract: string;
  name: string;
  owner: string | null;
  custodian: string | null;
  registration: string | null;
  previous: number | null;
  current: number | null;
  change_pct: number | null;
  status: LineStatus;
  reason: string | null;
  already_imported: boolean;
}

function normName(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z]/g, "");
}
function toNum(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    const { mode = "preview", snapshot_date, rows, source_file, approved_exceptions } = await req.json();
    if (!snapshot_date) throw new Error("snapshot_date required (YYYY-MM-DD)");
    if (!Array.isArray(rows)) throw new Error("rows[] required");
    const approved = new Set<string>((Array.isArray(approved_exceptions) ? approved_exceptions : []).map((c: unknown) => String(c).trim()));

    const [{ data: htRows }, { data: vyRows }, { data: contacts }, { data: snaps }] = await Promise.all([
      supabase.from("holding_tank").select("id, contact_id, account_number, account_name, household_id, custodian, current_value, book_value, status"),
      supabase.from("vineyard_accounts").select("id, contact_id, account_number, account_name, account_type, custodian, current_value, book_value"),
      supabase.from("contacts").select("id, first_name, last_name, full_name, family_id, household_id"),
      supabase.from("account_harvest_snapshots").select("holding_tank_id, vineyard_account_id, snapshot_date, current_value, boy_value, reporting_year"),
    ]);

    const htByContract = new Map<string, any>();
    (htRows || []).forEach((r: any) => r.account_number && htByContract.set(String(r.account_number).trim(), r));
    const vyByContract = new Map<string, any>();
    (vyRows || []).forEach((r: any) => r.account_number && vyByContract.set(String(r.account_number).trim(), r));
    const contactById = new Map<string, any>((contacts || []).map((c: any) => [c.id, c]));
    const contactByName = new Map<string, any>();
    (contacts || []).forEach((c: any) => {
      const k = normName((c.first_name || "") + (c.last_name || ""));
      if (k) contactByName.set(k, c);
    });
    const ownerName = (id: string | null | undefined) => {
      const c = id ? contactById.get(id) : null;
      return c ? (c.full_name || `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || null) : null;
    };

    // Snapshots per account: the latest before this date (last month's value) and any already on this date.
    const year = new Date(snapshot_date).getUTCFullYear();
    const keyOf = (s: any) => (s.vineyard_account_id ? `vy:${s.vineyard_account_id}` : s.holding_tank_id ? `ht:${s.holding_tank_id}` : null);
    const prevSnap = new Map<string, any>();
    const sameDate = new Set<string>();
    let latestImported: string | null = null;
    for (const s of snaps || []) {
      const k = keyOf(s);
      if (!k) continue;
      if (!latestImported || s.snapshot_date > latestImported) latestImported = s.snapshot_date;
      if (s.snapshot_date === snapshot_date) sameDate.add(k);
      else if (s.snapshot_date < snapshot_date) {
        const cur = prevSnap.get(k);
        if (!cur || s.snapshot_date > cur.snapshot_date) prevSnap.set(k, s);
      }
    }
    const sameYearBoy = (k: string): number | null => {
      const s = prevSnap.get(k);
      return s && Number(s.reporting_year) === year ? toNum(s.boy_value) : null;
    };

    const report: Record<string, any> = {
      snapshot_date,
      total_rows: rows.length,
      matched_holding: 0,
      matched_vineyard: 0,
      auto_created_holding: 0,
      updated_existing: 0,
      skipped_no_data: 0,
      exceptions: 0,
      threshold_pct: CHANGE_THRESHOLD * 100,
      unmatched_no_contact: [] as any[],
      lines: [] as Line[],
      missing: [] as any[],
      warnings: monthCheck(snapshot_date, latestImported, new Date()),
    };

    interface Op {
      row: PerfRow;
      line: Line;
      target?: { table: "holding_tank" | "vineyard_accounts"; id: string; contact_id: string; book_value: number | null };
      needsHt?: { contact_id: string; household_id?: string | null; account_name: string; account_number: string; account_type: string; custodian: string };
      snapKey?: string;
    }
    const ops: Op[] = [];
    const contractsInFile = (rows as PerfRow[]).map((r) => String(r.contract || "").trim()).filter(Boolean);
    const dups = duplicateContracts(contractsInFile);
    const seenOnce = new Set<string>();

    for (const r of rows as PerfRow[]) {
      const contract = String(r.contract || "").trim();
      if (!contract) continue;
      const name = `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim();
      const base = { contract, name, registration: r.registration || r.product || null, current: toNum(r.current_value), previous: null as number | null, change_pct: null as number | null, already_imported: false };
      if (dups.has(contract) && seenOnce.has(contract)) {
        report.lines.push({ ...base, owner: null, custodian: null, status: "duplicate", reason: "this contract number appears more than once in the file; only the first row is used" } as Line);
        continue;
      }
      seenOnce.add(contract);

      if (r.boy_value == null && r.current_value == null) {
        report.skipped_no_data++;
        report.lines.push({ ...base, owner: null, custodian: null, status: "no_data", reason: "no balance in this row" } as Line);
        continue;
      }
      if (toNum(r.current_value) === null) {
        report.skipped_no_data++;
        report.lines.push({ ...base, owner: null, custodian: null, status: "no_data", reason: "no current balance in this row" } as Line);
        continue;
      }

      const vy = vyByContract.get(contract);
      const ht = vy ? null : htByContract.get(contract);
      const acct = vy ?? ht;
      if (acct) {
        const table = vy ? "vineyard_accounts" : "holding_tank";
        const snapKey = `${vy ? "vy" : "ht"}:${acct.id}`;
        const prev = prevSnap.get(snapKey);
        const previous = prev ? toNum(prev.current_value) : toNum(acct.current_value);
        const verdict = classifyChange(previous, base.current);
        const already = sameDate.has(snapKey);
        const line: Line = {
          ...base, owner: ownerName(acct.contact_id), custodian: acct.custodian ?? normalizeCustodian(r.custodian), previous, change_pct: verdict.changePct,
          status: verdict.exception ? "exception" : "update", reason: verdict.exception ? verdict.reason : null, already_imported: already,
        };
        if (already) report.updated_existing++; else if (vy) report.matched_vineyard++; else report.matched_holding++;
        if (verdict.exception) report.exceptions++;
        report.lines.push(line);
        ops.push({ row: r, line, target: { table, id: acct.id, contact_id: acct.contact_id, book_value: toNum(acct.book_value) }, snapKey });
        continue;
      }

      // No account with this contract number: find the owner by name and create a holding-tank stub.
      const c = contactByName.get(normName((r.first_name ?? "") + (r.last_name ?? "")));
      if (!c) {
        report.unmatched_no_contact.push({ contract, first: r.first_name, last: r.last_name, registration: r.registration });
        report.lines.push({ ...base, owner: null, custodian: normalizeCustodian(r.custodian), status: "unmatched", reason: "no account with this contract number and no contact with this name" } as Line);
        continue;
      }
      report.auto_created_holding++;
      const custodian = normalizeCustodian(r.custodian) ?? "iA Financial Group";
      const line: Line = { ...base, owner: ownerName(c.id), custodian, status: "new_account", reason: "new account, will be added to the Holding Tank for review", already_imported: false };
      report.lines.push(line);
      ops.push({
        row: r, line,
        needsHt: {
          contact_id: c.id, household_id: c.household_id, account_name: `${custodian === "JustWealth" ? "JustWealth" : "iA"} ${r.registration || r.product || "Account"} · ${contract} (AUTO)`,
          account_number: contract, account_type: r.registration || r.product || "Portfolio", custodian,
        },
      });
    }

    // Accounts in the system, at a managed custodian, that the file does not contain.
    const expected: ExpectedAccount[] = [
      ...(vyRows || []).map((a: any) => ({ id: a.id, table: "vineyard_accounts", accountNumber: String(a.account_number ?? ""), custodian: a.custodian ?? null, label: a.account_name ?? a.account_type ?? "Account", owner: ownerName(a.contact_id) ?? "" })),
      ...(htRows || []).filter((a: any) => a.status !== "moved").map((a: any) => ({ id: a.id, table: "holding_tank", accountNumber: String(a.account_number ?? ""), custodian: a.custodian ?? null, label: a.account_name ?? "Account", owner: ownerName(a.contact_id) ?? "" })),
    ];
    report.missing = missingFromFile(expected, contractsInFile);
    report.unchecked_custodian = expected.filter((a) => a.accountNumber && !MANAGED_CUSTODIANS.includes(a.custodian ?? "")).length;

    if (mode === "preview") return json({ ok: true, report });

    // COMMIT: routine rows, and exceptions a person approved.
    const commit = { snapshots_inserted: 0, snapshots_updated: 0, ht_created: 0, skipped_exceptions: [] as string[], errors: [] as any[] };
    for (const op of ops) {
      if (op.line.status === "exception" && !approved.has(op.line.contract)) {
        commit.skipped_exceptions.push(op.line.contract);
        continue;
      }
      try {
        let holding_tank_id: string | null = null;
        let vineyard_account_id: string | null = null;
        let contact_id: string;
        let accountBook: number | null = null;
        let snapKey = op.snapKey ?? "";

        if (op.needsHt) {
          const { data: newHt, error: he } = await supabase.from("holding_tank").insert({
            ...op.needsHt,
            status: "holding",
            notes: `AUTO-CREATED from performance file ${source_file || snapshot_date}. Needs advisor review to link contact/household.`,
            source_file: source_file || `perf-${snapshot_date}`,
          }).select("id, contact_id").single();
          if (he) throw he;
          commit.ht_created++;
          holding_tank_id = newHt.id;
          contact_id = newHt.contact_id;
          snapKey = `ht:${newHt.id}`;
        } else if (op.target) {
          if (op.target.table === "holding_tank") holding_tank_id = op.target.id; else vineyard_account_id = op.target.id;
          contact_id = op.target.contact_id;
          accountBook = op.target.book_value;
        } else continue;

        const row = op.row;
        const cur = toNum(row.current_value) ?? 0;
        const rowBoy = typeof row.boy_value === "string" ? null : toNum(row.boy_value);
        const boy = resolveBoy({ rowBoy, sameYearSnapshotBoy: sameYearBoy(snapKey), accountBook, current: cur });
        const harvest = toNum(row.variation_dollar) ?? cur - boy;
        // Source file stores percentages as decimal fractions (0.1327 = 13.27%). The app expects percentage numbers.
        const pct = (v: any): number | null => { const n = toNum(v); return n == null ? null : n * 100; };
        const ytdVal = pct(row.variation_pct) ?? yearToDatePct(boy, cur);

        const snapshotPayload: any = {
          contact_id, holding_tank_id, vineyard_account_id, snapshot_date, reporting_year: year,
          boy_value: boy, current_value: cur, current_harvest: harvest, ytd_value: ytdVal,
          ror_ytd: pct(row.ror_ytd), ror_6m: pct(row.ror_6m), ror_1y: pct(row.ror_1y), ror_3y: pct(row.ror_3y), ror_5y: pct(row.ror_5y),
          ror_since_inception: pct(row.ror_since_inception),
          notes: source_file ? `Import: ${source_file}` : null,
          created_by: user.id,
        };

        // Update the snapshot if one exists for this account and date, otherwise insert.
        let existingSnapId: string | null = null;
        const q = supabase.from("account_harvest_snapshots").select("id").eq("snapshot_date", snapshot_date);
        const { data: es } = holding_tank_id ? await q.eq("holding_tank_id", holding_tank_id).maybeSingle() : await q.eq("vineyard_account_id", vineyard_account_id!).maybeSingle();
        existingSnapId = es?.id ?? null;
        if (existingSnapId) {
          const { error: ue } = await supabase.from("account_harvest_snapshots").update(snapshotPayload).eq("id", existingSnapId);
          if (ue) throw ue;
          commit.snapshots_updated++;
        } else {
          const { error: se } = await supabase.from("account_harvest_snapshots").insert(snapshotPayload);
          if (se) throw se;
          commit.snapshots_inserted++;
        }

        // Also update the account row so dashboards show the current value. Book value changes only when the file gave a real one.
        const updatePayload: any = { current_value: cur, updated_at: new Date().toISOString() };
        if (rowBoy !== null) updatePayload.book_value = rowBoy;
        if (holding_tank_id) await supabase.from("holding_tank").update(updatePayload).eq("id", holding_tank_id);
        else await supabase.from("vineyard_accounts").update(updatePayload).eq("id", vineyard_account_id!);
      } catch (e) {
        commit.errors.push({ contract: op.row.contract, error: (e as Error).message });
      }
    }

    return json({ ok: true, report, commit });
  } catch (e) {
    console.error("bulk-import-performance error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
