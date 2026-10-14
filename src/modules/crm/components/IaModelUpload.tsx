import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { readModelPdf, saveModels, type ModelValidation } from "@/modules/crm/lib/reviewAgent";

const day = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : "—");

/** Upload iA's published Model Portfolios PDF: it is read, checked, shown for review, and only then saved as a new dated set. */
export function IaModelUpload({ currentAsOf, onSaved }: { currentAsOf: string | null; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<ModelValidation | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) { toast.error("Choose the PDF"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("That file is over 5 MB"); return; }
    setBusy(true); setResult(null); setFileName(file.name);
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
        r.onerror = () => reject(new Error("Couldn't read the file"));
        r.readAsDataURL(file);
      });
      setResult((await readModelPdf(b64)).validation);
    } catch (e: any) { toast.error(e?.message ?? "Couldn't read that document"); }
    finally { setBusy(false); }
  };

  const save = async () => {
    if (!result?.ok || !result.parsed.asOf) return;
    setBusy(true);
    try { await saveModels(result.parsed.asOf, result.parsed.models, fileName); toast.success(`Model portfolios as at ${day(result.parsed.asOf)} saved`); setResult(null); onSaved(); }
    catch (e: any) { toast.error(e?.message ?? "Couldn't save"); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-lg">iA model portfolios</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">In use: {currentAsOf ? `as at ${day(currentAsOf)}` : "none loaded"}. When iA publishes a new Model Portfolios PDF, upload it here. It is read, checked and shown for you to review before anything is saved. Existing profiles pick up the new ranges and funds straight away.</p>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} {busy ? "Working…" : "Upload the model portfolios PDF"}
          <input type="file" accept="application/pdf,.pdf" className="hidden" disabled={busy} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        {result && (
          <div className="space-y-3 rounded-md border p-3">
            <p className="font-medium">{fileName}: as at {day(result.parsed.asOf)}</p>
            {result.errors.map((e, i) => <p key={i} className="flex gap-2 text-destructive"><Badge variant="destructive" className="shrink-0 text-[10px]">Problem</Badge>{e}</p>)}
            {result.warnings.map((w, i) => <p key={i} className="flex gap-2"><Badge variant="secondary" className="shrink-0 text-[10px]">Check</Badge>{w}</p>)}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b text-left text-muted-foreground"><th className="py-1 pr-2">Profile</th><th className="px-2">Income range</th><th className="px-2">Equity range</th><th className="px-2">Fixed income</th><th className="pl-2">Funds</th></tr></thead>
                <tbody>
                  {result.parsed.models.map((m) => (
                    <tr key={m.key} className="border-b align-top last:border-0">
                      <td className="py-1 pr-2 font-medium">{m.label}</td><td className="px-2">{m.incomeMin}–{m.incomeMax}%</td><td className="px-2">{m.equityMin}–{m.equityMax}%</td><td className="px-2">{m.incomeTarget}%</td>
                      <td className="pl-2">{m.funds.map((f) => `${f.name} ${f.weight}%`).join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={!result.ok || busy} onClick={save}>{result.ok ? "Save as the current models" : "Can't save: fix the problems"}</Button>
              <Button size="sm" variant="ghost" onClick={() => setResult(null)}>Discard</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
