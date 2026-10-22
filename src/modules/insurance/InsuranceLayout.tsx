import { useEffect, useState } from "react";
import { Link, Outlet, useParams } from "react-router-dom";
import { ArrowLeft, Calculator, ClipboardCheck, ClipboardList, FileText, LayoutGrid, Loader2, Shield, Users } from "lucide-react";
import { NavLink } from "@/shared/components/NavLink";
import { supabase } from "@/shared/integrations/supabase/client";
import { INSURANCE_STAGES, type InsuranceStage } from "@/shared/lib/insurancePipeline";

const ITEMS = [
  { to: "", label: "Overview", icon: LayoutGrid, end: true },
  { to: "policies", label: "Policies", icon: Shield },
  { to: "fact-find", label: "Fact find", icon: ClipboardList },
  { to: "needs", label: "Needs analysis", icon: Calculator },
  { to: "quoting", label: "Quoting", icon: FileText },
  { to: "compliance", label: "Compliance", icon: ClipboardCheck },
];

/**
 * The insurance workspace: its own slim sidebar and no advisor navigation. "Advisor site" goes back to the household in the CRM; "All clients" is the board.
 * On a household page the sidebar also shows where the household is in the process and lets you move it.
 */
export default function InsuranceLayout() {
  const { householdId } = useParams<{ householdId: string }>();
  const [name, setName] = useState<string | null>(null);
  const [stage, setStage] = useState<InsuranceStage | null>(null);

  useEffect(() => {
    if (!householdId) return;
    void (async () => {
      const [{ data: h }, { data: p }] = await Promise.all([
        supabase.from("households").select("label").eq("id", householdId).maybeSingle(),
        (supabase.from("insurance_pipeline" as any) as any).select("stage").eq("household_id", householdId).maybeSingle(),
      ]);
      setName(h?.label ?? "Household");
      setStage((p?.stage as InsuranceStage) ?? null);
    })();
  }, [householdId]);

  const move = async (next: InsuranceStage) => {
    setStage(next);
    await (supabase.from("insurance_pipeline" as any) as any).upsert({ household_id: householdId, stage: next, moved_at: new Date().toISOString(), moved_by: "advisor" });
  };

  const base = householdId ? `/insurance/${householdId}` : "/insurance";
  const link = "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";
  return (
    <div className="advisor-app flex min-h-screen bg-background text-foreground">
      <aside className="flex w-60 shrink-0 flex-col border-r bg-card p-3" aria-label="Insurance navigation">
        <Link to={householdId ? `/households/${householdId}` : "/dashboard"} className="mb-4 flex items-center gap-2 px-2 py-1 text-xs font-medium text-primary hover:underline" data-testid="back-to-advisor">
          <ArrowLeft className="h-3.5 w-3.5" /> Advisor site
        </Link>
        <p className="px-2 font-serif text-lg font-semibold">Insurance</p>
        <nav className="mt-3 space-y-0.5">
          <NavLink to="/insurance" end className={link} activeClassName="bg-muted font-medium text-foreground"><Users className="h-4 w-4" /> All clients</NavLink>
          {householdId && (
            <>
              <p className="px-3 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{name ?? <Loader2 className="inline h-3 w-3 animate-spin" />}</p>
              {ITEMS.map((i) => (
                <NavLink key={i.label} to={i.to ? `${base}/${i.to}` : base} end={i.end} className={link} activeClassName="bg-muted font-medium text-foreground"><i.icon className="h-4 w-4" /> {i.label}</NavLink>
              ))}
              <div className="px-3 pt-4">
                <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground" htmlFor="ins-stage">Stage</label>
                <select id="ins-stage" className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={stage ?? ""} onChange={(e) => void move(e.target.value as InsuranceStage)}>
                  {stage === null && <option value="">Not on the board</option>}
                  {INSURANCE_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
            </>
          )}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 p-6"><div className="max-w-screen-xl"><Outlet context={{ householdId, name, stage }} /></div></main>
    </div>
  );
}
