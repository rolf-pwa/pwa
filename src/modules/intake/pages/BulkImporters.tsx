import { useCallback, useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { parsePerformanceGrid } from "../../../../supabase/functions/_shared/performance-file-parse";
import { AppLayout } from "@/shared/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/shared/components/ui/tabs";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Badge } from "@/shared/components/ui/badge";
import { Label } from "@/shared/components/ui/label";
import { supabase } from "@/shared/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, FileText, CheckCircle2, AlertTriangle, Loader2, Send } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/shared/components/ui/alert-dialog";

/* --------------------------- REGISTRY IMPORTER --------------------------- */

function RegistryImporter() {
  const [docId, setDocId] = useState("1V1MRc9vpiho7kei3QeXroMjxUWk2S1N3u35RsHso1W8");
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<any>(null);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<any>(null);

  const extractId = (s: string) => {
    const m = s.match(/\/d\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : s.trim();
  };

  const run = async (mode: "preview" | "commit") => {
    const id = extractId(docId);
    if (!id) return toast.error("Provide a Google Doc URL or ID");
    if (mode === "commit") setCommitting(true); else setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("bulk-import-registry", {
        body: { mode, doc_id: id },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      if (mode === "preview") { setPlan(data.plan); setResult(null); }
      else { setResult(data.results); setPlan(null); toast.success("Registry imported."); }
    } catch (e: any) {
      toast.error(e.message || "Import failed");
    } finally { setLoading(false); setCommitting(false); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Household Registry (Google Doc)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs">Google Doc URL or ID</Label>
            <Input value={docId} onChange={(e) => setDocId(e.target.value)} placeholder="https://docs.google.com/document/d/..." />
          </div>
          <div className="flex gap-2">
            <Button onClick={() => run("preview")} disabled={loading || committing} variant="outline">
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileText className="h-4 w-4 mr-2" />}
              Preview
            </Button>
            <Button onClick={() => run("commit")} disabled={!plan || committing} className="bg-accent">
              {committing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              Commit Import
            </Button>
          </div>
        </CardContent>
      </Card>

      {plan && (
        <Card>
          <CardHeader><CardTitle>Preview</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
              <Stat label="Households (new)" value={plan.newHouseholds} />
              <Stat label="Households (matched)" value={plan.matchedHouseholds} />
              <Stat label="Contacts (new)" value={plan.newContacts} />
              <Stat label="Contacts (matched)" value={plan.matchedContacts} />
              <Stat label="Accounts (new)" value={plan.newAccounts} />
            </div>
            {plan.duplicateContracts?.length > 0 && (
              <div className="mb-3 text-xs text-amber-600 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5" />
                <span>{plan.duplicateContracts.length} contract number(s) already exist in Holding Tank — will be skipped: {plan.duplicateContracts.slice(0, 6).join(", ")}{plan.duplicateContracts.length > 6 ? "…" : ""}</span>
              </div>
            )}
            <div className="max-h-96 overflow-y-auto space-y-2 border rounded p-2">
              {plan.households.map((h: any, i: number) => (
                <div key={i} className="text-xs border-b pb-1 last:border-0">
                  <div className="font-medium">
                    {h.existing_id ? <Badge variant="outline" className="mr-1 text-[9px]">exists</Badge> : <Badge className="mr-1 text-[9px] bg-green-600">new</Badge>}
                    {h.label} <span className="text-muted-foreground">— {h.address || "no address"}</span>
                  </div>
                  {h.members.map((m: any, j: number) => (
                    <div key={j} className="ml-3 mt-0.5">
                      {m.existing_contact_id ? "· " : "+ "}{m.first_name} {m.last_name}
                      <span className="text-muted-foreground"> ({m.container}{m.storehouse_label ? `: ${m.storehouse_label}` : ""})</span>
                      <span className="text-muted-foreground"> — {m.accounts.length} account{m.accounts.length !== 1 ? "s" : ""}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {result && (
        <Card>
          <CardHeader><CardTitle>Commit Result</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Stat label="Families created" value={result.families} />
              <Stat label="Households created" value={result.households} />
              <Stat label="Contacts created" value={result.contacts} />
              <Stat label="Accounts created" value={result.accounts} />
              <Stat label="Skipped (dup)" value={result.skipped} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ------------------------- PERFORMANCE IMPORTER ------------------------- */


/** After the monthly import: Georgia tells each person their balances are updated (portal notification + email, no figures). */
function BalanceNoticeCard({ snapshotDate }: { snapshotDate: string }) {
  const [plan, setPlan] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [sentResult, setSentResult] = useState<any>(null);

  const call = async (action: "preview" | "send") => {
    const { data, error } = await supabase.functions.invoke("balance-update-notify", { body: { action, snapshotDate } });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  };
  const preview = async () => {
    setBusy(true);
    try { setPlan((await call("preview")).plan); setSentResult(null); } catch (e: any) { toast.error(e.message || "Couldn't load recipients"); } finally { setBusy(false); }
  };
  const send = async () => {
    setBusy(true); setConfirm(false);
    try {
      const d = await call("send");
      setSentResult(d.result);
      toast.success(`Georgia sent ${d.result.sent} notice${d.result.sent === 1 ? "" : "s"}`);
      setPlan((await call("preview")).plan);
    } catch (e: any) { toast.error(e.message || "Couldn't send"); } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader><CardTitle>Tell clients their balances are updated</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Georgia sends each person a short note (portal notification and email, no figures) about their own accounts as of {snapshotDate}.
          The head of household can see household accounts when they open their own. Each person is told once per month.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={preview} disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Show who would be notified</Button>
          <Button onClick={() => setConfirm(true)} disabled={busy || !plan || plan.send.length === 0}><Send className="mr-2 h-4 w-4" />Send from Georgia{plan ? ` (${plan.send.length})` : ""}</Button>
        </div>
        {plan && (
          <div className="grid gap-3 md:grid-cols-3">
            <div><div className="mb-1 text-xs font-medium">To notify ({plan.send.length})</div><ul className="max-h-40 space-y-0.5 overflow-y-auto rounded border p-2 text-xs">{plan.send.map((r: any) => <li key={r.contactId}>{r.name}{r.household ? <span className="text-muted-foreground"> · {r.household}</span> : null}</li>)}{plan.send.length === 0 && <li className="text-muted-foreground">Nobody left to notify.</li>}</ul></div>
            <div><div className="mb-1 text-xs font-medium text-amber-700">No email on file ({plan.noEmail.length})</div><ul className="max-h-40 space-y-0.5 overflow-y-auto rounded border p-2 text-xs">{plan.noEmail.map((r: any) => <li key={r.contactId}>{r.name}{r.household ? <span className="text-muted-foreground"> · {r.household}</span> : null}</li>)}{plan.noEmail.length === 0 && <li className="text-muted-foreground">None.</li>}</ul></div>
            <div><div className="mb-1 text-xs font-medium text-muted-foreground">Already notified ({plan.alreadyNotified.length})</div><ul className="max-h-40 space-y-0.5 overflow-y-auto rounded border p-2 text-xs">{plan.alreadyNotified.map((r: any) => <li key={r.contactId}>{r.name}</li>)}{plan.alreadyNotified.length === 0 && <li className="text-muted-foreground">None.</li>}</ul></div>
          </div>
        )}
        {sentResult && <p className="text-xs text-muted-foreground">Sent {sentResult.sent}{sentResult.emailFailed ? `, ${sentResult.emailFailed} email${sentResult.emailFailed === 1 ? "" : "s"} failed (they still have the portal notification)` : ""}{sentResult.skipped ? `, ${sentResult.skipped} skipped (already notified)` : ""}{sentResult.errors ? `, ${sentResult.errors} could not be sent (see the function logs)` : ""}.</p>}
      </CardContent>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send from Georgia?</AlertDialogTitle>
            <AlertDialogDescription>Georgia will notify {plan?.send.length ?? 0} people that their balances are updated as of {snapshotDate}. This can't be unsent.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={send}>Send</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/** Georgia's monthly imports: what she prepared from the Drive folder, what has been committed, and undo for a bad month. */
function MonthlyImportRuns({ onLoad }: { onLoad: (runId: string) => void }) {
  const [runs, setRuns] = useState<any[] | null>(null);
  const [config, setConfig] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("bulk-import-performance", { body: { action: "runs" } });
    if (error || data?.error) { setRuns([]); return; }
    setRuns(data.runs ?? []); setConfig(data.config ?? null);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const undo = async (r: any) => {
    if (!window.confirm(`Undo the ${r.snapshot_date} import? Balances and snapshots it wrote go back to what they were before.`)) return;
    setBusy(r.id);
    try {
      const { data, error } = await supabase.functions.invoke("bulk-import-performance", { body: { action: "undo", runId: r.id } });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      toast.success(`Undone: ${data.result.accounts_restored} balances restored, ${data.result.snapshots_removed} snapshots removed.`);
      await load();
    } catch (e: any) { toast.error(e.message || "Couldn't undo"); } finally { setBusy(null); }
  };
  const STATUS: Record<string, string> = { ready: "Ready for you", held: "Held: needs a look", committed: "Committed", undone: "Undone", error: "Could not read" };
  return (
    <Card data-testid="monthly-import-runs">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Georgia's monthly imports</CardTitle>
        <p className="text-xs text-muted-foreground">
          Drop each month's performance file in the Georgia - Monthly Imports folder in Drive{config?.drive_folder_id ? <> (<a className="underline" href={`https://drive.google.com/drive/folders/${config.drive_folder_id}`} target="_blank" rel="noopener noreferrer">open it</a>)</> : null}. She reads it, runs the preview and tells you what needs you.
          {config ? ` Mode: ${config.mode === "auto" ? "she commits the routine rows of a clean file herself" : config.mode === "prepare" ? "she prepares it and you commit" : "off"}.` : ""}
        </p>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {runs === null && <Loader2 className="h-4 w-4 animate-spin" />}
        {runs !== null && runs.length === 0 && <p className="text-muted-foreground">No imports yet.</p>}
        {(runs ?? []).map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 last:border-0">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.snapshot_date}</span>
                <Badge variant={r.status === "ready" ? "default" : r.status === "committed" ? "secondary" : "outline"} className="text-[10px]">{STATUS[r.status] ?? r.status}</Badge>
                <span className="truncate text-xs text-muted-foreground">{r.file_name ?? "uploaded by hand"}{r.source === "georgia" ? " · Georgia" : ""}</span>
              </div>
              {r.summary?.total_rows ? <p className="text-xs text-muted-foreground">{r.summary.total_rows} accounts{r.summary.routine != null ? ` · ${r.summary.routine} routine · ${r.summary.exceptions ?? 0} large moves · ${r.summary.new_accounts ?? 0} new · ${r.summary.missing ?? 0} missing` : ""}</p> : null}
              {(r.checks ?? []).length > 0 && <ul className="mt-0.5 list-disc pl-4 text-xs text-amber-800">{r.checks.map((c: string, i: number) => <li key={i}>{c}</li>)}</ul>}
            </div>
            <div className="flex gap-2">
              {(r.status === "ready" || r.status === "held") && r.source === "georgia" && <Button size="sm" onClick={() => onLoad(r.id)}>Load into the importer</Button>}
              {r.status === "committed" && <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => undo(r)}>{busy === r.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}Undo</Button>}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function PerformanceImporter() {
  const [file, setFile] = useState<File | null>(null);
  // The prepared run (Georgia's file) being worked on, so the commit is logged against it.
  const [runId, setRunId] = useState<string | null>(null);
  const [runFileName, setRunFileName] = useState<string | null>(null);
  const [snapshotDate, setSnapshotDate] = useState<string>("");
  const [rows, setRows] = useState<any[]>([]);
  const [report, setReport] = useState<any>(null);
  const [commitResult, setCommitResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  // Contract numbers of exceptions (big moves) that you have approved for this import.
  const [approved, setApproved] = useState<Set<string>>(new Set());

  // Georgia's prepared file: load its rows straight into this importer, then preview, approve and commit as usual.
  const loadPreparedRun = async (id: string) => {
    const { data, error } = await supabase.functions.invoke("bulk-import-performance", { body: { action: "loadRun", runId: id } });
    if (error || data?.error) { toast.error(data?.error || error?.message || "Couldn't load that file"); return; }
    setFile(null); setReport(null); setCommitResult(null); setApproved(new Set());
    setRows(data.run.rows ?? []); setSnapshotDate(data.run.snapshot_date); setRunId(data.run.id); setRunFileName(data.run.file_name);
    toast.success(`Loaded ${data.run.file_name ?? "the file"}: ${(data.run.rows ?? []).length} rows. Run the preview.`);
  };

  const parseFile = async (f: File) => {
    setFile(f);
    setRunId(null); setRunFileName(null);
    setReport(null); setCommitResult(null); setRows([]); setApproved(new Set());
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const sh = wb.Sheets[wb.SheetNames[0]];
    const grid = XLSX.utils.sheet_to_json<any[]>(sh, { header: 1, raw: true, defval: null });
    // The same reader Georgia uses on the Drive folder: header row, balances, and the date from the file name or the "As of" column.
    const parsed = parsePerformanceGrid(grid, f.name);
    if (parsed.error) { toast.error(parsed.error); return; }
    if (parsed.snapshotDate) setSnapshotDate(parsed.snapshotDate);
    const out: any[] = parsed.rows;
    setRows(out);
    toast.success(`Parsed ${out.length} rows`);
  };

  const run = async (mode: "preview" | "commit") => {
    if (!rows.length) return toast.error("Load a file first");
    if (!snapshotDate) return toast.error("Snapshot date required");
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("bulk-import-performance", {
        body: { mode, snapshot_date: snapshotDate, rows, source_file: file?.name ?? runFileName, approved_exceptions: [...approved], ...(runId ? { run_id: runId } : {}) },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      setReport(data.report);
      if (mode === "preview") setApproved(new Set());
      if (mode === "commit") { setCommitResult(data.commit); toast.success("Snapshots imported."); }
    } catch (e: any) {
      toast.error(e.message || "Import failed");
    } finally { setLoading(false); }
  };

  // Accounts that left the file because they were closed: record a zero balance at this month-end.
  const [closeSel, setCloseSel] = useState<Set<string>>(new Set());
  const [closing, setClosing] = useState(false);
  const closeSelected = async () => {
    if (!window.confirm(`Mark ${closeSel.size} account${closeSel.size === 1 ? "" : "s"} closed with a $0 balance as of ${snapshotDate}?`)) return;
    setClosing(true);
    try {
      const picked = (report?.missing ?? []).filter((m: any) => closeSel.has(m.id)).map((m: any) => ({ id: m.id, table: m.table }));
      const { data, error } = await supabase.functions.invoke("bulk-import-performance", { body: { mode: "close", snapshot_date: snapshotDate, accounts: picked } });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      setReport((r: any) => ({ ...r, missing: (r?.missing ?? []).filter((m: any) => !(data.closed ?? []).includes(m.id)) }));
      setCloseSel(new Set());
      if (data.errors?.length) toast.error(`${data.errors.length} could not be closed`); else toast.success(`Marked ${data.closed.length} closed.`);
    } catch (e: any) { toast.error(e.message || "Couldn't close the accounts"); } finally { setClosing(false); }
  };

  const lines: any[] = report?.lines ?? [];
  const exceptionLines = lines.filter((l) => l.status === "exception");
  const routineCount = lines.filter((l) => l.status === "update" || l.status === "new_account").length;
  const unresolved = exceptionLines.filter((l) => !approved.has(l.contract)).length;
  const commitLabel = !report
    ? "Commit Snapshots"
    : `Import ${routineCount + exceptionLines.length - unresolved} account${routineCount + exceptionLines.length - unresolved === 1 ? "" : "s"}${unresolved ? ` (${unresolved} exception${unresolved === 1 ? "" : "s"} left out)` : ""}`;
  const toggleApprove = (contract: string) => setApproved((prev) => { const n = new Set(prev); if (n.has(contract)) n.delete(contract); else n.add(contract); return n; });
  const money = (v: number | null) => (v === null || v === undefined ? "—" : v.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }));
  const STATUS_TEXT: Record<string, string> = { update: "Update", new_account: "New account", exception: "Needs approval", unmatched: "No match", no_data: "No balance", duplicate: "Duplicate row" };

  return (
    <div className="space-y-4">
      <MonthlyImportRuns onLoad={loadPreparedRun} />
      <Card>
        <CardHeader><CardTitle>Monthly Performance File (iA XLSX, plus JustWealth rows)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Upload XLSX</Label>
              <Input type="file" accept=".xlsx,.xls" onChange={(e) => e.target.files?.[0] && parseFile(e.target.files[0])} />
              {file && <p className="text-xs text-muted-foreground mt-1">{file.name} — {rows.length} rows</p>}
            </div>
            <div>
              <Label className="text-xs">Snapshot Date</Label>
              <Input type="date" value={snapshotDate} onChange={(e) => setSnapshotDate(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => run("preview")} disabled={!rows.length || loading} variant="outline">
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileSpreadsheet className="h-4 w-4 mr-2" />}
              Preview Match
            </Button>
            <Button onClick={() => run("commit")} disabled={!report || loading} className="bg-accent">
              <Upload className="h-4 w-4 mr-2" /> {commitLabel}
            </Button>
          </div>
        </CardContent>
      </Card>

      {report && (
        <Card>
          <CardHeader><CardTitle>Match Report — {report.snapshot_date}</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
              <Stat label="Total rows" value={report.total_rows} />
              <Stat label="Matched (Vineyard)" value={report.matched_vineyard} />
              <Stat label="Matched (Holding)" value={report.matched_holding} />
              <Stat label="Auto-created HT" value={report.auto_created_holding} tone="amber" />
              <Stat label="Updated existing" value={report.updated_existing} tone="amber" />
              <Stat label="Skipped (no data)" value={report.skipped_no_data} />
              <Stat label="Need approval" value={report.exceptions ?? 0} tone={report.exceptions ? "amber" : undefined} />

            </div>
            {report.warnings?.length > 0 && (
              <ul className="mb-4 space-y-1 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                {report.warnings.map((w: string, i: number) => <li key={i} className="flex items-start gap-1"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}</li>)}
              </ul>
            )}
            {lines.length > 0 && (
              <div className="mb-4">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium">{lines.length} rows. Changes beyond {report.threshold_pct}%, a drop to zero or a negative value need your approval.</span>
                  {exceptionLines.length > 0 && <span className="text-amber-700">{exceptionLines.length - unresolved} of {exceptionLines.length} approved</span>}
                </div>
                <div className="max-h-96 overflow-auto rounded border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                      <tr><th className="p-2">Owner</th><th className="p-2">Contract</th><th className="p-2 text-right">Last month</th><th className="p-2 text-right">This month</th><th className="p-2 text-right">Change</th><th className="p-2">Status</th></tr>
                    </thead>
                    <tbody>
                      {[...lines].sort((a, b) => (a.status === "exception" ? 0 : a.status === "update" ? 2 : 1) - (b.status === "exception" ? 0 : b.status === "update" ? 2 : 1)).map((l) => (
                        <tr key={`${l.contract}-${l.status}-${l.name}`} className={`border-t ${l.status === "exception" ? "bg-amber-50" : ""}`}>
                          <td className="p-2">{l.owner ?? l.name}{l.custodian ? <span className="text-muted-foreground"> · {l.custodian}</span> : null}</td>
                          <td className="p-2 font-mono">{l.contract}</td>
                          <td className="p-2 text-right tabular-nums">{money(l.previous)}</td>
                          <td className="p-2 text-right tabular-nums">{money(l.current)}</td>
                          <td className="p-2 text-right tabular-nums">{l.change_pct === null ? "—" : `${l.change_pct > 0 ? "+" : ""}${l.change_pct.toFixed(1)}%`}</td>
                          <td className="p-2">
                            {l.status === "exception" ? (
                              <label className="flex items-center gap-1.5">
                                <input type="checkbox" checked={approved.has(l.contract)} onChange={() => toggleApprove(l.contract)} />
                                <span>{l.reason} · approve</span>
                              </label>
                            ) : (
                              <span className={l.status === "update" ? "text-muted-foreground" : "text-amber-700"}>{STATUS_TEXT[l.status]}{l.status !== "update" && l.reason ? ` · ${l.reason}` : ""}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {report.missing?.length > 0 && (
              <div className="mb-4 text-xs">
                <div className="mb-1 flex items-center gap-1 font-medium text-amber-700">
                  <AlertTriangle className="h-3 w-3" /> {report.missing.length} account{report.missing.length === 1 ? "" : "s"} at iA or JustWealth {report.missing.length === 1 ? "is" : "are"} in the system but not in this file:
                </div>
                <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded border p-2">
                  {report.missing.map((m: any) => (
                    <li key={m.id} className="flex items-center gap-2">
                      <input type="checkbox" aria-label={`Close #${m.accountNumber}`} checked={closeSel.has(m.id)} onChange={() => setCloseSel((s) => { const n = new Set(s); n.has(m.id) ? n.delete(m.id) : n.add(m.id); return n; })} />
                      <span>#{m.accountNumber} — {m.owner || "no owner"} · {m.label} · {m.custodian}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex items-center gap-2">
                  <Button size="sm" variant="outline" disabled={!closeSel.size || closing} onClick={closeSelected}>Mark selected closed</Button>
                  <span className="text-muted-foreground">Sets each to $0 as of {snapshotDate}. Use it for accounts that were liquidated or moved out; leave it for accounts that are only late.</span>
                </div>
              </div>
            )}
            {report.unchecked_custodian > 0 && (
              <p className="mb-4 text-xs text-muted-foreground">{report.unchecked_custodian} other account{report.unchecked_custodian === 1 ? "" : "s"} (no custodian, or another custodian) are not checked for completeness.</p>
            )}
            {report.unmatched_no_contact?.length > 0 && (
              <div className="text-xs">
                <div className="font-medium text-destructive mb-1 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> {report.unmatched_no_contact.length} rows had no matching contract AND no matching contact — skipped:
                </div>
                <ul className="max-h-40 overflow-y-auto border rounded p-2 space-y-0.5">
                  {report.unmatched_no_contact.map((u: any, i: number) => (
                    <li key={i}>#{u.contract} — {u.first} {u.last} ({u.registration})</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {commitResult && <BalanceNoticeCard snapshotDate={snapshotDate} />}

      {commitResult && (
        <Card>
          <CardHeader><CardTitle>Commit Result</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Stat label="Snapshots written" value={commitResult.snapshots_inserted} />
              <Stat label="Snapshots updated" value={commitResult.snapshots_updated} tone="amber" />
              <Stat label="HT auto-created" value={commitResult.ht_created} tone="amber" />
              <Stat label="Left out (not approved)" value={commitResult.skipped_exceptions?.length || 0} tone={commitResult.skipped_exceptions?.length ? "amber" : undefined} />
              <Stat label="Errors" value={commitResult.errors?.length || 0} tone={commitResult.errors?.length ? "red" : undefined} />
            </div>
            {commitResult.errors?.length > 0 && (
              <ul className="mt-3 text-xs text-destructive space-y-0.5">
                {commitResult.errors.map((e: any, i: number) => <li key={i}>#{e.contract}: {e.error}</li>)}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "amber" | "red" }) {
  const color = tone === "amber" ? "text-amber-600" : tone === "red" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded border p-2 bg-muted/30">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${color}`}>{value ?? 0}</div>
    </div>
  );
}

export default function BulkImporters() {
  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-6 max-w-6xl">
        <div className="mb-6">
          <h1 className="text-2xl font-serif">Bulk Importers</h1>
          <p className="text-sm text-muted-foreground">Seed household structure from the registry, then apply monthly iA performance files.</p>
        </div>
        <Tabs defaultValue="registry">
          <TabsList>
            <TabsTrigger value="registry"><FileText className="h-3.5 w-3.5 mr-1.5" /> Registry</TabsTrigger>
            <TabsTrigger value="performance"><FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" /> Monthly Performance</TabsTrigger>
          </TabsList>
          <TabsContent value="registry" className="mt-4"><RegistryImporter /></TabsContent>
          <TabsContent value="performance" className="mt-4"><PerformanceImporter /></TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
