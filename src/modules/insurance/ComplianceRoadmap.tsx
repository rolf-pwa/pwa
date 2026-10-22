import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Check, Loader2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { attachInsuranceItem, getInsuranceFiles, type InsFile, type InsFiles } from "@/modules/crm/lib/reviewAgent";
import { stageLabel, type InsuranceStage } from "@/shared/lib/insurancePipeline";
import { activity, roadmap, type RoadmapItem } from "@/shared/lib/insuranceRoadmap";

const when = (iso: string) => new Date(iso).toLocaleString("en-CA", { timeZone: "America/Vancouver", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function Ring({ percent }: { percent: number }) {
  const r = 42, c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 100 100" className="h-28 w-28 -rotate-90" role="img" aria-label={`${percent}% complete`}>
      <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="9" />
      <circle cx="50" cy="50" r={r} fill="none" stroke="#fbbf24" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(percent / 100) * c} ${c}`} />
      <text x="50" y="50" transform="rotate(90 50 50)" textAnchor="middle" dominantBaseline="central" fill="currentColor" className="text-[22px] font-semibold">{percent}%</text>
    </svg>
  );
}

/**
 * The compliance roadmap for a household's insurance file: what is up next for the stage it is in, what comes later, what is done, and what has happened.
 * Each item opens where you attach the evidence (a Drive link, a meeting record) or mark it not applicable.
 */
export function ComplianceRoadmap({ householdId, stage }: { householdId: string; stage: InsuranceStage | null }) {
  const [data, setData] = useState<InsFiles | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [openKind, setOpenKind] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [showLater, setShowLater] = useState(false);

  const load = useCallback(async () => { try { setData(await getInsuranceFiles(householdId)); } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't load the insurance files"); } }, [householdId]);
  useEffect(() => { void load(); }, [load]);

  const open = useMemo(() => (data?.files ?? []).filter((f) => f.status === "open"), [data]);
  const file: InsFile | undefined = useMemo(() => (data?.files ?? []).find((f) => f.id === fileId) ?? open[0] ?? data?.files[0], [data, fileId, open]);
  const road = useMemo(() => (file ? roadmap(file.checklist, stage) : null), [file, stage]);
  const labels = useMemo(() => new Map((file ? [...file.checklist, ...file.optional] : []).map((c) => [c.kind, c.label])), [file]);
  const events = useMemo(() => (data ? activity(data.files, (k) => labels.get(k) ?? k) : []), [data, labels]);

  const attach = async (kind: string, input: Parameters<typeof attachInsuranceItem>[2], ok: string) => {
    if (!file) return;
    setBusy(true);
    try { await attachInsuranceItem(file.id, kind, input); toast.success(ok); setLink(""); setOpenKind(null); await load(); } catch (e) { toast.error(e instanceof Error ? e.message : "That didn't work"); } finally { setBusy(false); }
  };

  if (!data) return <Loader2 className="h-5 w-5 animate-spin" />;
  if (!file || !road) return <Card><CardContent className="p-5 text-sm text-muted-foreground">No insurance file yet. Create one under "All files" below and the roadmap will appear here.</CardContent></Card>;

  const next = road.upNext[0];
  const row = (c: RoadmapItem, later = false) => (
    <li key={c.kind} className="rounded-md border bg-card">
      <button type="button" className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm" onClick={() => { setOpenKind(openKind === c.kind ? null : c.kind); setLink(""); }} aria-expanded={openKind === c.kind}>
        {c.done ? <Check className="h-4 w-4 text-green-700" aria-label="Done" /> : <span className="h-4 w-4 rounded-full border" />}
        <span className="flex-1"><span className="font-medium">{c.label}</span>{later && <span className="ml-2 text-xs text-muted-foreground">{stageLabel(c.stage)}</span>}</span>
        {openKind === c.kind ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {openKind === c.kind && !c.done && (
        <div className="space-y-2 border-t px-3 py-3 text-xs">
          <p className="text-muted-foreground">{c.hint}</p>
          {c.kind === "meeting_records" ? (
            <select className="h-8 rounded-md border bg-background px-2" defaultValue="" aria-label="Attach a meeting record" onChange={(e) => e.target.value && void attach(c.kind, { meetingTaskId: e.target.value }, "Attached")}>
              <option value="">Attach a meeting record…</option>
              {data.meetings.map((m) => <option key={m.task_id} value={m.task_id}>{m.doc_name}</option>)}
            </select>
          ) : (
            <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); if (link.trim()) void attach(c.kind, { driveLink: link.trim() }, "Attached"); }}>
              <Input className="h-8 w-72 text-xs" placeholder="Paste the Drive link" aria-label={`Drive link for ${c.label}`} value={link} onChange={(e) => setLink(e.target.value)} />
              <Button type="submit" size="sm" variant="outline" className="h-8 text-xs" disabled={busy}>Attach</Button>
            </form>
          )}
          <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={busy} onClick={() => { const note = window.prompt("Why is this not applicable?") ?? ""; if (note.trim()) void attach(c.kind, { notApplicable: true, note: note.trim() }, "Marked not applicable"); }}>Not applicable</Button>
        </div>
      )}
    </li>
  );

  return (
    <div className="space-y-5" data-testid="compliance-roadmap">
      {data.files.length > 1 && (
        <select className="h-9 rounded-md border bg-background px-2 text-sm" aria-label="Insurance file" value={file.id} onChange={(e) => { setFileId(e.target.value); setOpenKind(null); }}>
          {data.files.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
        </select>
      )}

      <div className="grid gap-4 rounded-xl bg-slate-800 p-6 text-white md:grid-cols-[1fr_auto]" data-testid="progress-panel">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-white/60">{road.upNext.length ? "Up next" : "All caught up"}</p>
          <p className="mt-1 font-serif text-2xl font-semibold">{next ? next.label : road.later.length ? "Nothing due at this stage" : "Every required item is in the file"}</p>
          <p className="mt-1 text-sm text-white/70">{file.title}{stage ? ` · ${stageLabel(stage)}` : ""}</p>
          {next && <Button variant="secondary" className="mt-4" onClick={() => setOpenKind(next.kind)}>Open</Button>}
        </div>
        <div className="flex items-center gap-6">
          <Ring percent={road.percent} />
          <dl className="space-y-1 text-sm"><div className="flex gap-6"><dt className="w-20 text-white/70">Complete</dt><dd className="font-semibold">{road.done}</dd></div><div className="flex gap-6"><dt className="w-20 text-white/70">Remaining</dt><dd className="font-semibold">{road.total - road.done}</dd></div></dl>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <section aria-label="Up next"><h2 className="mb-2 text-sm font-semibold">Up next <span className="text-muted-foreground">{road.upNext.length}</span></h2><ul className="space-y-2">{road.upNext.map((c) => row(c))}{road.upNext.length === 0 && <p className="text-sm text-muted-foreground">Nothing is due at this stage.</p>}</ul></section>
          <section aria-label="Later"><button type="button" className="mb-2 flex items-center gap-1 text-sm font-semibold" onClick={() => setShowLater(!showLater)} aria-expanded={showLater}>{showLater ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}Later <span className="font-normal text-muted-foreground">{road.later.length}</span></button>{showLater && <ul className="space-y-2">{road.later.map((c) => row(c, true))}</ul>}</section>
          <section aria-label="Completed"><h2 className="mb-2 text-sm font-semibold">Completed <span className="text-muted-foreground">{road.completed.length}</span></h2><ul className="space-y-2">{road.completed.map((c) => row(c))}</ul></section>
        </div>
        <Card className="self-start"><CardHeader className="pb-2"><CardTitle className="text-base">Recent activity</CardTitle></CardHeader>
          <CardContent><ul className="space-y-3 text-sm" data-testid="activity">{events.map((e, i) => <li key={i}><p>{e.text}</p><p className="text-xs text-muted-foreground">{when(e.at)}</p></li>)}{events.length === 0 && <li className="text-muted-foreground">Nothing yet.</li>}</ul></CardContent></Card>
      </div>
    </div>
  );
}
