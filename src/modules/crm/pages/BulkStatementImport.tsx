import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, EyeOff, FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { AppLayout } from "@/shared/components/AppLayout";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { supabase } from "@/shared/integrations/supabase/client";
import { segmentStatements, type StatementSegment } from "../lib/iaBulkStatements";

const FUNCTIONS_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/vault-service`;

async function callVault(action: string, payload: Record<string, unknown> = {}) {
  const { data: sess } = await supabase.auth.getSession();
  const res = await fetch(FUNCTIONS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token ?? ""}` },
    body: JSON.stringify({ action, ...payload }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

type Status = "ready" | "already_filed" | "unmatched" | "ambiguous" | "no_vault" | "no_folder" | "bad_input" | "problem";

interface Row {
  segment: StatementSegment;
  status: Status;
  reason: string | null;
  household: string | null;
  owner: string | null;
  fileName: string | null;
  state: "idle" | "filing" | "filed" | "failed";
  error?: string;
}

const STATUS_LABEL: Record<Status, string> = {
  ready: "Ready",
  already_filed: "Already filed",
  unmatched: "No matching account",
  ambiguous: "Ambiguous",
  no_vault: "No Vault",
  no_folder: "No Investments folder",
  bad_input: "Unreadable",
  problem: "Needs a look",
};

const STATUS_TONE: Record<Status, string> = {
  ready: "bg-emerald-100 text-emerald-800 border-emerald-200",
  already_filed: "bg-slate-100 text-slate-700 border-slate-200",
  unmatched: "bg-amber-100 text-amber-800 border-amber-200",
  ambiguous: "bg-amber-100 text-amber-800 border-amber-200",
  no_vault: "bg-amber-100 text-amber-800 border-amber-200",
  no_folder: "bg-amber-100 text-amber-800 border-amber-200",
  bad_input: "bg-red-100 text-red-800 border-red-200",
  problem: "bg-red-100 text-red-800 border-red-200",
};

function toBase64(bytes: Uint8Array) {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

async function extractPageTexts(data: Uint8Array, onProgress: (done: number, total: number) => void) {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: data.slice() }).promise;
  const texts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    texts.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
    if (i % 10 === 0 || i === doc.numPages) onProgress(i, doc.numPages);
  }
  return texts;
}

async function extractPages(source: Uint8Array, pages: number[]) {
  const { PDFDocument } = await import("pdf-lib");
  const src = await PDFDocument.load(source, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, pages);
  copied.forEach((p) => out.addPage(p));
  return out.save();
}

function BatchHistory() {
  const queryClient = useQueryClient();
  const { data: items = [] } = useQuery({
    queryKey: ["bulk-statement-items"],
    queryFn: async () =>
      ((await callVault("bulkStatementsList")).items ?? []) as {
        batch_id: string; created_at: string; household_id: string; file_name: string; revealed_at: string | null; households: { label: string | null } | null;
      }[],
  });
  const batches = useMemo(() => {
    const map = new Map<string, { id: string; created: string; total: number; hidden: number; households: Set<string> }>();
    for (const it of items) {
      const b = map.get(it.batch_id) ?? { id: it.batch_id, created: it.created_at, total: 0, hidden: 0, households: new Set<string>() };
      b.total++;
      if (!it.revealed_at) b.hidden++;
      b.households.add(it.household_id);
      if (it.created_at < b.created) b.created = it.created_at;
      map.set(it.batch_id, b);
    }
    return [...map.values()].sort((a, b) => b.created.localeCompare(a.created));
  }, [items]);

  const reveal = useMutation({
    mutationFn: (batchId: string) => callVault("bulkStatementsReveal", { batchId }),
    onSuccess: (res) => {
      toast.success(`${res.revealed} statement(s) are now visible to clients`);
      queryClient.invalidateQueries({ queryKey: ["bulk-statement-items"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!batches.length) return null;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Previous imports</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {batches.map((b) => (
          <div key={b.id} className="flex items-center justify-between gap-3 rounded border p-3 text-sm">
            <div>
              <div>{format(new Date(b.created), "MMM d, yyyy h:mm a")} · {b.total} statements · {b.households.size} households</div>
              <div className="text-xs text-muted-foreground">
                {b.hidden > 0 ? `${b.hidden} still hidden from clients` : "All visible to clients"}
              </div>
            </div>
            {b.hidden > 0 && (
              <Button size="sm" onClick={() => reveal.mutate(b.id)} disabled={reveal.isPending}>
                Show {b.hidden} to clients
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function BulkStatementImport() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  const readyCount = rows.filter((r) => r.status === "ready" && r.state === "idle").length;
  const filedCount = rows.filter((r) => r.state === "filed").length;
  const failedCount = rows.filter((r) => r.state === "failed").length;

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setRows([]); setFinished(false); setBatchId(null);
    setFileName(file.name);
    try {
      setBusy("Reading the PDF…");
      const data = new Uint8Array(await file.arrayBuffer());
      setBytes(data);
      const texts = await extractPageTexts(data, (d, t) => setBusy(`Reading page ${d} of ${t}…`));
      const segments = segmentStatements(texts);
      if (!segments.length) throw new Error("No iA investment statements were found in this PDF.");
      setBusy("Matching statements to households…");
      const usable = segments.filter((s) => !s.problem);
      const { rows: matched } = await callVault("bulkStatementsPreview", {
        statements: usable.map((s) => ({ contract: s.contract, statementDate: s.statementDate })),
      }) as { rows: { contract: string; status: Status; reason: string | null; household: string | null; owner: string | null; fileName: string | null }[] };
      const byContract = new Map(matched.map((m) => [m.contract, m]));
      setRows(segments.map((segment): Row => {
        if (segment.problem) return { segment, status: "problem", reason: segment.problem, household: null, owner: null, fileName: null, state: "idle" };
        const m = byContract.get(segment.contract);
        return {
          segment, status: m?.status ?? "bad_input", reason: m?.reason ?? null, household: m?.household ?? null,
          owner: m?.owner ?? null, fileName: m?.fileName ?? null, state: "idle",
        };
      }));
    } catch (e) {
      toast.error((e as Error).message);
      setBytes(null);
    } finally {
      setBusy(null);
    }
  };

  const fileAll = async () => {
    if (!bytes) return;
    const id = crypto.randomUUID();
    setBatchId(id);
    setFinished(false);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.status !== "ready" || r.state !== "idle") continue;
      setRows((prev) => prev.map((x, j) => (j === i ? { ...x, state: "filing" } : x)));
      try {
        setBusy(`Filing ${r.fileName}…`);
        const piece = await extractPages(bytes, r.segment.pages);
        const res = await callVault("bulkStatementFile", {
          contract: r.segment.contract, statementDate: r.segment.statementDate, base64: toBase64(piece), batchId: id,
        });
        setRows((prev) => prev.map((x, j) => (j === i
          ? res.filed ? { ...x, state: "filed" } : { ...x, state: "failed", error: res.reason ?? res.status ?? "not filed" }
          : x)));
      } catch (e) {
        setRows((prev) => prev.map((x, j) => (j === i ? { ...x, state: "failed", error: (e as Error).message } : x)));
      }
    }
    setBusy(null);
    setFinished(true);
    queryClient.invalidateQueries({ queryKey: ["bulk-statement-items"] });
  };

  const reveal = useMutation({
    mutationFn: () => callVault("bulkStatementsReveal", { batchId }),
    onSuccess: (res) => {
      toast.success(`${res.revealed} statement(s) are now visible to clients`);
      queryClient.invalidateQueries({ queryKey: ["bulk-statement-items"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl space-y-4">
        <div>
          <h1 className="font-serif text-2xl">Bulk statement import</h1>
          <p className="text-sm text-muted-foreground">
            Upload iA Financial's combined Investment Statements PDF. Each statement is split out, matched to a household
            by contract number and filed in that household's Investments folder, <strong>hidden from clients</strong> until you show it.
          </p>
        </div>

        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 pt-6">
            <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => onPick(e.target.files?.[0])} />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={!!busy}>
              <FileUp className="mr-2 h-4 w-4" /> Choose PDF
            </Button>
            {fileName && <span className="text-sm text-muted-foreground">{fileName}</span>}
            {busy && <span className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> {busy}</span>}
          </CardContent>
        </Card>

        {rows.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle className="text-base">
                {rows.length} statements found · {rows.filter((r) => r.status === "ready").length} ready
                {filedCount > 0 && ` · ${filedCount} filed`}{failedCount > 0 && ` · ${failedCount} failed`}
              </CardTitle>
              <Button onClick={fileAll} disabled={!!busy || readyCount === 0}>
                File {readyCount} statement{readyCount === 1 ? "" : "s"} (hidden from clients)
              </Button>
            </CardHeader>
            <CardContent className="space-y-1">
              {rows.map((r) => (
                <div key={r.segment.contract} className="flex items-center gap-3 border-b py-2 text-sm last:border-0">
                  <div className="w-[7.5rem] shrink-0 font-mono text-xs">{r.segment.contract}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{r.fileName ?? r.reason ?? "—"}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {r.household ? `${r.household}${r.owner ? ` · ${r.owner}` : ""}` : r.reason}
                      {r.error ? ` — ${r.error}` : ""}
                    </div>
                  </div>
                  {r.state === "filed" ? (
                    <Badge className="bg-emerald-600"><CheckCircle2 className="mr-1 h-3 w-3" /> Filed</Badge>
                  ) : r.state === "filing" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : r.state === "failed" ? (
                    <Badge variant="destructive">Failed</Badge>
                  ) : (
                    <Badge variant="outline" className={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {finished && batchId && filedCount > 0 && (
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
              <div className="flex items-center gap-2 text-sm">
                <EyeOff className="h-4 w-4" /> {filedCount} statement(s) filed and hidden from clients. Check them in the Vaults, then show them.
              </div>
              <Button onClick={() => reveal.mutate()} disabled={reveal.isPending}>Show to clients</Button>
            </CardContent>
          </Card>
        )}

        <BatchHistory />
      </div>
    </AppLayout>
  );
}
