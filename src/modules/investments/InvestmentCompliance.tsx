import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { Check, ChevronDown, ChevronRight, ExternalLink, FileSignature, Loader2, Trash2 } from "lucide-react";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { attachInvestmentItem, createInvestmentFile, getInvestmentFiles, previewInsuranceDoc, removeInvestmentItem, sendInsuranceDoc, type InsDocPreview, type InvFile, type InvFiles } from "@/modules/crm/lib/reviewAgent";
import { investmentStageLabel, type InvestmentStage } from "@/shared/lib/investmentPipeline";
import { roadmap, type RoadmapItem } from "@/shared/lib/investmentRoadmap";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Vancouver", month: "short", day: "numeric", year: "numeric" });
const COVERED_BY: Record<string, string> = { advisor_disclosure: "the client's signed disclosure", privacy_consent: "the client's signed disclosure", casl_consent: "the client's signed disclosure", fact_find: "a saved investor profile with the risk profile recorded" };

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
 * The compliance roadmap for a household's segregated funds file: the MGA's six items, by stage. The disclosure, privacy and CASL consents come from the client's
 * signed disclosure (the same one as for insurance); the fact find, needs analysis and risk tolerance from the investor profile; the rest are attached here.
 */
export function InvestmentCompliance({ householdId, stage }: { householdId: string; stage: InvestmentStage | null }) {
  const [data, setData] = useState<InvFiles | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [openKind, setOpenKind] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [showLater, setShowLater] = useState(false);
  const [preview, setPreview] = useState<InsDocPreview | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<InvFile["kind"]>("new_sale");

  const load = useCallback(async () => { try { setData(await getInvestmentFiles(householdId)); } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't load the investment files"); } }, [householdId]);
  useEffect(() => { void load(); }, [load]);
  const run = async (fn: () => Promise<unknown>, ok?: string) => { setBusy(true); try { await fn(); if (ok) toast.success(ok); await load(); } catch (e) { toast.error(e instanceof Error ? e.message : "That didn't work"); } finally { setBusy(false); } };

  const open = useMemo(() => (data?.files ?? []).filter((f) => f.status === "open"), [data]);
  const file: InvFile | undefined = useMemo(() => (data?.files ?? []).find((f) => f.id === fileId) ?? open[0] ?? data?.files[0], [data, fileId, open]);
  const road = useMemo(() => (file ? roadmap(file.checklist, stage) : null), [file, stage]);

  const attach = (kindKey: string, input: Parameters<typeof attachInvestmentItem>[2], ok: string) => file && run(async () => { await attachInvestmentItem(file.id, kindKey, input); setLink(""); setOpenKind(null); }, ok);
  const prepare = (ids?: string[]) => run(async () => { const p = await previewInsuranceDoc(householdId, "disclosure_privacy", ids); setPreview(p); setPicked(ids ?? p.signers.map((s) => s.id)); });
  const togglePerson = async (id: string) => { const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]; if (next.length) { setPicked(next); await prepare(next); } };

  if (!data) return <Loader2 className="h-5 w-5 animate-spin" />;
  const d = data.disclosure;
  const dStatus = !d ? "Not sent yet" : d.status === "signed" ? `Signed${d.signedAt ? ` ${day(d.signedAt)}` : ""}` : d.status === "partly_signed" ? "Partly signed" : "Waiting on the client";

  const row = (c: RoadmapItem, later = false) => (
    <li key={c.kind} className="rounded-md border bg-card">
      <button type="button" className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm" onClick={() => { setOpenKind(openKind === c.kind ? null : c.kind); setLink(""); }} aria-expanded={openKind === c.kind}>
        {c.done ? <Check className="h-4 w-4 text-green-700" aria-label="Done" /> : <span className="h-4 w-4 rounded-full border" />}
        <span className="flex-1"><span className="font-medium">{c.label}</span>{c.covered && <span className="ml-2 text-xs text-muted-foreground">covered by {COVERED_BY[c.kind]}</span>}{later && <span className="ml-2 text-xs text-muted-foreground">{investmentStageLabel(c.stage)}</span>}</span>
        {openKind === c.kind ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {openKind === c.kind && !c.done && (
        <div className="space-y-2 border-t px-3 py-3 text-xs">
          <p className="text-muted-foreground">{c.hint}</p>
          {c.kind === "fact_find" && <Link to={`/investments/${householdId}/profile`} className="inline-block font-medium text-primary hover:underline" data-testid="work-page-link">Open the Investor profile</Link>}
          {["advisor_disclosure", "privacy_consent", "casl_consent"].includes(c.kind) && <p className="text-muted-foreground">Send the disclosure for signature above. It covers all three.</p>}
          {c.kind === "advisor_notes" ? (
            <select className="h-8 rounded-md border bg-background px-2" defaultValue="" aria-label="Attach a meeting record" onChange={(e) => e.target.value && void attach(c.kind, { meetingTaskId: e.target.value }, "Attached")}>
              <option value="">Attach a meeting record…</option>
              {data.meetings.map((m) => <option key={m.task_id} value={m.task_id}>{m.doc_name}</option>)}
            </select>
          ) : null}
          {!["advisor_disclosure", "privacy_consent", "casl_consent"].includes(c.kind) && (
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
    <div className="space-y-5" data-testid="investment-compliance">
      <Card data-testid="disclosure-card">
        <CardContent className="space-y-3 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <FileSignature className="h-5 w-5" />
            <div className="min-w-0 flex-1"><p className="font-medium">Advisor Disclosure, Privacy Consent and CASL Consent</p><p className="text-xs text-muted-foreground">The client's own signed record, shared with Insurance: signed once, it counts for both. <Badge variant={d?.status === "signed" ? "default" : "secondary"} className="ml-1 text-[10px]">{dStatus}</Badge></p></div>
            {d?.status !== "signed" && <Button size="sm" disabled={busy} onClick={() => void prepare()}>{d ? "Prepare a new copy" : "Prepare"}</Button>}
          </div>
          {preview && (
            <div className="space-y-3 rounded-md border bg-muted/30 p-4" data-testid="doc-preview">
              {preview.warnings.map((w) => <p key={w} className="text-xs text-amber-700">{w}</p>)}
              <div className="max-h-72 overflow-y-auto rounded border bg-background p-4 text-sm leading-relaxed"><ReactMarkdown>{preview.md.replace("{{casl_choice}}", "")}</ReactMarkdown></div>
              <div className="flex flex-wrap items-center gap-4">
                <fieldset className="flex flex-wrap items-center gap-3"><legend className="sr-only">Who signs</legend>{preview.signers.map((s) => <label key={s.id} className="flex items-center gap-1.5"><input type="checkbox" checked={picked.includes(s.id)} onChange={() => void togglePerson(s.id)} disabled={busy} />{s.name}</label>)}</fieldset>
                <Button disabled={busy || picked.length === 0} onClick={() => void run(async () => { await sendInsuranceDoc(householdId, "disclosure_privacy", picked); setPreview(null); }, "Sent to the client portal")}>Send to the client portal</Button>
                <Button variant="ghost" onClick={() => setPreview(null)}>Cancel</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {!file || !road ? (
        <Card><CardContent className="space-y-3 p-5 text-sm">
          <p className="text-muted-foreground">No investment file yet. A file holds the MGA's checklist for one sale or review; create one to start the roadmap.</p>
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (title.trim().length >= 3) void run(async () => { await createInvestmentFile(householdId, title.trim(), kind); setTitle(""); }, "File created"); }}>
            <label className="text-xs">File name<Input className="mt-1 h-9 w-64" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="For example: Justin Santos, RRSP" aria-label="Investment file name" /></label>
            <label className="text-xs">Type<select className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value as InvFile["kind"])}><option value="new_sale">New sale</option><option value="review">Review</option></select></label>
            <Button type="submit" size="sm" disabled={busy || title.trim().length < 3}>Create file</Button>
          </form>
        </CardContent></Card>
      ) : (
        <>
          {data.files.length > 1 && <select className="h-9 rounded-md border bg-background px-2 text-sm" aria-label="Investment file" value={file.id} onChange={(e) => { setFileId(e.target.value); setOpenKind(null); }}>{data.files.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}</select>}
          <div className="grid gap-4 rounded-xl bg-slate-800 p-6 text-white md:grid-cols-[1fr_auto]" data-testid="progress-panel">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-white/60">{road.upNext.length ? "Up next" : "All caught up"}</p>
              <p className="mt-1 font-serif text-2xl font-semibold">{road.upNext[0]?.label ?? (road.later.length ? "Nothing due at this stage" : "Every required item is in the file")}</p>
              <p className="mt-1 text-sm text-white/70">{file.title}{stage ? ` · ${investmentStageLabel(stage)}` : ""}</p>
              {road.upNext[0] && <Button variant="secondary" className="mt-4" onClick={() => setOpenKind(road.upNext[0].kind)}>Open</Button>}
            </div>
            <div className="flex items-center gap-6"><Ring percent={road.percent} /><dl className="space-y-1 text-sm"><div className="flex gap-6"><dt className="w-20 text-white/70">Complete</dt><dd className="font-semibold">{road.done}</dd></div><div className="flex gap-6"><dt className="w-20 text-white/70">Remaining</dt><dd className="font-semibold">{road.total - road.done}</dd></div></dl></div>
          </div>
          <section aria-label="Up next"><h2 className="mb-2 text-sm font-semibold">Up next <span className="text-muted-foreground">{road.upNext.length}</span></h2><ul className="space-y-2">{road.upNext.map((c) => row(c))}{road.upNext.length === 0 && <p className="text-sm text-muted-foreground">Nothing is due at this stage.</p>}</ul></section>
          <section aria-label="Later"><button type="button" className="mb-2 flex items-center gap-1 text-sm font-semibold" onClick={() => setShowLater(!showLater)} aria-expanded={showLater}>{showLater ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}Later <span className="text-muted-foreground">{road.later.length}</span></button>{showLater && <ul className="space-y-2">{road.later.map((c) => row(c, true))}</ul>}</section>
          <section aria-label="Completed"><h2 className="mb-2 text-sm font-semibold">Completed <span className="text-muted-foreground">{road.completed.length}</span></h2><ul className="space-y-2">{road.completed.map((c) => row(c))}</ul></section>

          <Card><CardHeader className="pb-2"><CardTitle className="text-base">In the file</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm" data-testid="file-items">
              {file.items.length === 0 && <p className="text-muted-foreground">Nothing attached yet.</p>}
              {file.items.map((i) => (
                <p key={i.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium">{[...file.checklist, ...file.optional].find((c) => c.kind === i.kind)?.label ?? i.kind}</span>
                  {i.status === "not_applicable" ? <span className="text-muted-foreground">Not applicable{i.note ? `: ${i.note}` : ""}</span> : <a href={i.drive_url ?? "#"} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">{i.drive_name}<ExternalLink className="h-3 w-3" /></a>}
                  <span className="text-muted-foreground">added {day(i.added_at)}</span>
                  <button type="button" aria-label="Remove" className="text-muted-foreground hover:text-destructive" disabled={busy} onClick={() => void run(() => removeInvestmentItem(i.id))}><Trash2 className="h-3 w-3" /></button>
                </p>
              ))}
              <details className="pt-1 text-xs"><summary className="cursor-pointer font-medium">Also keep in the file (optional)</summary>
                <div className="mt-2 space-y-1.5">{file.optional.map((o) => (
                  <form key={o.kind} className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); const v = (e.currentTarget.elements.namedItem("link") as HTMLInputElement).value.trim(); if (v) void attach(o.kind, { driveLink: v }, "Attached"); e.currentTarget.reset(); }}>
                    <span className="w-56">{o.label}</span><Input name="link" className="h-8 w-64 text-xs" placeholder="Paste the Drive link" aria-label={`Drive link for ${o.label}`} /><Button type="submit" size="sm" variant="outline" className="h-8 text-xs" disabled={busy}>Attach</Button>
                  </form>
                ))}</div>
              </details>
            </CardContent></Card>
        </>
      )}
    </div>
  );
}
