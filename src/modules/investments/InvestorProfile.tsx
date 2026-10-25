import { useCallback, useEffect, useMemo, useState } from "react";
import { useResetOnChange } from "@/shared/hooks/useResetOnChange";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Input } from "@/shared/components/ui/input";
import { supabase } from "@/shared/integrations/supabase/client";
import { fileInvestmentProfile, getInvestmentProfiles, saveInvestmentProfile, type InvModel, type InvProfileRow } from "@/modules/crm/lib/reviewAgent";
import { EMPTY_PROFILE, GUARANTEE, KNOWLEDGE, OBJECTIVES, STABILITY, profileGaps, type ProfileInputs } from "@/shared/lib/investorProfile";

const num = (v: string) => (v === "" ? 0 : Number(v) || 0);
const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Vancouver", month: "short", day: "numeric", year: "numeric" });

const Select = ({ label, value, options, onChange }: { label: string; value: string; options: Record<string, string>; onChange: (v: string) => void }) => (
  <label className="block text-xs">{label}
    <select className="mt-1 block h-9 w-full rounded-md border bg-background px-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Not recorded</option>
      {Object.entries(options).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  </label>
);

/** One person's investor profile and needs analysis. It starts from the last saved version; each save is kept with its date. */
function PersonProfile({ person, householdId, versions, models, onSaved }: { person: { id: string; name: string }; householdId: string; versions: InvProfileRow[]; models: InvModel[]; onSaved: () => void }) {
  const last = versions[0];
  const [i, setI] = useState<ProfileInputs>({ ...EMPTY_PROFILE, ...(last?.inputs ?? {}) });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  useResetOnChange(() => { setI({ ...EMPTY_PROFILE, ...(last?.inputs ?? {}) }); }, [last?.id]);
  const set = <K extends keyof ProfileInputs>(k: K, v: ProfileInputs[K]) => setI((p) => ({ ...p, [k]: v }));
  const gaps = useMemo(() => profileGaps(i), [i]);
  const model = models.find((m) => m.profile_key === i.riskProfile);

  const prefill = async () => {
    const [{ data: acc }, { data: liab }] = await Promise.all([
      supabase.from("vineyard_accounts").select("current_value").eq("contact_id", person.id),
      supabase.from("liabilities").select("current_balance").eq("contact_id", person.id),
    ]);
    const sum = (rows: any[] | null, k: string) => Math.round((rows ?? []).reduce((n, r) => n + (Number(r[k]) || 0), 0));
    setI((p) => ({ ...p, currentInvestments: sum(acc, "current_value") || p.currentInvestments, liabilities: sum(liab, "current_balance") || p.liabilities }));
    toast.success("Filled in from the investments and debts on file");
  };
  const save = async () => { setBusy("save"); try { await saveInvestmentProfile(householdId, person.id, i, note || undefined); toast.success("Profile saved"); setNote(""); onSaved(); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save the profile"); } finally { setBusy(null); } };
  const file = async (id: string) => { setBusy(id); try { await fileInvestmentProfile(id); toast.success("Filed as a PDF in Advisor Files"); onSaved(); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not file the PDF"); } finally { setBusy(null); } };

  const text = (label: string, key: "sourceOfFunds" | "accountTypes" | "liquidityNeedsWhen" | "riskProfileEvidence", placeholder = "") => <label className="block text-xs">{label}<Input className="mt-1" value={i[key]} placeholder={placeholder} onChange={(e) => set(key, e.target.value)} /></label>;
  const amount = (label: string, key: "timeHorizonYears" | "amountToInvest" | "annualIncome" | "currentInvestments" | "liabilities" | "liquidityNeedsAmount" | "experienceYears", suffix = "") => <label className="block text-xs">{label}<span className="mt-1 flex items-center gap-1.5"><Input type="number" min={0} value={i[key] || ""} placeholder="0" onChange={(e) => set(key, num(e.target.value))} />{suffix && <span className="text-muted-foreground">{suffix}</span>}</span></label>;

  return (
    <Card data-testid={`profile-${person.id}`}>
      <CardHeader className="pb-3"><CardTitle className="text-lg">{person.name}</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        <fieldset className="space-y-2"><legend className="text-xs font-medium">Objectives</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">{Object.entries(OBJECTIVES).map(([k, label]) => <label key={k} className="flex items-center gap-2"><Checkbox checked={i.objectives.includes(k)} onCheckedChange={() => set("objectives", i.objectives.includes(k) ? i.objectives.filter((o) => o !== k) : [...i.objectives, k])} aria-label={label} />{label}</label>)}</div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          {amount("Time horizon", "timeHorizonYears", "years")}
          {amount("Amount to invest", "amountToInvest")}
          {text("Where the money comes from", "sourceOfFunds", "for example: sale of a property, savings")}
          {text("Kind of accounts", "accountTypes", "for example: RRSP, TFSA, non-registered")}
          {amount("Annual income", "annualIncome")}
          <Select label="Income stability" value={i.incomeStability} options={STABILITY} onChange={(v) => set("incomeStability", v)} />
          {amount("Investments held today", "currentInvestments")}
          {amount("Debts", "liabilities")}
          {amount("Money that may be needed soon", "liquidityNeedsAmount")}
          {text("When", "liquidityNeedsWhen", "for example: within 3 years")}
          <Select label="Investment knowledge" value={i.knowledge} options={KNOWLEDGE} onChange={(v) => set("knowledge", v)} />
          {amount("Years investing", "experienceYears")}
          <Select label="Importance of guarantees" value={i.guaranteeImportance} options={GUARANTEE} onChange={(v) => set("guaranteeImportance", v)} />
        </div>
        <Button size="sm" variant="outline" onClick={() => void prefill()}>Fill in investments and debts from the file</Button>
        <label className="block text-xs">Concerns and notes<textarea className="mt-1 block min-h-[60px] w-full rounded-md border bg-background px-3 py-2 text-sm" value={i.concerns} onChange={(e) => set("concerns", e.target.value)} /></label>

        <fieldset className="space-y-3 rounded-md border bg-muted/30 p-3"><legend className="px-1 text-xs font-medium">Risk profile, from the iA investor profile completed with the application</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs">Risk profile
              <select className="mt-1 block h-9 w-full rounded-md border bg-background px-2 text-sm" value={i.riskProfile} onChange={(e) => set("riskProfile", e.target.value)} aria-label="Risk profile">
                <option value="">Not recorded yet</option>
                {models.map((m) => <option key={m.profile_key} value={m.profile_key}>{m.label}</option>)}
              </select>
            </label>
            <label className="block text-xs">Date iA's investor profile was completed<Input className="mt-1" type="date" value={i.riskProfileDate} onChange={(e) => set("riskProfileDate", e.target.value)} /></label>
          </div>
          {model && <p className="text-xs text-muted-foreground">iA model portfolio: {model.income_min}% to {model.income_max}% fixed income, {model.equity_min}% to {model.equity_max}% equity.</p>}
          {text("Where it is kept", "riskProfileEvidence", "the Drive link, or for example: iA application signed Oct 24")}
        </fieldset>

        {gaps.length > 0 && <p className="text-xs text-amber-700" data-testid="profile-gaps">Still to fill in: {gaps.join(", ")}.</p>}
        <div className="flex items-center gap-2">
          <Input placeholder="Note for this version (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button onClick={() => void save()} disabled={busy !== null}>{busy === "save" ? "Saving…" : "Save profile"}</Button>
        </div>
        {versions.length > 0 && (
          <div className="space-y-1 text-xs text-muted-foreground" data-testid="profile-history">
            <p className="font-medium text-foreground">Saved versions</p>
            {versions.slice(0, 6).map((v) => (
              <p key={v.id} className="flex flex-wrap items-center gap-2">
                <span>{day(v.created_at)}: {v.risk_profile ? `risk profile ${models.find((m) => m.profile_key === v.risk_profile)?.label ?? v.risk_profile}` : "risk profile not recorded"}{v.note ? `, ${v.note}` : ""}</span>
                {v.pdf_url ? <a href={v.pdf_url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">PDF</a> : <button type="button" className="text-primary hover:underline disabled:opacity-50" disabled={busy === v.id} onClick={() => void file(v.id)}>{busy === v.id ? "Filing…" : "File as PDF"}</button>}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** The investor profile and needs analysis for each adult in the household, side by side so a couple can be planned together. */
export function InvestorProfile({ householdId }: { householdId: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getInvestmentProfiles>> | null>(null);
  const load = useCallback(async () => { try { setData(await getInvestmentProfiles(householdId)); } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't load the profiles"); } }, [householdId]);
  useEffect(() => { void load(); }, [load]);
  if (!data) return <Loader2 className="h-5 w-5 animate-spin" />;
  if (data.adults.length === 0) return <Card><CardContent className="p-5 text-sm text-muted-foreground">There are no adults in this household yet.</CardContent></Card>;
  return (
    <div className="space-y-3" data-testid="investor-profile">
      <p className="text-sm text-muted-foreground">What the client wants, their situation and experience. The risk profile is not scored here: record the one from the investor profile completed online with the iA application, and it picks the iA model portfolio. <Badge variant="outline" className="ml-1 text-[10px]">iA only</Badge></p>
      <div className={data.adults.length > 1 ? "grid items-start gap-4 lg:grid-cols-2" : "grid gap-4"}>
        {data.adults.map((p) => <PersonProfile key={p.id} person={p} householdId={householdId} versions={data.profiles.filter((v) => v.contact_id === p.id)} models={data.models} onSaved={() => void load()} />)}
      </div>
    </div>
  );
}
