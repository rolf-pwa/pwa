import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Loader2 } from "lucide-react";
import { Badge } from "@/shared/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { supabase } from "@/shared/integrations/supabase/client";
import { InsurancePanel } from "@/modules/crm/components/InsurancePanel";
import { InsuranceFiles } from "@/modules/crm/components/InsuranceFiles";
import { NeedsAnalysis } from "@/modules/crm/components/NeedsAnalysis";
import { CriticalIllnessNeeds, DisabilityNeeds } from "@/modules/crm/components/ProtectionNeeds";
import { CATEGORY_LABEL, summarize, type Category, type SummaryPolicy } from "@/shared/lib/insuranceSummary";
import { policyTypeLabel } from "@/shared/lib/insurance";

const money = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
const SHOWN: Category[] = ["life", "critical_illness", "disability", "long_term_care"];
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver" }).format(new Date());

/**
 * The Insurance tab on a household or contact: what is in force by person and type, renewals coming up, each person's policies (add and edit), and the
 * insurance files with their compliance checklist and audit package. On a contact page it shows that person's policies; the summary still covers the household.
 */
export type InsuranceSection = "summary" | "policies" | "needs" | "files";
const ALL_SECTIONS: InsuranceSection[] = ["summary", "policies", "needs", "files"];

export function InsuranceTab({ householdId, contactId, sections = ALL_SECTIONS, workspaceLink = true }: { householdId: string | null; contactId?: string | null; sections?: InsuranceSection[]; workspaceLink?: boolean }) {
  const show = (k: InsuranceSection) => sections.includes(k);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [policies, setPolicies] = useState<(SummaryPolicy & { carrier: string; policy_type: string })[]>([]);
  const [storehouses, setStorehouses] = useState<{ id: string; storehouse_number: number; label: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    let members: { id: string; first_name: string | null; last_name: string | null; full_name?: string | null }[] = [];
    if (householdId) {
      const { data } = await supabase.from("contacts").select("id, first_name, last_name, full_name, is_minor").eq("household_id", householdId).order("created_at");
      members = ((data ?? []) as any[]).filter((c) => !c.is_minor || c.id === contactId);
    } else if (contactId) {
      const { data } = await supabase.from("contacts").select("id, first_name, last_name, full_name").eq("id", contactId);
      members = (data ?? []) as any[];
    }
    const ids = members.map((m) => m.id);
    const [{ data: pol }, { data: sh }] = await Promise.all([
      ids.length ? (supabase.from("insurance_policies" as any) as any).select("*").in("contact_id", ids) : { data: [] },
      ids.length ? supabase.from("storehouses").select("id, storehouse_number, label").in("contact_id", ids) : { data: [] },
    ]);
    setPeople(members.map((m) => ({ id: m.id, name: m.full_name || `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim() || "Unnamed" })));
    setPolicies((pol ?? []) as any[]);
    setStorehouses((sh ?? []) as any[]);
    setLoading(false);
  }, [householdId, contactId]);
  useEffect(() => { void load(); }, [load]);

  const summary = useMemo(() => summarize(policies, people, today()), [policies, people]);
  const showPeople = contactId ? people.filter((p) => p.id === contactId) : people;

  if (loading) return <Loader2 className="h-5 w-5 animate-spin" />;
  return (
    <div className="space-y-5">
      {householdId && workspaceLink && (
        <Link to={`/insurance/${householdId}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline" data-testid="open-insurance-workspace"><ExternalLink className="h-3.5 w-3.5" /> Open the insurance workspace</Link>
      )}
      {show("summary") && (
        <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[["Life coverage", money(summary.overall.coverage.life)], ["Critical illness", money(summary.overall.coverage.critical_illness)], ["Disability", money(summary.overall.coverage.disability)], ["Premiums a year", money(summary.overall.premiumsPerYear)], ["Cash value", money(summary.overall.cashValue)]].map(([k, v]) => (
          <Card key={k}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{k}</p><p className="mt-1 font-serif text-xl font-semibold">{v}</p></CardContent></Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-lg">Coverage by person</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm" data-testid="coverage-by-person">
            <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="px-4 py-2">Person</th>{SHOWN.map((c) => <th key={c} className="px-2 py-2 text-right">{CATEGORY_LABEL[c]}</th>)}<th className="px-2 py-2 text-right">Premiums a year</th><th className="px-4 py-2 text-right">Policies</th></tr></thead>
            <tbody>
              {summary.byPerson.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="px-4 py-2 font-medium">{r.name}{!r.hasLife && <Badge variant="outline" className="ml-2 text-[10px]">No life coverage on file</Badge>}</td>
                  {SHOWN.map((c) => <td key={c} className="px-2 py-2 text-right">{r.coverage[c] ? money(r.coverage[c]) : "—"}</td>)}
                  <td className="px-2 py-2 text-right">{r.premiumsPerYear ? money(r.premiumsPerYear) : "—"}</td>
                  <td className="px-4 py-2 text-right">{r.policies}</td>
                </tr>
              ))}
              {summary.others && (
                <tr className="border-b last:border-0 text-muted-foreground">
                  <td className="px-4 py-2">Owned by a corporation or others</td>
                  {SHOWN.map((c) => <td key={c} className="px-2 py-2 text-right">{summary.others!.coverage[c] ? money(summary.others!.coverage[c]) : "—"}</td>)}
                  <td className="px-2 py-2 text-right">{summary.others.premiumsPerYear ? money(summary.others.premiumsPerYear) : "—"}</td>
                  <td className="px-4 py-2 text-right">{summary.others.policies}</td>
                </tr>
              )}
              {summary.byPerson.length === 0 && <tr><td className="px-4 py-6 text-muted-foreground" colSpan={7}>No people on this household yet.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {summary.renewals.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-lg">Renewals in the next 90 days</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm" data-testid="renewals">
            {summary.renewals.map((r) => <p key={r.policy.id}>{policyTypeLabel(r.policy.policy_type)}, {r.policy.carrier}, {r.owner}: <span className="font-medium">{r.days === 0 ? "today" : `in ${r.days} day${r.days === 1 ? "" : "s"}`}</span> ({r.policy.renewal_date})</p>)}
          </CardContent>
        </Card>
      )}

        </>
      )}

      {show("policies") && showPeople.map((p) => (
        <section key={p.id} className="space-y-2" aria-label={`${p.name}'s policies`}>
          {(showPeople.length > 1) && <h3 className="font-serif text-base font-semibold">{p.name}</h3>}
          <InsurancePanel scope={{ kind: "contact", contactId: p.id }} storehouses={storehouses} onStorehousesChanged={() => void load()} />
        </section>
      ))}

      {show("needs") && showPeople.map((p) => (
        <div key={p.id} className="space-y-4">
          <NeedsAnalysis person={p} householdId={householdId} lifeInsurance={summary.byPerson.find((r) => r.id === p.id)?.coverage.life ?? 0} />
          <DisabilityNeeds person={p} householdId={householdId} inForce={summary.byPerson.find((r) => r.id === p.id)?.coverage.disability ?? 0} />
          <CriticalIllnessNeeds person={p} householdId={householdId} inForce={summary.byPerson.find((r) => r.id === p.id)?.coverage.critical_illness ?? 0} />
        </div>
      ))}

      {show("files") && householdId && <InsuranceFiles householdId={householdId} />}
    </div>
  );
}
