import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileSearch, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { AppLayout } from "@/shared/components/AppLayout";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { supabase } from "@/shared/integrations/supabase/client";
import { cn } from "@/shared/lib/utils";
import { SourceViewer, type Highlight } from "../components/stage2/SourceViewer";
import { CheckTimeline } from "../components/stage2/CheckTimeline";
import { CausalRiskPanel } from "../components/stage2/CausalRiskPanel";
import { EntityEditor } from "../components/stage2/EntityEditor";
import { AvailabilityPanel } from "../components/stage2/AvailabilityPanel";
import { applyUiCorrections, ITEM_NOUN, itemIndexForCheck, itemsOf, summarizeChecks, type Correction, type Stage2AuditRow } from "../lib/stage2";

const FUNCTION_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/stage2-review`;

async function callReview(body: Record<string, unknown>) {
  const { data: sess } = await supabase.auth.getSession();
  const res = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token ?? ""}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error ?? `HTTP ${res.status}`), { status: res.status, body: json });
  return json;
}

const STATUS_TONE: Record<Stage2AuditRow["overall_status"], string> = {
  VERIFIED: "bg-emerald-100 text-emerald-800 border-emerald-200",
  INCOMPLETE: "bg-amber-100 text-amber-800 border-amber-200",
  CONFLICT: "bg-red-100 text-red-800 border-red-200",
};

function ReviewDetail({ row, onDone }: { row: Stage2AuditRow; onDone: () => void }) {
  const { kind, source } = row.extracted_entities;
  const items = itemsOf(row);
  const readOnly = row.review_status !== "pending";
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [selected, setSelected] = useState<number | null>(items.length ? 0 : null);
  const [needsAck, setNeedsAck] = useState(false);

  const highlight: Highlight | null = useMemo(() => {
    const src = selected === null ? null : items[selected]?.source;
    return src?.page_number ? { page: src.page_number, box: src.bounding_box, quote: src.quote } : null;
  }, [items, selected]);

  const setCorrection = (c: Correction) =>
    setCorrections((prev) => [...prev.filter((p) => !(p.index === c.index && p.field === c.field)), c]);

  const decide = useMutation({
    mutationFn: (vars: { action: "approve" | "reject"; acknowledgeConflicts?: boolean }) =>
      callReview({ action: vars.action, auditId: row.id, corrections, acknowledgeConflicts: vars.acknowledgeConflicts }),
    onSuccess: (res, vars) => {
      toast.success(vars.action === "reject" ? "Rejected — nothing was changed" : `Approved: ${res.updated} updated, ${res.inserted} added`);
      onDone();
    },
    onError: (e: any) => {
      if (e.status === 422 && e.body?.overall_status === "CONFLICT") { setNeedsAck(true); toast.error("Conflicts remain — correct them or approve anyway."); }
      else toast.error(e.message);
    },
  });

  const counts = summarizeChecks(row.arithmetic_checks);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Source document</CardTitle></CardHeader>
          <CardContent><SourceViewer driveId={source?.drive_id} fileName={source?.file_name} highlight={highlight} /></CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-base">
              <span>Extracted {ITEM_NOUN[kind].many}</span>
              <Badge variant="outline" className={STATUS_TONE[row.overall_status]}>{row.overall_status}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <EntityEditor kind={kind} items={items} corrections={corrections} selectedIndex={selected} readOnly={readOnly}
              onSelect={setSelected} onCorrect={setCorrection}
              onClear={(index, field) => setCorrections((p) => p.filter((c) => !(c.index === index && c.field === field)))} />
            {(row.missing_items ?? []).length > 0 && (
              <p className="mt-3 text-sm text-amber-700"><AlertTriangle className="mr-1 inline h-4 w-4" />Missing: {row.missing_items!.join(", ")}</p>
            )}
          </CardContent>
        </Card>

        {kind === "investment" && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Available for withdrawal</CardTitle></CardHeader>
            <CardContent><AvailabilityPanel items={applyUiCorrections(items, corrections)} /></CardContent>
          </Card>
        )}

        <Card>
          <Tabs defaultValue="checks">
            <CardHeader className="pb-2">
              <TabsList>
                <TabsTrigger value="checks">Checks ({counts.pass}✓ {counts.fail}✗ {counts.skipped}–)</TabsTrigger>
                <TabsTrigger value="causal">Causal risk</TabsTrigger>
              </TabsList>
            </CardHeader>
            <CardContent>
              <TabsContent value="checks" className="mt-0">
                <CheckTimeline checks={row.arithmetic_checks} onSelect={(c) => { const i = itemIndexForCheck(row, c); if (i !== null) setSelected(i); }} />
              </TabsContent>
              <TabsContent value="causal" className="mt-0"><CausalRiskPanel causal={row.causal_dag_evaluations} /></TabsContent>
            </CardContent>
          </Tabs>
        </Card>

        {readOnly ? (
          <p className="text-sm text-muted-foreground">
            {row.review_status === "approved" ? <CheckCircle2 className="mr-1 inline h-4 w-4 text-emerald-600" /> : null}
            {row.review_status === "approved" ? `Approved${row.applied_at ? ` and applied ${format(new Date(row.applied_at), "PPp")}` : ""}.` : "Rejected — nothing was changed."}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {needsAck ? (
              <Button variant="destructive" disabled={decide.isPending} onClick={() => decide.mutate({ action: "approve", acknowledgeConflicts: true })}>
                Approve anyway ({corrections.length} correction{corrections.length === 1 ? "" : "s"})
              </Button>
            ) : (
              <Button disabled={decide.isPending} onClick={() => decide.mutate({ action: "approve" })}>
                {decide.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                Approve &amp; apply{corrections.length ? ` (${corrections.length} correction${corrections.length === 1 ? "" : "s"})` : ""}
              </Button>
            )}
            <Button variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ action: "reject" })}>Reject</Button>
            <span className="text-xs text-muted-foreground">Approving updates live records. Corrections are saved so the AI can learn from them.</span>
          </div>
        )}
      </div>
    </div>
  );
}

const Stage2Review = () => {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Stage2AuditRow["review_status"]>("pending");
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ["stage2-audit", filter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stage2_verification_audit")
        .select("*, households(label)")
        .eq("review_status", filter)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as Stage2AuditRow[];
    },
  });
  const open = rows.find((r) => r.id === openId) ?? null;

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 basis-72">
            <h1 className="font-serif text-2xl">Glass-Box Review</h1>
            <p className="text-sm text-muted-foreground">AI extractions held for your approval. Nothing reaches a client record until you approve it.</p>
          </div>
          <div className="flex gap-1">
            {(["pending", "approved", "rejected"] as const).map((s) => (
              <Button key={s} size="sm" variant={filter === s ? "default" : "outline"} onClick={() => { setFilter(s); setOpenId(null); }}>{s[0].toUpperCase() + s.slice(1)}</Button>
            ))}
          </div>
        </div>

        {isLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
        {error && <p className="text-sm text-destructive" role="alert">Couldn't load reviews: {(error as Error).message}</p>}
        {!isLoading && !error && rows.length === 0 && (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground"><FileSearch className="mx-auto mb-2 h-6 w-6" />No {filter} extractions. V2 households' Vault scans appear here.</CardContent></Card>
        )}

        {!open && rows.map((r) => (
          <button key={r.id} type="button" onClick={() => setOpenId(r.id)} className="flex w-full items-center gap-4 rounded border px-3 py-2.5 text-left text-sm hover:bg-muted/50">
            <Badge variant="outline" className={cn("w-24 justify-center", STATUS_TONE[r.overall_status])}>{r.overall_status}</Badge>
            <span className="min-w-0 flex-1 truncate">
              <strong>{r.households?.label ?? "Household"}</strong> · {r.extracted_entities.source?.file_name ?? "document"} · {itemsOf(r).length} {itemsOf(r).length === 1 && r.extracted_entities.kind === "insurance" ? "policy" : ITEM_NOUN[r.extracted_entities.kind].many}
            </span>
            <span className="text-xs text-muted-foreground">{format(new Date(r.created_at), "PP")}</span>
          </button>
        ))}

        {open && (
          <div className="space-y-3">
            <Button variant="ghost" size="sm" onClick={() => setOpenId(null)}>← All reviews</Button>
            <ReviewDetail key={open.id} row={open} onDone={() => { setOpenId(null); queryClient.invalidateQueries({ queryKey: ["stage2-audit"] }); }} />
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default Stage2Review;
