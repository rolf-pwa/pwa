import { useOutletContext } from "react-router-dom";
import { InvestmentCompliance } from "@/modules/investments/InvestmentCompliance";
import { InvestmentOverview } from "@/modules/investments/InvestmentOverview";
import { InvestmentRecommendation } from "@/modules/investments/InvestmentRecommendation";
import { InvestmentReport } from "@/modules/investments/InvestmentReport";
import { InvestorProfile } from "@/modules/investments/InvestorProfile";
import type { InvestmentStage } from "@/shared/lib/investmentPipeline";

type Ctx = { householdId: string; name: string | null; stage: InvestmentStage | null };
const useCtx = () => useOutletContext<Ctx>();
const Title = ({ children }: { children: string }) => <h1 className="mb-4 font-serif text-2xl font-semibold">{children}</h1>;

export function InvOverviewPage() { const { householdId, name, stage } = useCtx(); return <><Title>{name ?? "Overview"}</Title><InvestmentOverview householdId={householdId} stage={stage} /></>; }
export function InvProfilePage() { const { householdId } = useCtx(); return <><Title>Investor profile</Title><InvestorProfile householdId={householdId} /></>; }
export function InvRecommendationPage() { const { householdId } = useCtx(); return <><Title>Recommendation</Title><InvestmentRecommendation householdId={householdId} /></>; }
export function InvReportPage() { const { householdId } = useCtx(); return <><Title>Client report</Title><InvestmentReport householdId={householdId} /></>; }
export function InvCompliancePage() { const { householdId, stage } = useCtx(); return <><Title>Compliance</Title><InvestmentCompliance householdId={householdId} stage={stage} /></>; }
