import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/shared/integrations/supabase/client";
import { Button } from "@/shared/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import { ArrowLeft, Loader2, Printer, RefreshCw, ShieldCheck, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import pwLogoWhite from "@/assets/prosperwise-logo-white.png";

interface ScorecardRow {
  elementName: string;
  target: string;
  currentScore: number;
  maxScore: number;
  status: string;
}
interface PillarAnalysis {
  pillar: string;
  current_total: number;
  narrative: string;
}
interface ElementDeepDive {
  element_name: string;
  charter_baseline: string;
  current_score: number;
  max_score: number;
  audit_findings: string[];
  required_corrective_actions: string[];
}
interface DiscussionPoint {
  title: string;
  body: string;
}
interface ComputedFigures {
  pillar_totals: Record<string, number>;
  target_income_equity_split: { income_pct: number; equity_pct: number } | null;
  current_income_equity_split: { income_pct: number; equity_pct: number } | null;
  terminal_tax_estimate: { registered_terminal_tax: number; capital_gains_tax: number };
  estate_liquidity_analysis: {
    total_estate_liquid_assets: number;
    total_beneficiary_bypass_assets: number;
    total_liabilities_and_taxes: number;
    surplus_or_deficit: number;
  };
  assumptions: string[];
}
interface GovernanceAuditDoc {
  client_name: string;
  review_date: string;
  reviewing_family_cfo: string;
  track_type: "personal" | "corporate";
  executive_summary_bullets: string[];
  pillar_analyses: PillarAnalysis[];
  element_deep_dives: ElementDeepDive[];
  discussion_points: DiscussionPoint[];
  scorecard: ScorecardRow[];
  computed: ComputedFigures;
  extraction_errors: string[];
  narrative_ungrounded_dollar_figures: string[];
  compliance_notes: string[];
}
interface GovernanceAuditRow {
  id: string;
  household_id: string;
  is_draft: boolean;
  generation_status: "generating" | "complete" | "error";
  generation_error: string | null;
  computed: GovernanceAuditDoc | Record<string, never>;
  generated_at: string | null;
}

const fmtCurrency = (n: number | undefined | null) =>
  typeof n === "number"
    ? n.toLocaleString("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";

// Adapted from the Review Agent prototype's config/firm_profile.yaml
// disclosure_footer, itself sourced from the disclosure language in a real
// ratified Sovereignty Charter appendix -- no equivalent compliance footer
// exists yet elsewhere in this app to reuse instead. Confirm this exact
// wording with Rolf before any real client delivery.
const DISCLOSURE_FOOTER =
  "This document is for governance and planning purposes only and does not constitute a contract for the purchase of any specific " +
  "financial product. All investment and insurance recommendations are provided through Prosperwise Advisors (PWA), a licensed " +
  "tradename of Issler Group Management & Consulting Inc. Clients are under no obligation to use both entities. Guarantees: any " +
  "references to guarantees relate solely to the contractual features of insurance products and are subject to the claims-paying " +
  "ability of the issuing insurer. Tax: Prosperwise does not provide legal or tax advice; all strategies should be ratified by a " +
  "CPA or Tax Lawyer. Market Risk: managed portfolios are subject to market fluctuations and may lose value.";

const DRAFT_WATERMARK_TEXT = "DRAFT — FOR INTERNAL REVIEW ONLY, NOT FOR CLIENT DELIVERY";

function ScoreBadge({ row }: { row: { currentScore?: number; current_score?: number; maxScore?: number; max_score?: number; status: string } }) {
  const score = row.currentScore ?? row.current_score ?? 0;
  const max = row.maxScore ?? row.max_score ?? 5;
  const pending = row.status.includes("PENDING");
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${
        pending
          ? "border-amber-400/50 bg-amber-50 text-amber-700"
          : score >= 4
            ? "border-emerald-400/50 bg-emerald-50 text-emerald-700"
            : score >= 3
              ? "border-amber-400/50 bg-amber-50 text-amber-700"
              : "border-destructive/40 bg-destructive/10 text-destructive"
      }`}
    >
      {score} / {max}
    </span>
  );
}

export default function GovernanceAudit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [audit, setAudit] = useState<GovernanceAuditRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [togglingDraft, setTogglingDraft] = useState(false);
  const [charterV2Status, setCharterV2Status] = useState<"draft" | "complete" | null>(null);

  const load = async () => {
    if (!id) return;
    const { data, error } = await supabase.from("governance_audits" as any).select("*").eq("id", id).maybeSingle();
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    const row = data as unknown as GovernanceAuditRow;
    setAudit(row);
    setLoading(false);
    if (row?.household_id) {
      const { data: charterV2 } = await supabase
        .from("household_charters")
        .select("status")
        .eq("household_id", row.household_id)
        .maybeSingle();
      setCharterV2Status((charterV2?.status as "draft" | "complete" | undefined) ?? null);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  useEffect(() => {
    if (!audit || audit.generation_status !== "generating") return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line
  }, [audit?.generation_status]);

  const regenerate = async () => {
    if (!audit) return;
    setRegenerating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/governance-audit-generate`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ household_id: audit.household_id }),
      });
      const data = await res.json();
      if (!res.ok || !data.auditId) throw new Error(data.error || "Regeneration failed");
      toast.success("New audit generated");
      navigate(`/governance-audit/${data.auditId}`, { replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Regeneration failed");
    } finally {
      setRegenerating(false);
    }
  };

  const toggleDraft = async (nextIsDraft: boolean) => {
    if (!audit) return;
    setTogglingDraft(true);
    const { error } = await supabase.from("governance_audits" as any).update({ is_draft: nextIsDraft } as any).eq("id", audit.id);
    setTogglingDraft(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(nextIsDraft ? "Marked as draft" : "Finalized");
    setConfirmFinalize(false);
    load();
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!audit) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Governance Audit not found.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
      </div>
    );
  }

  const isGenerating = audit.generation_status === "generating";
  const doc = (audit.generation_status === "complete" ? (audit.computed as GovernanceAuditDoc) : null);

  return (
    <div className="min-h-screen bg-[#fafafa]">
      {/* Toolbar — hidden in print */}
      <div className="print:hidden sticky top-0 z-20 border-b border-border bg-[#fafafa]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[900px] items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <div className="text-sm">
              <span className="font-semibold">Sovereignty Governance Audit</span>
              {audit.is_draft && (
                <span className="ml-2 text-xs uppercase tracking-wider text-amber-600">Draft</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={regenerate} disabled={regenerating || isGenerating}>
              {regenerating || isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Regenerate
            </Button>
            {audit.is_draft ? (
              <Button size="sm" variant="outline" onClick={() => setConfirmFinalize(true)} disabled={isGenerating || togglingDraft}>
                <ShieldCheck className="mr-2 h-4 w-4" /> Finalize
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => toggleDraft(true)} disabled={togglingDraft}>
                <ShieldAlert className="mr-2 h-4 w-4" /> Mark as Draft
              </Button>
            )}
            <Button size="sm" onClick={() => window.print()} disabled={isGenerating || !doc}>
              <Printer className="mr-2 h-4 w-4" /> Print / PDF
            </Button>
          </div>
        </div>
        {audit.generation_status === "error" && (
          <div className="border-t border-red-300 bg-red-50 px-6 py-2 text-xs text-red-700">
            Generation failed: {audit.generation_error || "Unknown error"}. Click Regenerate to retry.
          </div>
        )}
        {isGenerating && (
          <div className="border-t border-amber-300 bg-amber-50 px-6 py-2 text-xs text-amber-800">
            Assembling the audit — extracting documents, computing figures, and drafting the narrative. Auto-refreshing every 3 seconds…
          </div>
        )}
      </div>

      {charterV2Status !== "complete" && (
        <div className="print:hidden mx-auto flex max-w-[900px] items-center justify-between gap-3 border-b border-primary/20 bg-primary/5 px-6 py-2 text-sm">
          <span>This household's Charter is still on the v1 format.</span>
          <Button size="sm" variant="outline" onClick={() => navigate(`/charter-intake/household/${audit.household_id}`)}>
            Migrate to Sovereignty Charter v2.0
          </Button>
        </div>
      )}

      <AlertDialog open={confirmFinalize} onOpenChange={setConfirmFinalize}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finalize this audit?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the DRAFT watermark, signaling the document is ready for client delivery. You can mark it back
              to draft at any time — finalizing doesn't lock the content or prevent regeneration.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => toggleDraft(false)}>Finalize</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isGenerating && !doc && (
        <div className="mx-auto max-w-[900px] px-6 py-24 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {doc && (
        <div className="relative mx-auto max-w-[900px] px-6 py-8 print:max-w-none print:px-0 print:py-0">
          {audit.is_draft && (
            <>
              <div className="pointer-events-none fixed inset-0 z-10 hidden select-none items-center justify-center print:flex">
                <span className="rotate-[-30deg] text-6xl font-bold uppercase tracking-widest text-red-500/20">Draft</span>
              </div>
              <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-center text-xs font-semibold uppercase tracking-wider text-amber-800 print:border-none print:bg-transparent">
                {DRAFT_WATERMARK_TEXT}
              </div>
            </>
          )}

          <div className="gov-audit-doc bg-white p-10 shadow-lg print:p-0 print:shadow-none">
            {/* Header */}
            <div className="mb-6 flex items-center gap-3 border-b border-[#1B2A3A] pb-4">
              <img src={pwLogoWhite} alt="ProsperWise" className="h-8 w-8 rounded bg-[#1B2A3A] p-1" />
              <span className="font-serif text-lg font-semibold tracking-wide text-[#1B2A3A]">ProsperWise</span>
            </div>
            <h1 className="mb-3 font-serif text-2xl font-bold tracking-tight text-[#1B2A3A]">THE SOVEREIGNTY GOVERNANCE AUDIT</h1>
            <ul className="mb-8 space-y-1 text-sm text-[#334155]">
              <li><b>Client Name:</b> {doc.client_name}</li>
              <li><b>Review Date:</b> {doc.review_date}</li>
              <li><b>Reviewing Family CFO:</b> {doc.reviewing_family_cfo}</li>
              <li><b>Track:</b> {doc.track_type === "corporate" ? "Corporate" : "Personal"}</li>
            </ul>

            {/* I. Executive Governance Summary */}
            <h2 className="mb-2 font-serif text-lg font-semibold text-[#0E7C6B]">I. Executive Governance Summary</h2>
            <p className="mb-1 text-sm font-medium text-[#334155]">Family CFO Clinical Note:</p>
            <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-[#334155]">
              {doc.executive_summary_bullets.length === 0 ? (
                <li className="list-none text-muted-foreground">No summary generated.</li>
              ) : (
                doc.executive_summary_bullets.map((b, i) => <li key={i}>{b}</li>)
              )}
            </ul>

            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-[#5B6470]">Systemic Health Scorecard</h3>
            <table className="mb-8 w-full border-collapse text-sm">
              <thead>
                <tr className="bg-[#F0F3F2] text-left">
                  <th className="border border-[#D8DEDC] px-3 py-2">Structural Charter Element</th>
                  <th className="border border-[#D8DEDC] px-3 py-2">Target</th>
                  <th className="border border-[#D8DEDC] px-3 py-2">Current Score</th>
                  <th className="border border-[#D8DEDC] px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {doc.scorecard.map((row) => (
                  <tr key={row.elementName}>
                    <td className="border border-[#D8DEDC] px-3 py-2">{row.elementName}</td>
                    <td className="border border-[#D8DEDC] px-3 py-2">{row.target}</td>
                    <td className="border border-[#D8DEDC] px-3 py-2"><ScoreBadge row={row} /></td>
                    <td className="border border-[#D8DEDC] px-3 py-2">{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* II. Capital Infrastructure Ledger */}
            <h2 className="mb-2 font-serif text-lg font-semibold text-[#0E7C6B]">II. Capital Infrastructure Ledger</h2>
            <p className="mb-3 text-xs italic text-muted-foreground">Pillar totals sourced live from the household's own Vineyard/Storehouse/Holding Tank records.</p>
            <table className="mb-4 w-full border-collapse text-sm">
              <thead>
                <tr className="bg-[#F0F3F2] text-left">
                  <th className="border border-[#D8DEDC] px-3 py-2">Pillar</th>
                  <th className="border border-[#D8DEDC] px-3 py-2">Current Total</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(doc.computed.pillar_totals).length === 0 ? (
                  <tr><td colSpan={2} className="border border-[#D8DEDC] px-3 py-2 text-muted-foreground">No pillar balances on file.</td></tr>
                ) : (
                  Object.entries(doc.computed.pillar_totals).map(([pillar, total]) => (
                    <tr key={pillar}>
                      <td className="border border-[#D8DEDC] px-3 py-2">{pillar}</td>
                      <td className="border border-[#D8DEDC] px-3 py-2 tabular-nums">{fmtCurrency(total)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {doc.pillar_analyses.length > 0 && (
              <div className="mb-8 space-y-2">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-[#5B6470]">Pillar Analysis</h3>
                {doc.pillar_analyses.map((pa) => (
                  <p key={pa.pillar} className="text-sm text-[#334155]">
                    <b>{pa.pillar}:</b> {pa.narrative || "—"}
                  </p>
                ))}
              </div>
            )}

            {/* Estate liquidity + tax figures */}
            <div className="mb-8 grid grid-cols-2 gap-4 rounded-md border border-[#D8DEDC] bg-[#F0F3F2]/50 p-4 text-sm">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#5B6470]">Estate Liquidity</p>
                <p className="mt-1 text-[#334155]">
                  Liquid assets: {fmtCurrency(doc.computed.estate_liquidity_analysis.total_estate_liquid_assets)}<br />
                  Bypassing probate: {fmtCurrency(doc.computed.estate_liquidity_analysis.total_beneficiary_bypass_assets)}<br />
                  Liabilities + taxes: {fmtCurrency(doc.computed.estate_liquidity_analysis.total_liabilities_and_taxes)}<br />
                  <b>{doc.computed.estate_liquidity_analysis.surplus_or_deficit < 0 ? "Deficit" : "Surplus"}: {fmtCurrency(Math.abs(doc.computed.estate_liquidity_analysis.surplus_or_deficit))}</b>
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#5B6470]">Terminal Tax Estimate</p>
                <p className="mt-1 text-[#334155]">
                  Registered (RRSP/RRIF/LIRA): {fmtCurrency(doc.computed.terminal_tax_estimate.registered_terminal_tax)}<br />
                  Capital gains: {fmtCurrency(doc.computed.terminal_tax_estimate.capital_gains_tax)}
                </p>
              </div>
            </div>

            {/* III. Element Deep-Dive & Scoring */}
            <h2 className="mb-3 font-serif text-lg font-semibold text-[#0E7C6B]">III. Element Deep-Dive &amp; Scoring</h2>
            <div className="mb-8 space-y-5">
              {doc.element_deep_dives.map((dd, i) => (
                <div key={dd.element_name}>
                  <h3 className="mb-1 text-sm font-semibold text-[#1B2A3A]">{i + 1}. {dd.element_name}</h3>
                  <p className="text-sm text-[#334155]"><b>Charter Baseline:</b> {dd.charter_baseline}</p>
                  <p className="mb-1 text-sm text-[#334155]"><b>Current Score:</b> {dd.current_score} / {dd.max_score}</p>
                  {dd.audit_findings.length > 0 && (
                    <>
                      <p className="text-sm font-medium text-[#334155]">Audit Findings:</p>
                      <ul className="mb-1 list-disc space-y-0.5 pl-5 text-sm text-[#334155]">
                        {dd.audit_findings.map((f, j) => <li key={j}>{f}</li>)}
                      </ul>
                    </>
                  )}
                  {dd.required_corrective_actions.length > 0 && (
                    <>
                      <p className="text-sm font-medium text-[#334155]">Required Corrective Action:</p>
                      <ul className="list-disc space-y-0.5 pl-5 text-sm text-[#334155]">
                        {dd.required_corrective_actions.map((a, j) => <li key={j}>{a}</li>)}
                      </ul>
                    </>
                  )}
                </div>
              ))}
            </div>

            {/* IV. Facilitated Discussion Points */}
            {doc.discussion_points.length > 0 && (
              <>
                <h2 className="mb-3 font-serif text-lg font-semibold text-[#0E7C6B]">IV. Facilitated Discussion Points</h2>
                <div className="mb-8 space-y-4">
                  {doc.discussion_points.map((dp, i) => (
                    <div key={i}>
                      <h4 className="mb-1 text-sm font-semibold text-[#1B2A3A]">{i + 1}. {dp.title}</h4>
                      <p className="text-sm text-[#334155]">{dp.body}</p>
                    </div>
                  ))}
                </div>
              </>
            )}

            {doc.compliance_notes.length > 0 && (
              <div className="mb-3 border-t border-[#D8DEDC] pt-3 text-[10px] leading-relaxed text-[#5B6470]">
                <p className="mb-1 font-semibold uppercase tracking-wider text-[#5B6470]">Compliance Status</p>
                <ul className="list-none space-y-0.5">
                  {doc.compliance_notes.map((note, i) => <li key={i}>{note}</li>)}
                </ul>
              </div>
            )}

            <div className="border-t border-[#D8DEDC] pt-4 text-[10px] leading-relaxed text-[#5B6470]">
              {DISCLOSURE_FOOTER}
            </div>
          </div>

          {(doc.computed.assumptions.length > 0 || doc.extraction_errors.length > 0 || doc.narrative_ungrounded_dollar_figures.length > 0) && (
            <div className="mt-6 rounded-lg border border-[#e2e8f0] bg-white p-4 text-xs text-[#64748b] print:hidden">
              <div className="mb-2 font-semibold uppercase tracking-wider text-[#a37c58]">Advisor Notes (staff only, not printed)</div>
              {doc.computed.assumptions.length > 0 && (
                <div className="mb-2">
                  <p className="mb-1 font-medium">Assumptions</p>
                  <ul className="list-disc space-y-0.5 pl-5">
                    {doc.computed.assumptions.map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                </div>
              )}
              {doc.extraction_errors.length > 0 && (
                <div className="mb-2">
                  <p className="mb-1 font-medium text-destructive">Document extraction issues</p>
                  <ul className="list-disc space-y-0.5 pl-5">
                    {doc.extraction_errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
              {doc.narrative_ungrounded_dollar_figures.length > 0 && (
                <div>
                  <p className="mb-1 font-medium text-destructive">Unverified dollar figures in the draft narrative — review before delivery</p>
                  <ul className="list-disc space-y-0.5 pl-5">
                    {doc.narrative_ungrounded_dollar_figures.map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <style>{`
        @media print {
          @page { size: letter portrait; margin: 0.75in; }
          body { background: white !important; }
          .gov-audit-doc { box-shadow: none !important; }
        }
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=DM+Sans:wght@400;500&display=swap');
      `}</style>
    </div>
  );
}
