import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { supabase } from "@/shared/integrations/supabase/client";
import { getInvestmentFiles, getInvestmentProfiles, type InvFiles, type InvModel, type InvProfileRow } from "@/modules/crm/lib/reviewAgent";
import { investmentStageLabel, type InvestmentStage } from "@/shared/lib/investmentPipeline";
import { profileGaps } from "@/shared/lib/investorProfile";

const money = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

/** Where the household stands: the stage, each person's profile and risk profile, the file's checklist, and what they hold today. */
export function InvestmentOverview({ householdId, stage }: { householdId: string; stage: InvestmentStage | null }) {
  const [files, setFiles] = useState<InvFiles | null>(null);
  const [prof, setProf] = useState<{ adults: { id: string; name: string }[]; profiles: InvProfileRow[]; models: InvModel[] } | null>(null);
  const [held, setHeld] = useState<Record<string, number>>({});
  useEffect(() => {
    void (async () => {
      const [f, p] = await Promise.all([getInvestmentFiles(householdId).catch(() => null), getInvestmentProfiles(householdId).catch(() => null)]);
      setFiles(f); setProf(p);
      const ids = (p?.adults ?? []).map((a) => a.id);
      if (ids.length) {
        const { data } = await supabase.from("vineyard_accounts").select("contact_id, current_value").in("contact_id", ids);
        const sums: Record<string, number> = {};
        for (const r of data ?? []) sums[r.contact_id as string] = (sums[r.contact_id as string] ?? 0) + (Number(r.current_value) || 0);
        setHeld(sums);
      }
    })();
  }, [householdId]);
  if (!files || !prof) return <Loader2 className="h-5 w-5 animate-spin" />;
  const file = files.files.find((f) => f.status === "open") ?? files.files[0];
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="investment-overview">
      <Card><CardHeader className="pb-2"><CardTitle className="text-base">Where this household is</CardTitle></CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          <p>Stage: <span className="font-medium">{stage ? investmentStageLabel(stage) : "Not on the board"}</span></p>
          <p>Disclosure, privacy and CASL: <span className="font-medium">{files.disclosure ? (files.disclosure.status === "signed" ? "signed" : files.disclosure.status === "void" ? "not sent" : "waiting on the client") : "not sent yet"}</span></p>
          {file ? <p>Compliance file: <Link to={`/investments/${householdId}/compliance`} className="font-medium text-primary hover:underline">{file.title}</Link>, {file.progress.done} of {file.progress.required} required items{file.progress.complete ? " (complete)" : ""}</p> : <p>Compliance file: <Link to={`/investments/${householdId}/compliance`} className="text-primary hover:underline">none yet</Link></p>}
        </CardContent></Card>
      <Card><CardHeader className="pb-2"><CardTitle className="text-base">People</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {prof.adults.map((a) => {
            const last = prof.profiles.find((p) => p.contact_id === a.id);
            const model = prof.models.find((m) => m.profile_key === last?.risk_profile);
            const gaps = last ? profileGaps(last.inputs) : ["everything"];
            return (
              <div key={a.id} className="space-y-0.5" data-testid={`person-${a.id}`}>
                <p className="font-medium">{a.name}</p>
                <p className="text-xs text-muted-foreground">Risk profile: {model ? model.label : "not recorded yet"} · Held today: {held[a.id] ? money(held[a.id]) : "nothing on file"}</p>
                <p className="text-xs text-muted-foreground">{last ? (gaps.length ? `Profile saved, still to fill in: ${gaps.join(", ")}.` : "Profile complete.") : "No investor profile yet."} <Link to={`/investments/${householdId}/profile`} className="text-primary hover:underline">Open</Link></p>
              </div>
            );
          })}
        </CardContent></Card>
    </div>
  );
}
