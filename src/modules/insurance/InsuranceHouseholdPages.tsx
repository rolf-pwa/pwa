import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { ComplianceReplacement } from "@/modules/insurance/ComplianceReplacement";
import { ComplianceFactFind } from "@/modules/insurance/ComplianceFactFind";
import { ComplianceDocuments } from "@/modules/insurance/ComplianceDocuments";
import { ComplianceRoadmap } from "@/modules/insurance/ComplianceRoadmap";
import type { InsuranceStage } from "@/shared/lib/insurancePipeline";
import { InsuranceTab } from "@/modules/crm/components/InsuranceTab";

type Ctx = { householdId: string; name: string | null; stage: InsuranceStage | null };
const useCtx = () => useOutletContext<Ctx>();
const Title = ({ children }: { children: string }) => <h1 className="mb-4 font-serif text-2xl font-semibold">{children}</h1>;

export function OverviewPage() { const { householdId, name } = useCtx(); return <><Title>{name ?? "Overview"}</Title><InsuranceTab householdId={householdId} sections={["summary"]} workspaceLink={false} /></>; }
export function PoliciesPage() { const { householdId } = useCtx(); return <><Title>Policies</Title><InsuranceTab householdId={householdId} sections={["policies"]} workspaceLink={false} /></>; }
export function NeedsPage() { const { householdId } = useCtx(); return <><Title>Needs analysis</Title><InsuranceTab householdId={householdId} sections={["needs"]} workspaceLink={false} /></>; }
export function CompliancePage() {
  const { householdId, stage } = useCtx();
  const [version, setVersion] = useState(0);
  return (
    <>
      <Title>Compliance</Title>
      <ComplianceRoadmap key={version} householdId={householdId} stage={stage} />
      <div className="mt-6"><ComplianceReplacement householdId={householdId} onChanged={() => setVersion((v) => v + 1)} /></div>
      <div className="mt-6"><ComplianceFactFind householdId={householdId} onChanged={() => setVersion((v) => v + 1)} /></div>
      <div className="mt-6"><ComplianceDocuments householdId={householdId} onChanged={() => setVersion((v) => v + 1)} /></div>
      <h2 className="mb-3 mt-8 text-sm font-semibold">All files</h2>
      <InsuranceTab householdId={householdId} sections={["files"]} workspaceLink={false} />
    </>
  );
}
export function QuotingPage() {
  return <><Title>Quoting</Title><Card><CardHeader><CardTitle className="text-lg">Carrier quotes</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">Quotes and illustrations compared for the recommendation will live here, and feed the evidence of alternatives in the compliance file.</CardContent></Card></>;
}
