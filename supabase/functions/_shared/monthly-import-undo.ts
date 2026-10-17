// monthly-import-undo.ts: puts an import back. Takes the service-role client, so it can be tested with a stand-in.

/** Puts back what a committed import replaced: snapshots it made are removed, ones it replaced restored, accounts it created removed, balances returned. */
// deno-lint-ignore no-explicit-any
export async function undoRun(admin: any, runId: string, by: string) {
  const { data: run } = await admin.from("monthly_import_runs").select("id, status").eq("id", runId).maybeSingle();
  if (!run) throw new Error("That import was not found.");
  if (run.status !== "committed") throw new Error(`That import is ${run.status}, so there is nothing to undo.`);
  const { data: entries } = await admin.from("monthly_import_undo").select("*").eq("run_id", runId).order("created_at", { ascending: false });
  const counts = { snapshots_removed: 0, snapshots_restored: 0, accounts_restored: 0, accounts_removed: 0, errors: [] as string[] };
  for (const u of entries ?? []) {
    try {
      if (u.kind === "snapshot_created") { await admin.from(u.table_name).delete().eq("id", u.row_id); counts.snapshots_removed++; }
      else if (u.kind === "snapshot_replaced") { const { id: _id, ...prev } = u.previous ?? {}; await admin.from(u.table_name).update(prev).eq("id", u.row_id); counts.snapshots_restored++; }
      else if (u.kind === "account") { await admin.from(u.table_name).update({ ...u.previous, updated_at: new Date().toISOString() }).eq("id", u.row_id); counts.accounts_restored++; }
      else if (u.kind === "account_created") { await admin.from(u.table_name).delete().eq("id", u.row_id); counts.accounts_removed++; }
    } catch (e) { counts.errors.push(`${u.kind} ${u.row_id}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  await admin.from("monthly_import_runs").update({ status: "undone", undone_at: new Date().toISOString(), committed_by: by }).eq("id", runId);
  return counts;
}

