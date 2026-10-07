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
import { DOC_FONT, DOC_SERIF, DOC_TAN, DocPage, DocPageHeader, DocPrintStyles, DocSidebar, colLabel, colText } from "../components/document/SovereigntyDoc";

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
interface TargetCheck {
  label: string;
  area: string;
  status: "met" | "below" | "above" | "info" | "not_computable";
  summary: string;
  quote: string;
}
interface EstateAdultRow { name: string; will: "signed" | "unsigned" | "missing"; willDate: string | null; poa: "on_file" | "missing" }
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
  charter_summary?: { source: string | null; ratified: boolean; file_name: string | null; purpose: string | null };
  charter_targets?: TargetCheck[];
  estate_documents?: { source: string; adults: EstateAdultRow[]; trusts: number; status: string; detail: string; actions: string[] };
  balance_sheet?: { total_assets: number; net_worth: number; liabilities: number };
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
  const color = pending ? "#e67e22" : score >= 4 ? "#27ae60" : score >= 3 ? "#e67e22" : "#c0392b";
  return <span style={{ color, fontWeight: 600 }}>{pending ? "Pending" : `${score} / ${max}`}</span>;
}

/** The audit's house pillar names, with the CRM's own name for the same line so the two documents read alike. */
const PILLAR_LABEL: Record<string, string> = {
  "Vineyard": "The Vineyard",
  "Keep": "The Keep · Liquidity Reserve",
  "Armoury": "The Armoury · Strategic Reserve",
  "Granary": "The Granary · Philanthropic Trust",
  "Legacy Vault": "The Legacy Vault · Legacy Trust",
};

const TARGET_COLOR: Record<TargetCheck["status"], string> = { met: "#27ae60", below: "#c0392b", above: "#c0392b", info: "#64748b", not_computable: "#94a3b8" };
const targetMark = (s: TargetCheck["status"]) => (s === "met" ? "✓" : s === "below" || s === "above" ? "✗" : "•");

function BsRow({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0.8mm 0", fontSize: strong ? "8.5pt" : "8pt", fontWeight: strong ? 700 : 400, color: tone ?? (strong ? "#334155" : "#64748b") }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
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
        <div className="relative mx-auto max-w-[210mm] px-6 py-8 print:max-w-none print:px-0 print:py-0">
          {audit.is_draft && (
            <>
              <div className="pointer-events-none fixed inset-0 z-10 hidden select-none items-center justify-center print:flex">
                <span className="rotate-[-30deg] text-6xl font-bold uppercase tracking-widest text-red-500/20">Draft</span>
              </div>
              <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-center text-xs font-semibold uppercase tracking-wider text-amber-800 print:hidden">
                {DRAFT_WATERMARK_TEXT}
              </div>
            </>
          )}

          {/* Page 1 — summary and scorecard */}
          <div className="stab-doc bg-white shadow-lg print:shadow-none" style={{ width: "210mm", minHeight: "297mm", display: "flex", fontFamily: DOC_FONT, color: "#334155" }}>
            <DocSidebar />
            <main style={{ flex: 1, padding: "10mm 10mm 0 10mm", display: "flex", flexDirection: "column", gap: "5mm" }}>
              <div style={{ marginBottom: "3mm" }}>
                <div style={{ fontSize: "7.5pt", letterSpacing: ".1em", textTransform: "uppercase", color: "#94a3b8", marginBottom: "3mm" }}>
                  Governance Audit &nbsp;·&nbsp; Prepared for <strong>{doc.client_name}</strong> &nbsp;·&nbsp; {doc.review_date}
                </div>
                <div style={{ fontFamily: DOC_SERIF, fontSize: "25pt", fontWeight: 300, color: "#334155", lineHeight: 1.3, letterSpacing: "-0.005em" }}>
                  Sovereignty Governance Audit™
                </div>
                <hr style={{ width: "18mm", height: "3px", background: DOC_TAN, border: "none", marginTop: "4mm" }} />
                <div style={{ fontSize: "7.5pt", color: "#64748b", marginTop: "3mm" }}>
                  Reviewing Family CFO: {doc.reviewing_family_cfo} &nbsp;·&nbsp; Track: {doc.track_type === "corporate" ? "Corporate" : "Personal"}
                </div>
              </div>

              <div>
                <div style={colLabel}>I. Executive Governance Summary</div>
                <div style={{ background: "#fafafa", borderLeft: `3px solid ${DOC_TAN}`, padding: "3mm 5mm", display: "flex", flexDirection: "column", gap: "1.5mm" }}>
                  {doc.executive_summary_bullets.length === 0 ? (
                    <div style={{ fontSize: "7.5pt", color: "#94a3b8" }}>No summary generated.</div>
                  ) : (
                    doc.executive_summary_bullets.map((b, i) => <div key={i} style={{ fontSize: "7.8pt", color: "#334155", lineHeight: 1.55 }}>{b}</div>)
                  )}
                </div>
              </div>

              <div>
                <div style={colLabel}>Systemic Health Scorecard</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "1.5mm 5mm", fontSize: "8pt" }}>
                  <span style={{ color: "#94a3b8", fontWeight: 600 }}>Structural Charter Element</span>
                  <span style={{ color: "#94a3b8", fontWeight: 600 }}>Target</span>
                  <span style={{ color: "#94a3b8", fontWeight: 600, textAlign: "right" }}>Score</span>
                  {doc.scorecard.map((row) => (
                    <div key={row.elementName} style={{ display: "contents" }}>
                      <span style={{ color: "#334155" }}>{row.elementName}<br /><span style={{ fontSize: "6.8pt", color: "#94a3b8" }}>{row.status}</span></span>
                      <span style={{ color: "#64748b" }}>{row.target}</span>
                      <span style={{ textAlign: "right" }}><ScoreBadge row={row} /></span>
                    </div>
                  ))}
                </div>
              </div>

              {doc.charter_summary && (
                <div>
                  <div style={colLabel}>The Charter</div>
                  <p style={colText}>
                    {doc.charter_summary.source === null
                      ? "No Charter is on file for this household."
                      : `Sovereignty Charter ${doc.charter_summary.ratified ? "ratified" : "not yet ratified"}${doc.charter_summary.file_name ? ` · ${doc.charter_summary.file_name}` : ""}.`}
                  </p>
                  {doc.charter_summary.purpose && <p style={{ ...colText, fontStyle: "italic", color: "#64748b", marginTop: "1.5mm" }}>“{doc.charter_summary.purpose}”</p>}
                </div>
              )}
            </main>
          </div>

          {/* Page 2 — Capital Infrastructure Ledger */}
          <DocPage>
            <DocPageHeader kicker="Governance Audit" name={doc.client_name} period={doc.review_date} title="II. Capital Infrastructure Ledger" />
            {(() => {
              const pillars = Object.entries(doc.computed.pillar_totals);
              const sum = pillars.reduce((a, [, v]) => a + v, 0);
              const bs = doc.balance_sheet;
              const holdingTank = bs ? Math.max(0, Math.round((bs.total_assets - sum) * 100) / 100) : 0;
              return (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 8mm" }}>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <div style={colLabel}>Assets</div>
                    {pillars.length === 0 ? <p style={{ ...colText, color: "#94a3b8" }}>No pillar balances on file.</p> : pillars.map(([pillar, total]) => (
                      <BsRow key={pillar} label={PILLAR_LABEL[pillar] ?? pillar} value={fmtCurrency(total)} />
                    ))}
                    {holdingTank > 0 && <BsRow label="Holding Tank (not yet assigned)" value={fmtCurrency(holdingTank)} />}
                    {bs && (
                      <div style={{ marginTop: "auto", paddingTop: "1.5mm" }}>
                        <hr style={{ border: "none", borderTop: "1.5px solid #334155", margin: "0 0 1.5mm" }} />
                        <BsRow label="Total Assets" value={fmtCurrency(bs.total_assets)} strong />
                      </div>
                    )}
                  </div>
                  {bs && (
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <div style={colLabel}>Liabilities &amp; Net Worth</div>
                      <BsRow label="Liabilities" value={fmtCurrency(bs.liabilities)} tone="#c0392b" />
                      <BsRow label="Net Worth" value={fmtCurrency(bs.net_worth)} strong />
                    </div>
                  )}
                </div>
              );
            })()}
            <p style={{ fontSize: "6.5pt", color: "#94a3b8", fontStyle: "italic", margin: 0 }}>
              Pillar totals come from the household's own Vineyard, Storehouse and Holding Tank records, with income funds from the investment statements counted in the Keep and insurance cash value in the Armoury, exactly as in the Sovereignty Review.
            </p>

            {doc.pillar_analyses.length > 0 && (
              <div>
                <div style={colLabel}>Pillar Analysis</div>
                {doc.pillar_analyses.map((pa) => (
                  <p key={pa.pillar} style={{ ...colText, marginBottom: "2mm" }}><b>{PILLAR_LABEL[pa.pillar] ?? pa.pillar}:</b> {pa.narrative || "—"}</p>
                ))}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6mm" }}>
              <div style={{ background: "#fafafa", borderLeft: `3px solid ${DOC_TAN}`, padding: "3mm 4mm" }}>
                <div style={{ fontSize: "6.5pt", letterSpacing: ".1em", textTransform: "uppercase", color: "#94a3b8", marginBottom: "1.5mm" }}>Estate Liquidity</div>
                <p style={{ ...colText, fontSize: "8pt" }}>
                  Liquid assets: {fmtCurrency(doc.computed.estate_liquidity_analysis.total_estate_liquid_assets)}<br />
                  Bypassing probate: {fmtCurrency(doc.computed.estate_liquidity_analysis.total_beneficiary_bypass_assets)}<br />
                  Liabilities + taxes: {fmtCurrency(doc.computed.estate_liquidity_analysis.total_liabilities_and_taxes)}<br />
                  <b>{doc.computed.estate_liquidity_analysis.surplus_or_deficit < 0 ? "Deficit" : "Surplus"}: {fmtCurrency(Math.abs(doc.computed.estate_liquidity_analysis.surplus_or_deficit))}</b>
                </p>
              </div>
              <div style={{ background: "#fafafa", borderLeft: `3px solid ${DOC_TAN}`, padding: "3mm 4mm" }}>
                <div style={{ fontSize: "6.5pt", letterSpacing: ".1em", textTransform: "uppercase", color: "#94a3b8", marginBottom: "1.5mm" }}>Terminal Tax Estimate</div>
                <p style={{ ...colText, fontSize: "8pt" }}>
                  Registered (RRSP/RRIF/LIRA): {fmtCurrency(doc.computed.terminal_tax_estimate.registered_terminal_tax)}<br />
                  Capital gains: {fmtCurrency(doc.computed.terminal_tax_estimate.capital_gains_tax)}
                </p>
              </div>
            </div>

            {doc.charter_targets && doc.charter_targets.length > 0 && (
              <div>
                <div style={colLabel}>What the Charter Asks For</div>
                {doc.charter_targets.map((t, i) => (
                  <p key={i} style={{ ...colText, fontSize: "7.5pt", color: TARGET_COLOR[t.status], marginBottom: "1mm" }}>
                    {targetMark(t.status)} {t.summary.replace(/^Charter: /, "")}
                  </p>
                ))}
              </div>
            )}

            {doc.estate_documents && (
              <div>
                <div style={colLabel}>Estate Documents on File</div>
                <p style={{ ...colText, fontSize: "8pt" }}>{doc.estate_documents.detail}</p>
                {doc.estate_documents.actions.map((a, i) => <p key={i} style={{ ...colText, fontSize: "7.8pt", fontWeight: 600 }}>{a}</p>)}
              </div>
            )}
          </DocPage>

          {/* Page 3 — Element deep-dive and discussion points */}
          <DocPage footer={DISCLOSURE_FOOTER}>
            <DocPageHeader kicker="Governance Audit" name={doc.client_name} period={doc.review_date} title="III. Element Deep-Dive & Scoring" />
            <div style={{ display: "flex", flexDirection: "column", gap: "4mm" }}>
              {doc.element_deep_dives.map((dd, i) => (
                <div key={dd.element_name} style={{ background: "#fafafa", borderLeft: `3px solid ${DOC_TAN}`, padding: "3mm 4mm", breakInside: "avoid" }}>
                  <strong style={{ display: "block", fontSize: "8.5pt", color: "#334155" }}>{i + 1}. {dd.element_name} &nbsp;<ScoreBadge row={{ current_score: dd.current_score, max_score: dd.max_score, status: dd.current_score === 0 ? "PENDING" : "" }} /></strong>
                  <p style={{ ...colText, fontSize: "7.5pt", color: "#64748b", margin: "1mm 0" }}><b>Charter baseline:</b> {dd.charter_baseline}</p>
                  {dd.audit_findings.length > 0 && (
                    <>
                      <div style={{ fontSize: "5.8pt", letterSpacing: ".1em", textTransform: "uppercase", color: "#94a3b8", margin: "1.6mm 0 0.4mm" }}>Audit findings</div>
                      {dd.audit_findings.map((f, j) => <p key={j} style={{ ...colText, fontSize: "7.5pt", margin: 0 }}>{f}</p>)}
                    </>
                  )}
                  {dd.required_corrective_actions.length > 0 && (
                    <>
                      <div style={{ fontSize: "5.8pt", letterSpacing: ".1em", textTransform: "uppercase", color: "#94a3b8", margin: "1.6mm 0 0.4mm" }}>Required corrective action</div>
                      {dd.required_corrective_actions.map((a, j) => <p key={j} style={{ ...colText, fontSize: "7.5pt", fontWeight: 600, margin: 0 }}>{a}</p>)}
                    </>
                  )}
                </div>
              ))}
            </div>

            {doc.discussion_points.length > 0 && (
              <div>
                <div style={colLabel}>IV. Facilitated Discussion Points</div>
                {doc.discussion_points.map((dp, i) => (
                  <div key={i} style={{ marginBottom: "3mm", breakInside: "avoid" }}>
                    <p style={{ ...colText, fontWeight: 600 }}>{i + 1}. {dp.title}</p>
                    <p style={{ ...colText, fontSize: "8pt", color: "#475569" }}>{dp.body}</p>
                  </div>
                ))}
              </div>
            )}

            {doc.compliance_notes.length > 0 && (
              <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: "2mm" }}>
                <div style={{ fontSize: "6pt", letterSpacing: ".1em", textTransform: "uppercase", color: "#94a3b8", marginBottom: "1mm" }}>Compliance status</div>
                {doc.compliance_notes.map((note, i) => <p key={i} style={{ fontSize: "6.6pt", color: "#64748b", lineHeight: 1.45, margin: 0 }}>{note}</p>)}
              </div>
            )}
          </DocPage>

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

      <DocPrintStyles />
    </div>
  );
}
