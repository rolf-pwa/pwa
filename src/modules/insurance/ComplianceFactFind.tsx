import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { compileFactFind, getFactFinds, getInsuranceFiles, saveFactFind, sendFactFind, type FactFindRow, type FactRow, type InsFile } from "@/modules/crm/lib/reviewAgent";
import { SECTIONS } from "@/shared/lib/factFind";

const SOURCE_LABEL: Record<FactRow["source"]["type"], string> = { file: "On file", onboarding: "Onboarding", meeting: "Meeting", call: "Call", client: "Edited", none: "Missing" };
const STATUS: Record<FactFindRow["status"], string> = { draft: "Draft", sent: "Waiting on the client", confirmed: "Confirmed by the client" };

/**
 * The fact find for one person: what is on file, plus what the meeting notes and call transcripts say (each with the quote it came from), and what is still
 * missing. Rolf edits it, then sends it to the client to confirm in the portal; the confirmed copy is filed as a PDF and ticks the checklist.
 */
export function ComplianceFactFind({ householdId, onChanged }: { householdId: string; onChanged?: () => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getFactFinds>> | null>(null);
  const [files, setFiles] = useState<InsFile[]>([]);
  const [personId, setPersonId] = useState("");
  const [fileId, setFileId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const [d, f] = await Promise.all([getFactFinds(householdId), getInsuranceFiles(householdId)]);
      setData(d); setFiles(f.files.filter((x) => x.status === "open"));
      setPersonId((cur) => cur || d.adults[0]?.id || "");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't load the fact find"); setData({ adults: [], finds: [] }); }
  }, [householdId]);
  useEffect(() => { void load(); }, [load]);

  const find = useMemo(() => data?.finds.find((f) => f.contact_id === personId) ?? null, [data, personId]);
  useEffect(() => { setValues(Object.fromEntries((find?.facts ?? []).map((f) => [f.key, f.value]))); }, [find]);
  useEffect(() => { setFileId((cur) => cur || find?.file_id || files[0]?.id || ""); }, [find, files]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); await load(); onChanged?.(); } catch (e) { toast.error(e instanceof Error ? e.message : "That didn't work"); } finally { setBusy(false); }
  };
  const edits = () => (find?.facts ?? []).filter((f) => (values[f.key] ?? "") !== f.value).map((f) => ({ key: f.key, value: values[f.key] ?? "" }));

  if (!data) return <Loader2 className="h-5 w-5 animate-spin" />;
  const locked = find?.status === "confirmed";
  const missing = (find?.facts ?? []).filter((f) => !(values[f.key] ?? "").trim());
  return (
    <Card data-testid="compliance-factfind">
      <CardHeader className="pb-3"><CardTitle className="text-lg">Fact find</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">Compiled from the file, your meeting notes and call transcripts. Every fact taken from a meeting or call shows the exact words it came from, and anything the notes do not state stays blank. Edit it, then send it to the client to confirm.</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs">Person<select className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm" value={personId} onChange={(e) => { setPersonId(e.target.value); setNote(""); }}>{data.adults.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <Button size="sm" disabled={busy || !personId} onClick={() => void run(async () => { const r = await compileFactFind(householdId, personId, fileId || undefined); setNote([r.note, r.fromNotes ? `${r.fromNotes} fact${r.fromNotes === 1 ? "" : "s"} found in meetings and calls.` : "", r.dropped ? `${r.dropped} suggestion${r.dropped === 1 ? " was" : "s were"} left out because the quote could not be found in the source.` : ""].filter(Boolean).join(" ")); }, "Compiled")}>{find ? "Compile again" : "Compile"}</Button>
          {find && <Badge variant={find.status === "confirmed" ? "default" : "secondary"} className="text-[10px]">{STATUS[find.status]}</Badge>}
        </div>
        {note && <p className="text-xs text-muted-foreground" data-testid="ff-note">{note}</p>}

        {find && (
          <div className="space-y-4" data-testid="ff-facts">
            {SECTIONS.map((s) => {
              const rows = find.facts.filter((f) => f.section === s.key);
              if (!rows.length) return null;
              return (
                <section key={s.key} aria-label={s.label}>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s.label}</h3>
                  <ul className="space-y-2">
                    {rows.map((f) => {
                      const v = values[f.key] ?? "";
                      return (
                        <li key={f.key} className={`rounded-md border p-2.5 ${!v.trim() ? "border-amber-300 bg-amber-50/50" : ""}`}>
                          <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{f.label}</span><Badge variant="outline" className="text-[10px]">{SOURCE_LABEL[v.trim() ? (v === f.value ? f.source.type : "client") : "none"]}{f.source.label && v === f.value && f.source.type !== "none" && f.source.type !== "client" ? `: ${f.source.label}${f.source.date ? `, ${f.source.date}` : ""}` : ""}</Badge></div>
                          <textarea className="mt-1.5 block min-h-[38px] w-full rounded-md border bg-background px-2 py-1.5 text-sm" rows={1} value={v} disabled={locked} placeholder="Not found. Ask the client, or type it in." onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
                          {f.source.quote && v === f.value && <p className="mt-1 text-xs italic text-muted-foreground">“{f.source.quote}”</p>}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
            {find.evidence.length > 0 && <p className="text-xs text-muted-foreground">Sources read: {find.evidence.map((e) => e.label).join("; ")}.</p>}
            {missing.length > 0 && <p className="text-xs text-amber-700">{missing.length} item{missing.length === 1 ? " is" : "s are"} still blank. The client sees these as "Not yet provided", so you may want to ask before sending.</p>}
            {!locked && (
              <div className="flex flex-wrap items-center gap-3 border-t pt-3">
                <Button size="sm" variant="outline" disabled={busy || edits().length === 0} onClick={() => void run(() => saveFactFind(find.id, edits()), "Saved")}>Save edits</Button>
                {files.length > 0 && <label className="flex items-center gap-1.5 text-xs">Tick it off in<select className="h-8 rounded-md border bg-background px-2" value={fileId} onChange={(e) => setFileId(e.target.value)}><option value="">no file</option>{files.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}</select></label>}
                <Button size="sm" disabled={busy} onClick={() => void run(async () => { if (edits().length) await saveFactFind(find.id, edits()); await sendFactFind(find.id, fileId || undefined); }, "Sent to the client portal")}>{find.status === "sent" ? "Send again" : "Send to the client to confirm"}</Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
