// bulk-import-performance: the monthly import of iA's performance export (plus JustWealth rows added by hand).
//   preview  matches every row to an account and reports, per row, last month's value, this month's value and the change.
//            Routine rows are marked "update"; a move beyond 25%, a drop to zero or a negative value is an "exception" that a
//            person must approve; accounts that are in the system but missing from the file are listed.
//   commit   writes the monthly snapshot and the account's current value for every routine row, and for each exception whose
//            contract number is in `approved_exceptions`. Exceptions not approved are skipped and reported.
//   close    sets accounts that left the file to $0 at the month-end.
//   watch    (Georgia, every 30 minutes, cron secret) looks in the Drive folder for a new file, reads it, runs the preview, applies the
//            file-level checks and tells Rolf; reminds him on the first business day to download the file. In mode "auto" a file that passes
//            every check commits its routine rows by itself. Exceptions, new accounts and missing accounts always wait for a person.
//   runs / loadRun / undo   the history of imports, a prepared file's rows for the importer page, and putting a bad import back.
// Every commit records what it replaced (monthly_import_undo). The rules live in _shared/monthly-import.ts (unit-tested).

import "../_shared/bc-time.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { driveDownloadFile, driveListChildren } from "../_shared/vault-provisioning.ts";
import { getServiceGoogleAccessToken } from "../_shared/google-token.ts";
import { sendServiceEmailDetailed } from "../_shared/service-email.ts";
import { AGENT_SENDER } from "../_shared/onboarding-agent.ts";
import { pacificDate } from "../_shared/review-windows.ts";
import { parsePerformanceGrid } from "../_shared/performance-file-parse.ts";
import { fileChecks, reminderFor } from "../_shared/monthly-import-checks.ts";
import { undoRun } from "../_shared/monthly-import-undo.ts";
import {
  closeSnapshotRow, CHANGE_THRESHOLD, MANAGED_CUSTODIANS, classifyChange, duplicateContracts, missingFromFile, monthCheck, normalizeCustodian, resolveBoy, yearToDatePct,
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

interface ImportArgs {
  mode: "preview" | "commit"; snapshot_date: string; rows: PerfRow[]; source_file?: string | null; approved: Set<string>; userId: string | null;
  /** The monthly_import_runs row this commit belongs to: what it replaces is logged against it. */
  runId?: string | null;
  /** Commit only routine updates (no new accounts): what Georgia does when she commits by herself. */
  onlyRoutine?: boolean;
}

// `supabase` reads and writes the accounts (as the staff member, or as the service role for Georgia); `admin` is the service role, for the run log.
// deno-lint-ignore no-explicit-any
async function performImport(supabase: any, admin: any, a: ImportArgs): Promise<{ report: Record<string, any>; commit?: any }> {
  const { mode, snapshot_date, rows, source_file, userId } = a;
  const approved = a.approved;

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
    target?: { table: "holding_tank" | "vineyard_accounts"; id: string; contact_id: string; book_value: number | null; current_value: number | null };
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
      ops.push({ row: r, line, target: { table, id: acct.id, contact_id: acct.contact_id, book_value: toNum(acct.book_value), current_value: toNum(acct.current_value) }, snapKey });
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

  if (mode === "preview") return { report };

  // COMMIT: routine rows, and exceptions a person approved.
  // What each write replaces, so the whole import can be put back.
  const undo: { kind: string; table_name: string; row_id: string; previous: unknown }[] = [];
  const commit = { snapshots_inserted: 0, snapshots_updated: 0, ht_created: 0, skipped_exceptions: [] as string[], errors: [] as any[] };
  for (const op of ops) {
    // A file Georgia commits by herself takes only the routine updates: new accounts wait for a person.
    if (a.onlyRoutine && op.line.status === "new_account") { commit.skipped_exceptions.push(op.line.contract); continue; }
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
        undo.push({ kind: "account_created", table_name: "holding_tank", row_id: newHt.id, previous: null });
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
        created_by: userId,
      };

      // Update the snapshot if one exists for this account and date, otherwise insert.
      let existingSnapId: string | null = null;
      const q = supabase.from("account_harvest_snapshots").select("*").eq("snapshot_date", snapshot_date);
      const { data: es } = holding_tank_id ? await q.eq("holding_tank_id", holding_tank_id).maybeSingle() : await q.eq("vineyard_account_id", vineyard_account_id!).maybeSingle();
      existingSnapId = es?.id ?? null;
      if (existingSnapId) {
        undo.push({ kind: "snapshot_replaced", table_name: "account_harvest_snapshots", row_id: existingSnapId, previous: es });
        const { error: ue } = await supabase.from("account_harvest_snapshots").update(snapshotPayload).eq("id", existingSnapId);
        if (ue) throw ue;
        commit.snapshots_updated++;
      } else {
        const { data: made, error: se } = await supabase.from("account_harvest_snapshots").insert(snapshotPayload).select("id").single();
        if (se) throw se;
        if (made?.id) undo.push({ kind: "snapshot_created", table_name: "account_harvest_snapshots", row_id: made.id, previous: null });
        commit.snapshots_inserted++;
      }

      // Also update the account row so dashboards show the current value. Book value changes only when the file gave a real one.
      const updatePayload: any = { current_value: cur, updated_at: new Date().toISOString() };
      if (rowBoy !== null) updatePayload.book_value = rowBoy;
      // The account row as it was, unless this import created it.
      if (op.target) undo.push({ kind: "account", table_name: op.target.table, row_id: op.target.id, previous: { current_value: op.target.current_value, book_value: op.target.book_value } });
      if (holding_tank_id) await supabase.from("holding_tank").update(updatePayload).eq("id", holding_tank_id);
      else await supabase.from("vineyard_accounts").update(updatePayload).eq("id", vineyard_account_id!);
    } catch (e) {
      commit.errors.push({ contract: op.row.contract, error: (e as Error).message });
    }
  }

  if (a.runId && undo.length) {
    for (let i = 0; i < undo.length; i += 500) await admin.from("monthly_import_undo").insert(undo.slice(i, i + 500).map((u) => ({ run_id: a.runId, ...u })));
  }
  return { report, commit };
}

// ───── Georgia's monthly-import watcher, the run log and undo ─────

const SERVICE = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const NOTIFY_EMAIL = "rolf@prosperwise.ca";
const pacificHour = (ms: number) => Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", hour: "2-digit", hour12: false }).format(new Date(ms)));

/** Counts the preview report for the notification and the run record. */
// deno-lint-ignore no-explicit-any
function summarize(report: Record<string, any>) {
  const lines: Line[] = report.lines ?? [];
  const by = (st: LineStatus) => lines.filter((l) => l.status === st);
  return {
    total_rows: report.total_rows ?? lines.length,
    routine: by("update").length,
    exceptions: by("exception").length,
    new_accounts: by("new_account").length,
    unmatched: (report.unmatched_no_contact ?? []).length,
    missing: (report.missing ?? []).length,
    no_data: by("no_data").length,
    exception_list: by("exception").slice(0, 8).map((l) => `${l.name} #${l.contract}: ${l.reason}`),
    missing_list: (report.missing ?? []).slice(0, 8).map((m: { accountNumber: string; owner: string; label: string }) => `${m.owner || "no owner"} #${m.accountNumber} ${m.label}`),
  };
}

// deno-lint-ignore no-explicit-any
async function tell(admin: any, title: string, body: string, subject: string) {
  await admin.from("staff_notifications").insert({ title, body, link: "/importers", source_type: "monthly_import" });
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const sent = await sendServiceEmailDetailed(admin, {
    to: NOTIFY_EMAIL, subject, from: AGENT_SENDER,
    html: `<div style="font-family:'DM Sans',sans-serif;color:#334155;max-width:560px;"><p style="font-size:14px;line-height:1.6;">Hi Rolf,</p><p style="font-size:14px;line-height:1.6;white-space:pre-line;">${esc(body)}</p><p style="font-size:14px;line-height:1.6;">Georgia<br/><span style="font-size:12px;color:#94a3b8;">AI Assistant, ProsperWise</span></p></div>`,
  });
  // The notification above is the record; if the email fails say so in the log rather than silently.
  if (!sent.ok) console.error("[bulk-import-performance] email to Rolf failed");
}

/** What the last import looked like, to compare a new file with: the last committed run, else the newest snapshots on file. */
// deno-lint-ignore no-explicit-any
async function lastImportFacts(admin: any): Promise<{ snapshotDate: string; rowCount: number; totalValue: number } | null> {
  const { data: run } = await admin.from("monthly_import_runs").select("snapshot_date, summary").eq("status", "committed").order("snapshot_date", { ascending: false }).limit(1).maybeSingle();
  if (run?.summary?.total_rows && run.summary.total_value) return { snapshotDate: run.snapshot_date, rowCount: Number(run.summary.total_rows), totalValue: Number(run.summary.total_value) };
  const { data: latest } = await admin.from("account_harvest_snapshots").select("snapshot_date").order("snapshot_date", { ascending: false }).limit(1).maybeSingle();
  if (!latest?.snapshot_date) return null;
  const { data: snaps } = await admin.from("account_harvest_snapshots").select("current_value").eq("snapshot_date", latest.snapshot_date).not("current_value", "is", null);
  const total = (snaps ?? []).reduce((n: number, r: { current_value: number }) => n + (Number(r.current_value) || 0), 0);
  return { snapshotDate: latest.snapshot_date, rowCount: (snaps ?? []).length, totalValue: total };
}

// deno-lint-ignore no-explicit-any
async function watch(admin: any) {
  const { data: cfg } = await admin.from("monthly_import_config").select("*").eq("id", true).maybeSingle();
  if (!cfg || cfg.mode === "off" || !cfg.drive_folder_id) return { ok: true, mode: cfg?.mode ?? "off", did: [] as string[] };
  const did: string[] = [];
  const now = Date.now();
  const today = pacificDate(now);
  const token = await getServiceGoogleAccessToken(admin);

  // 1. A new file in the folder.
  const files = (await driveListChildren(cfg.drive_folder_id, token)).filter((f) => /\.xlsx?$/i.test(f.name ?? ""));
  const { data: seen } = await admin.from("monthly_import_runs").select("drive_file_id").not("drive_file_id", "is", null);
  const seenIds = new Set((seen ?? []).map((r: { drive_file_id: string }) => r.drive_file_id));
  for (const f of files) {
    if (seenIds.has(f.id)) continue;
    try {
      const XLSX = await import("https://esm.sh/xlsx@0.18.5");
      const wb = XLSX.read(new Uint8Array(await driveDownloadFile(f.id, token)), { type: "array", cellDates: true });
      const grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null }) as unknown[][];
      const parsed = parsePerformanceGrid(grid, f.name);
      if (parsed.error || !parsed.snapshotDate) {
        await admin.from("monthly_import_runs").insert({ drive_file_id: f.id, file_name: f.name, snapshot_date: today, status: "error", checks: [parsed.error ?? "No date in the file name or the As of column."] });
        await tell(admin, `Monthly file could not be read: ${f.name}`, `I couldn't read ${f.name}: ${parsed.error ?? "it has no date I can find"}. Please check it and drop it in again.`, "The monthly file couldn't be read");
        did.push(`unreadable ${f.name}`);
        continue;
      }
      const rows = parsed.rows as PerfRow[];
      const { report } = await performImport(admin, admin, { mode: "preview", snapshot_date: parsed.snapshotDate, rows, source_file: f.name, approved: new Set(), userId: null });
      const summary = summarize(report);
      const facts = { snapshotDate: parsed.snapshotDate, rowCount: rows.length, totalValue: rows.reduce((n, r) => n + (toNum(r.current_value) ?? 0), 0), duplicateContracts: (report.lines as Line[]).filter((l) => l.status === "duplicate").length };
      const verdict = fileChecks(facts, await lastImportFacts(admin), today);
      const { data: run } = await admin.from("monthly_import_runs").insert({
        drive_file_id: f.id, file_name: f.name, snapshot_date: parsed.snapshotDate, source: "georgia", status: verdict.ok ? "ready" : "held",
        checks: verdict.problems, summary: { ...summary, total_value: facts.totalValue }, rows,
      }).select("id").single();

      let committedNote = "";
      if (cfg.mode === "auto" && verdict.ok && run) {
        const { commit } = await performImport(admin, admin, { mode: "commit", snapshot_date: parsed.snapshotDate, rows, source_file: f.name, approved: new Set(), userId: null, runId: run.id, onlyRoutine: true });
        await admin.from("monthly_import_runs").update({ status: "committed", committed_at: new Date().toISOString(), committed_by: "Georgia" }).eq("id", run.id);
        committedNote = `\nI committed the routine rows (${commit.snapshots_inserted + commit.snapshots_updated} balances). If anything looks wrong you can undo the whole import on the Importers page.`;
      }
      const lines = [
        `I read ${f.name} (as of ${parsed.snapshotDate}): ${summary.total_rows} accounts.`,
        verdict.ok ? "The file passed every check." : `I am holding this file because: ${verdict.problems.join(" ")}`,
        `${summary.routine} routine update${summary.routine === 1 ? "" : "s"}. ${summary.exceptions} large move${summary.exceptions === 1 ? "" : "s"} need your approval, ${summary.new_accounts} new account${summary.new_accounts === 1 ? "" : "s"}, ${summary.unmatched} row${summary.unmatched === 1 ? "" : "s"} I can't match to anyone. ${summary.missing} account${summary.missing === 1 ? "" : "s"} we hold ${summary.missing === 1 ? "is" : "are"} not in this file.`,
        ...(summary.exception_list.length ? ["", "Large moves:", ...summary.exception_list] : []),
        ...(summary.missing_list.length ? ["", "Missing from this file:", ...summary.missing_list] : []),
        committedNote || "\nNothing has been written yet. Open Importers, load the prepared file, approve the exceptions and commit.",
      ];
      const needYou = summary.exceptions + summary.missing + summary.new_accounts;
      await tell(admin, `Monthly file ${verdict.ok ? "ready" : "HELD"}: ${parsed.snapshotDate}${needYou > 0 ? ` (${needYou} need you)` : ""}`, lines.join("\n"), `Monthly file ${verdict.ok ? "ready" : "held"}: ${parsed.snapshotDate}`);
      did.push(`${verdict.ok ? "prepared" : "held"} ${f.name}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await admin.from("monthly_import_runs").insert({ drive_file_id: f.id, file_name: f.name, snapshot_date: today, status: "error", checks: [message] });
      await tell(admin, `Monthly file failed: ${f.name}`, `I hit a problem reading ${f.name}: ${message}`, "The monthly file failed");
      did.push(`error ${f.name}`);
    }
  }

  // 2. The reminder to download the file, from 8am Pacific, on the first business day (and the third if nothing has arrived).
  const hour = pacificHour(now);
  if (hour >= 8 && hour < 18) {
    const month = today.slice(0, 7);
    const { data: thisMonth } = await admin.from("monthly_import_runs").select("id").gte("created_at", `${month}-01T00:00:00-08:00`).limit(1);
    const { data: rem } = await admin.from("monthly_import_reminders").select("*").eq("month", month).maybeSingle();
    const r = reminderFor(today, (thisMonth ?? []).length > 0, { download: !!rem?.download_sent_at, late: !!rem?.late_sent_at });
    if (r.kind) {
      const folder = `https://drive.google.com/drive/folders/${cfg.drive_folder_id}`;
      await tell(admin,
        r.kind === "download" ? "Time to download the monthly performance file" : "The monthly performance file has not arrived",
        r.kind === "download"
          ? `Please download this month's performance file from iA and drop it in the Georgia - Monthly Imports folder:\n${folder}\nI'll read it as soon as it lands and tell you what needs you.`
          : `It's the third business day and there's no file in the folder yet. Please download it from iA and drop it in:\n${folder}`,
        r.kind === "download" ? "Monthly file: time to download" : "Monthly file: still waiting");
      await admin.from("monthly_import_reminders").upsert({ month, ...(rem ?? {}), [r.kind === "download" ? "download_sent_at" : "late_sent_at"]: new Date().toISOString() }, { onConflict: "month" });
      did.push(`reminded: ${r.kind}`);
    }
  }
  return { ok: true, mode: cfg.mode, did };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    // Georgia's schedule (cron secret): no signed-in user.
    const cronSecret = Deno.env.get("MONTHLY_IMPORT_CRON_SECRET");
    if (cronSecret && req.headers.get("x-monthly-import-cron-secret") === cronSecret) {
      const b = await req.json().catch(() => ({}));
      if (b?.action === "watch") return json(await watch(SERVICE()));
      return json({ error: "unknown_action" }, 400);
    }

    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);
    const admin = SERVICE();

    const body = await req.json();
    // The history of imports, a prepared file's rows, and undo: staff only (the run log is service-role data).
    if (["runs", "loadRun", "undo"].includes(body?.action)) {
      if (!user.email?.toLowerCase().endsWith("@prosperwise.ca")) return json({ error: "Access denied" }, 403);
      if (body.action === "runs") {
        const { data: runs } = await admin.from("monthly_import_runs").select("id, file_name, snapshot_date, source, status, checks, summary, created_at, committed_at, committed_by, undone_at").order("snapshot_date", { ascending: false }).order("created_at", { ascending: false }).limit(12);
        const { data: cfg } = await admin.from("monthly_import_config").select("mode, drive_folder_id").eq("id", true).maybeSingle();
        return json({ ok: true, runs: runs ?? [], config: cfg ?? null });
      }
      if (body.action === "loadRun") {
        const { data: run } = await admin.from("monthly_import_runs").select("id, file_name, snapshot_date, status, rows").eq("id", String(body.runId ?? "")).maybeSingle();
        if (!run) return json({ error: "That import was not found." }, 404);
        return json({ ok: true, run });
      }
      return json({ ok: true, result: await undoRun(admin, String(body.runId ?? ""), user.email ?? "staff") });
    }

    const { mode = "preview", snapshot_date, rows, source_file, approved_exceptions } = body;
    if (!snapshot_date) throw new Error("snapshot_date required (YYYY-MM-DD)");

    // Close accounts that left the monthly file (liquidated or transferred out): a zero balance at this month-end, so they stop showing their last value.
    if (mode === "close") {
      const accts: { id: string; table: string }[] = Array.isArray(body.accounts) ? body.accounts.slice(0, 200) : [];
      const closed: string[] = [];
      const errors: { id: string; error: string }[] = [];
      for (const a of accts) {
        try {
          const isVine = a.table === "vineyard_accounts";
          const { data: acct } = await supabase.from(isVine ? "vineyard_accounts" : "holding_tank").select("id, contact_id, book_value, notes").eq("id", a.id).maybeSingle();
          if (!acct?.contact_id) throw new Error("account or its contact not found");
          const col = isVine ? "vineyard_account_id" : "holding_tank_id";
          const { data: prior } = await supabase.from("account_harvest_snapshots").select("boy_value").eq(col, a.id).eq("reporting_year", Number(String(snapshot_date).slice(0, 4))).order("snapshot_date", { ascending: false }).limit(1).maybeSingle();
          const boy = toNum(prior?.boy_value) ?? toNum(acct.book_value) ?? 0;
          const row = closeSnapshotRow({ contactId: acct.contact_id, holdingTankId: isVine ? null : a.id, vineyardAccountId: isVine ? a.id : null, snapshotDate: snapshot_date, boy, userId: user.id });
          const { data: es } = await supabase.from("account_harvest_snapshots").select("id").eq("snapshot_date", snapshot_date).eq(col, a.id).maybeSingle();
          const w = es?.id ? await supabase.from("account_harvest_snapshots").update(row).eq("id", es.id) : await supabase.from("account_harvest_snapshots").insert(row);
          if (w.error) throw w.error;
          await supabase.from(isVine ? "vineyard_accounts" : "holding_tank").update({ current_value: 0, notes: [acct.notes, `Closed ${snapshot_date}.`].filter(Boolean).join("\n"), updated_at: new Date().toISOString() }).eq("id", a.id);
          closed.push(a.id);
        } catch (e) { errors.push({ id: a.id, error: (e as Error).message }); }
      }
      return json({ ok: true, closed, errors });
    }

    if (!Array.isArray(rows)) throw new Error("rows[] required");
    const approved = new Set<string>((Array.isArray(approved_exceptions) ? approved_exceptions : []).map((c: unknown) => String(c).trim()));
    if (mode === "preview") return json({ ok: true, ...(await performImport(supabase, admin, { mode: "preview", snapshot_date, rows, source_file, approved, userId: user.id })) });

    // COMMIT. Every commit is logged as a run, with what it replaced, so it can be undone: either the prepared run it came from, or a new one for a manual upload.
    let runId: string | null = typeof body.run_id === "string" ? body.run_id : null;
    if (!runId) {
      const { data: made } = await admin.from("monthly_import_runs").insert({ file_name: source_file ?? null, snapshot_date, source: "manual", status: "ready", summary: { total_rows: rows.length } }).select("id").single();
      runId = made?.id ?? null;
    }
    const result = await performImport(supabase, admin, { mode: "commit", snapshot_date, rows, source_file, approved, userId: user.id, runId });
    if (runId) {
      const total = (rows as PerfRow[]).reduce((n, r) => n + (toNum(r.current_value) ?? 0), 0);
      const { data: prior } = await admin.from("monthly_import_runs").select("summary").eq("id", runId).maybeSingle();
      await admin.from("monthly_import_runs").update({ status: "committed", committed_at: new Date().toISOString(), committed_by: user.email ?? "staff", summary: { ...(prior?.summary ?? {}), ...summarize(result.report), total_value: total } }).eq("id", runId);
    }
    return json({ ok: true, ...result, run_id: runId });
  } catch (e) {
    console.error("bulk-import-performance error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
