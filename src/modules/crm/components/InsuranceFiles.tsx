import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Circle, ExternalLink, Loader2, Trash2 } from "lucide-react";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { attachInsuranceItem, buildInsurancePackage, createInsuranceFile, getInsuranceFiles, removeInsuranceItem, type InsFile, type InsFiles } from "@/modules/crm/lib/reviewAgent";

const KIND: Record<InsFile["kind"], string> = { new_sale: "New sale", replacement: "Replacement", in_force_review: "In-force review" };
const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Vancouver", month: "short", day: "numeric", year: "numeric" });

/** One file per insurance sale or policy: what must be in it, what is, and a button that builds the audit package in the household's Advisor Files. */
export function InsuranceFiles({ householdId }: { householdId: string }) {
  const [data, setData] = useState<InsFiles | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<InsFile["kind"]>("new_sale");
  const [policyId, setPolicyId] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const load = useCallback(async () => { try { setData(await getInsuranceFiles(householdId)); } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't load the insurance files"); } }, [householdId]);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); await load(); } catch (e) { toast.error(e instanceof Error ? e.message : "That didn't work"); } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-lg">Insurance files</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">One file per insurance sale or policy, with what an insurer or regulator expects to see. Attach each item (paste its Drive link, attach a meeting record, or mark it not applicable). When it is ready, create the audit package: a dated folder in this household's Advisor Files with copies and an index. Georgia reminds you each week about anything missing.</p>
        {!data ? <Loader2 className="h-4 w-4 animate-spin" /> : (
          <>
            {data.files.length === 0 && <p className="text-muted-foreground">No insurance files yet.</p>}
            {data.files.map((f) => (
              <div key={f.id} className="rounded-md border">
                <button type="button" className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left" onClick={() => setOpenId(openId === f.id ? null : f.id)} aria-expanded={openId === f.id}>
                  <span className="font-medium">{f.title}</span>
                  <Badge variant="outline" className="text-[10px]">{KIND[f.kind]}</Badge>
                  <Badge variant={f.progress.complete ? "default" : "secondary"} className="text-[10px]">{f.progress.complete ? "Complete" : `${f.progress.done} of ${f.progress.required} required`}</Badge>
                  {f.package_url && <span className="text-xs text-muted-foreground">package {f.packaged_at ? day(f.packaged_at) : ""}</span>}
                </button>
                {openId === f.id && (
                  <div className="space-y-3 border-t px-3 py-3">
                    <ul className="space-y-2">
                      {[...f.checklist, ...f.optional.map((o) => ({ ...o, done: f.items.some((i) => i.kind === o.kind) }))].map((c) => {
                        const mine = f.items.filter((i) => i.kind === c.kind);
                        const required = f.checklist.some((r) => r.kind === c.kind);
                        return (
                          <li key={c.kind} className="space-y-1">
                            <div className="flex items-start gap-2">
                              {c.done ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-700" aria-label="In the file" /> : <Circle className={`mt-0.5 h-4 w-4 shrink-0 ${required ? "text-destructive" : "text-muted-foreground"}`} aria-label="Missing" />}
                              <div className="min-w-0 flex-1"><p className="font-medium">{c.label}{!required && <span className="font-normal text-muted-foreground"> (optional)</span>}</p><p className="text-xs text-muted-foreground">{c.hint}</p></div>
                            </div>
                            {mine.map((i) => (
                              <div key={i.id} className="ml-6 flex items-center gap-2 text-xs">
                                {i.status === "not_applicable" ? <span className="text-muted-foreground">Not applicable{i.note ? `: ${i.note}` : ""}</span> : <a href={i.drive_url ?? "#"} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">{i.drive_name}<ExternalLink className="h-3 w-3" /></a>}
                                <span className="text-muted-foreground">added {day(i.added_at)}</span>
                                <button type="button" aria-label="Remove" className="text-muted-foreground hover:text-destructive" disabled={busy} onClick={() => void run(() => removeInsuranceItem(i.id))}><Trash2 className="h-3 w-3" /></button>
                              </div>
                            ))}
                            {!c.done && (
                              <div className="ml-6 flex flex-wrap items-center gap-2">
                                {c.kind === "meeting_records" ? (
                                  <select className="h-8 rounded-md border bg-background px-2 text-xs" defaultValue="" aria-label="Attach a meeting record" onChange={(e) => { const v = e.target.value; if (v) void run(() => attachInsuranceItem(f.id, c.kind, { meetingTaskId: v }), "Attached"); }}>
                                    <option value="">Attach a meeting record…</option>
                                    {data.meetings.map((m) => <option key={m.task_id} value={m.task_id}>{m.doc_name}</option>)}
                                  </select>
                                ) : (
                                  <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); const v = (links[`${f.id}:${c.kind}`] ?? "").trim(); if (v) void run(async () => { await attachInsuranceItem(f.id, c.kind, { driveLink: v }); setLinks((l) => ({ ...l, [`${f.id}:${c.kind}`]: "" })); }, "Attached"); }}>
                                    <Input className="h-8 w-64 text-xs" placeholder="Paste the Drive link" aria-label={`Drive link for ${c.label}`} value={links[`${f.id}:${c.kind}`] ?? ""} onChange={(e) => setLinks((l) => ({ ...l, [`${f.id}:${c.kind}`]: e.target.value }))} />
                                    <Button type="submit" size="sm" variant="outline" className="h-8 text-xs" disabled={busy}>Attach</Button>
                                  </form>
                                )}
                                {required && <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={busy} onClick={() => { const note = window.prompt("Why is this not applicable?") ?? ""; if (note.trim()) void run(() => attachInsuranceItem(f.id, c.kind, { notApplicable: true, note: note.trim() }), "Marked not applicable"); }}>Not applicable</Button>}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                      <Button size="sm" disabled={busy} onClick={() => { if (!f.progress.complete && !window.confirm("Some required items are missing. The package will show them as missing. Create it anyway?")) return; void run(async () => { const r = await buildInsurancePackage(f.id); toast.success(r.complete ? "Audit package created" : `Audit package created (${r.missing.length} missing)`, { action: { label: "Open", onClick: () => window.open(r.url, "_blank") } }); if (r.copyFailures.length) toast.warning(`Some files could not be copied: ${r.copyFailures.join(", ")}`); }); }}>{busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}Create audit package</Button>
                      {f.package_url && <a href={f.package_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">Open the latest package<ExternalLink className="h-3 w-3" /></a>}
                    </div>
                  </div>
                )}
              </div>
            ))}
            <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (title.trim().length >= 3) void run(async () => { await createInsuranceFile(householdId, title.trim(), kind, policyId || undefined); setTitle(""); setPolicyId(""); }, "File created"); }}>
              <label className="text-xs">New insurance file<Input className="mt-1 h-9 w-64" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="For example: Colleen Jerczynski, term 20" aria-label="Insurance file name" /></label>
              <label className="text-xs">Type<select className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value as InsFile["kind"])}>{(Object.keys(KIND) as InsFile["kind"][]).map((k) => <option key={k} value={k}>{KIND[k]}</option>)}</select></label>
              {data.policies.length > 0 && <label className="text-xs">Policy (optional)<select className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm" value={policyId} onChange={(e) => setPolicyId(e.target.value)}><option value="">None</option>{data.policies.map((p) => <option key={p.id} value={p.id}>{[p.carrier, p.policy_type.replace(/_/g, " "), p.policy_number].filter(Boolean).join(", ")}</option>)}</select></label>}
              <Button type="submit" size="sm" disabled={busy || title.trim().length < 3}>Create file</Button>
            </form>
          </>
        )}
      </CardContent>
    </Card>
  );
}
