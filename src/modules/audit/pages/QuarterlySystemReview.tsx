import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useNavigate, useParams } from "react-router-dom";
import { format } from "date-fns";
import { ArrowLeft, Loader2, Plus, Printer, RefreshCw, Save, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/shared/integrations/supabase/client";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { Textarea } from "@/shared/components/ui/textarea";
import { useAutoSave, AutoSaveIndicator } from "@/shared/hooks/useAutoSave";
import pwLogoWhite from "@/assets/prosperwise-logo-white.png";

// Quarterly Review / Sovereignty Survey -- same A4 document format as the household Stabilization Map ("Sovereignty Survey"):
// brand sidebar, summary box, Capital & Asset Protection, status cards, then a 90-day plan on page two.

type ActionItem = { title: string; detail: string };
type ActionPlan = { phase_1: ActionItem[]; phase_2: ActionItem[]; phase_3: ActionItem[] };
type TargetCheck = { label: string; area?: string; status: "met" | "below" | "above" | "info" | "not_computable"; targetText: string; actualText: string; summary: string; quote: string };
type Card = { key: string; label: string; status: string; detail: string; targets?: TargetCheck[]; charter_note?: string };

type Diag = {
  aum?: number;
  holding_tank_total?: number;
  vineyard_total?: number;
  storehouse_reserves?: { liquidity: number; strategic: number; philanthropic: number; legacy: number };
  personal_liabilities_total?: number;
  corp_liabilities_total?: number;
  net_worth?: number;
  insurance_coverage_total?: number;
  deltas?: { aum: number | null; netWorth: number | null; previousLabel: string | null };
  data_completeness?: { total: number; onFile: number; missing: string[] };
  vault_scan?: string;
  charter_extract?: { purpose: string; mission: string; vision: string; values: string[]; reserve_rules: string; governance: string; monthly_spending: number | null; targets: TargetCheck[] } | null;
  charter_file?: { name: string; modifiedTime: string | null; ratified: boolean; viaSubfolder: boolean; textRead: boolean } | null;
  harvest?: { current: number | null; snapshot_growth?: number; accounts_read?: number };
  allocation?: { notes: string[]; income_funds_moved: number; income_funds_on_file: number; cash_value_added: number; real_estate_added?: number };
  tracked_accounts?: number;
  accounts?: number;
};

type Review = {
  id: string;
  household_id: string | null;
  layout_version: number;
  review_mode: "quarterly" | "survey";
  period_label: string | null;
  client_first_name: string;
  client_last_name: string;
  review_date: string | null;
  review_summary: string;
  urgency_flag: string | null;
  charter_alignment: string | null;
  purpose_statement: string;
  diagnostics: Diag | null;
  alignment_cards: Card[] | null;
  action_plan: ActionPlan | null;
  footer_note: string;
  generation_status: string;
  generation_error: string | null;
  logic_trace: string | null;
};

const PHASES_BY_MODE: Record<"quarterly" | "survey", { key: keyof ActionPlan; label: string; window: string }[]> = {
  quarterly: [
    { key: "phase_1", label: "Immediate", window: "Days 1–30" },
    { key: "phase_2", label: "Structural Alignment", window: "Days 31–60" },
    { key: "phase_3", label: "Governance & Reporting", window: "Days 61–90" },
  ],
  survey: [
    { key: "phase_1", label: "Immediate", window: "Days 1–30" },
    { key: "phase_2", label: "Structural Purification", window: "Days 31–60" },
    { key: "phase_3", label: "Governance Ratification", window: "Days 61–90" },
  ],
};

const STATUS_OPTIONS = ["Aligned", "Partial", "Needs Attention", "Not Assessed"];
const STATUS_COLOR: Record<string, string> = {
  Aligned: "#27ae60",
  Partial: "#e67e22",
  "Needs Attention": "#c0392b",
  "Not Assessed": "#c0392b",
};

const money = (n: number | undefined | null) => `$${Math.round(n ?? 0).toLocaleString()}`;
const signed = (n: number) => `${n >= 0 ? "+" : "-"}${money(Math.abs(n))}`;

const colLabel: React.CSSProperties = { fontSize: "6.5pt", letterSpacing: ".1em", textTransform: "uppercase", color: "#94a3b8", marginBottom: "2mm", paddingBottom: "1.5mm", borderBottom: "1px solid #e2e8f0" };
const colText: React.CSSProperties = { fontSize: "8.5pt", color: "#334155", lineHeight: 1.4 };

const TARGET_COLOR: Record<TargetCheck["status"], string> = { met: "#27ae60", below: "#c0392b", above: "#c0392b", info: "#64748b", not_computable: "#94a3b8" };
const targetMark = (s: TargetCheck["status"]) => (s === "met" ? "✓ " : s === "below" || s === "above" ? "✗ " : "• ");

function StatusCard({ label, status, detail, targets, note }: { label: string; status: string; detail: string; targets?: TargetCheck[]; note?: string }) {
  return (
    <div style={{ background: "#fafafa", borderLeft: "3px solid #a37c58", padding: "3mm 4mm" }}>
      <strong style={{ display: "block", fontSize: "8.5pt", fontWeight: 600, color: "#334155", marginBottom: "1mm" }}>
        {label}&nbsp;
        <span style={{ color: STATUS_COLOR[status] ?? "#e67e22", fontSize: "7pt", letterSpacing: ".08em", textTransform: "uppercase" }}>{status}</span>
      </strong>
      <p style={{ fontSize: "7.5pt", color: "#334155", lineHeight: 1.5 }}>{detail || "—"}</p>
      {(targets ?? []).map((t, i) => (
        <p key={i} style={{ fontSize: "7pt", lineHeight: 1.45, marginTop: "1mm", color: TARGET_COLOR[t.status] }}>
          {targetMark(t.status)}{t.summary.replace(/^Charter: /, "Charter target: ")}
        </p>
      ))}
      {note && <p style={{ fontSize: "7pt", lineHeight: 1.45, marginTop: "1.2mm", color: "#64748b", fontStyle: "italic" }}>{note}</p>}
    </div>
  );
}

function StatRow({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "7.5pt", color: tone ?? "#64748b" }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

const bsHead: React.CSSProperties = { fontSize: "6.5pt", letterSpacing: ".1em", textTransform: "uppercase", color: "#94a3b8", marginBottom: "1.5mm" };

function BsRow({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0.8mm 0", fontSize: strong ? "8.5pt" : "8pt", fontWeight: strong ? 700 : 400, color: tone ?? (strong ? "#334155" : "#64748b") }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function PageHeader({ kicker, name, period, title }: { kicker: string; name: string; period: string; title: string }) {
  return (
    <div>
      <div style={{ fontSize: "7.5pt", letterSpacing: ".1em", textTransform: "uppercase", color: "#94a3b8", marginBottom: "1.5mm" }}>
        {kicker} &nbsp;·&nbsp; Prepared for <strong>{name}</strong>{period && <> &nbsp;·&nbsp; {period}</>}
      </div>
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "18pt", fontWeight: 300, color: "#334155", lineHeight: 1.1 }}>{title}</div>
      <hr style={{ width: "18mm", height: "3px", background: "#a37c58", border: "none", marginTop: "2.5mm" }} />
    </div>
  );
}

export default function QuarterlySystemReview() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const autoSave = useAutoSave<Review>({
    data: review,
    enabled: editing,
    onSave: async (r) => {
      const { error } = await supabase
        .from("quarterly_system_reviews")
        .update({
          review_summary: r.review_summary, urgency_flag: r.urgency_flag, charter_alignment: r.charter_alignment,
          alignment_cards: r.alignment_cards as never, action_plan: r.action_plan as never, footer_note: r.footer_note,
          generation_status: "manually_edited",
        } as never)
        .eq("id", r.id);
      if (error) { toast.error(error.message); return false; }
      return true;
    },
  });

  const load = async () => {
    if (!id) return;
    const { data, error } = await supabase.from("quarterly_system_reviews").select("*").eq("id", id).maybeSingle();
    if (error) toast.error(error.message);
    setReview((data as unknown as Review) ?? null);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  // Statements read by the Vault scan wait for approval in Glass-Box Review before they change any figure here.
  const [pendingStatements, setPendingStatements] = useState(0);
  useEffect(() => {
    if (!review?.household_id) return;
    supabase.from("stage2_verification_audit").select("id", { count: "exact", head: true })
      .eq("household_id", review.household_id).eq("review_status", "pending")
      .then(({ count }) => setPendingStatements(count ?? 0));
  }, [review?.household_id, review?.generation_status]);

  const generating = review?.generation_status === "generating" || review?.generation_status === "pending";
  useEffect(() => {
    if (!generating) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line
  }, [generating]);

  const regenerate = async () => {
    if (!review) return;
    setRegenerating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/quarterly-system-review-generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ reviewId: review.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Regeneration failed");
      toast.success("Quarterly Review refreshed");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Regeneration failed");
    } finally {
      setRegenerating(false);
    }
  };

  const patch = (p: Partial<Review>) => setReview((r) => (r ? { ...r, ...p } : r));
  const patchCard = (i: number, p: Partial<Card>) =>
    patch({ alignment_cards: (review?.alignment_cards ?? []).map((c, j) => (j === i ? { ...c, ...p } : c)) });
  const patchItem = (phase: keyof ActionPlan, i: number, p: Partial<ActionItem>) =>
    patch({ action_plan: { ...(review!.action_plan as ActionPlan), [phase]: (review!.action_plan?.[phase] ?? []).map((it, j) => (j === i ? { ...it, ...p } : it)) } });
  const addItem = (phase: keyof ActionPlan) =>
    patch({ action_plan: { phase_1: [], phase_2: [], phase_3: [], ...(review!.action_plan ?? {}), [phase]: [...(review!.action_plan?.[phase] ?? []), { title: "", detail: "" }] } });
  const removeItem = (phase: keyof ActionPlan, i: number) =>
    patch({ action_plan: { ...(review!.action_plan as ActionPlan), [phase]: (review!.action_plan?.[phase] ?? []).filter((_, j) => j !== i) } });

  if (loading) return <div className="flex h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!review) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Quarterly Review not found.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate(-1)}><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
      </div>
    );
  }

  const isLegacy = review.layout_version < 2;
  const isSurvey = review.review_mode === "survey";
  const docName = isSurvey ? "Sovereignty Survey" : "Quarterly Review";
  const PHASES = PHASES_BY_MODE[isSurvey ? "survey" : "quarterly"];
  const completeness = review.diagnostics?.data_completeness;
  const diag: Diag = review.diagnostics ?? {};
  const cards = review.alignment_cards ?? [];
  const name = `${review.client_first_name} ${review.client_last_name}`.trim();
  const dateLabel = review.review_date ? format(new Date(`${review.review_date}T12:00:00`), "MMMM d, yyyy") : "";
  const period = review.period_label ? review.period_label.replace(" ", " ") : "";
  const deltas = diag.deltas;
  const liabilities = (diag.personal_liabilities_total ?? 0) + (diag.corp_liabilities_total ?? 0);

  return (
    <div className="min-h-screen bg-[#fafafa]">
      <div className="print:hidden sticky top-0 z-20 border-b border-[#e2e8f0] bg-[#fafafa]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
            <div className="text-sm text-[#334155]">
              <span className="font-semibold">{docName}</span>
              {period && <span className="ml-2 text-[#64748b]">{period}</span>}
              <span className="ml-2 text-xs uppercase tracking-wider text-[#a37c58]">{review.generation_status.replace(/_/g, " ")}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {editing && <AutoSaveIndicator status={autoSave} />}
            {editing ? (
              <Button size="sm" onClick={async () => { if (autoSave.isDirty) await autoSave.flush(); setEditing(false); load(); }} disabled={autoSave.saving}>
                {autoSave.saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Done
              </Button>
            ) : (
              <>
                <Button size="sm" variant="outline" onClick={regenerate} disabled={regenerating || generating}>
                  {regenerating || generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />} {isLegacy ? "Upgrade to new format" : "Regenerate"}
                </Button>
                {!isLegacy && <Button size="sm" variant="outline" onClick={() => setEditing(true)} disabled={generating}>Edit</Button>}
                {!isLegacy && <Button size="sm" onClick={() => window.print()} disabled={generating}><Printer className="mr-2 h-4 w-4" /> Print / PDF</Button>}
              </>
            )}
          </div>
        </div>
        {review.generation_status === "failed" && (
          <div className="border-t border-red-300 bg-red-50 px-6 py-2 text-xs text-red-700">Generation failed: {review.generation_error || "Unknown error"}. Click Regenerate to retry.</div>
        )}
        {generating && <div className="border-t border-amber-300 bg-amber-50 px-6 py-2 text-xs text-amber-800">Building this review from the household's live records. Refreshing every 3 seconds…</div>}
      </div>

      {!isLegacy && (pendingStatements > 0 || review.diagnostics?.vault_scan === "started") && !editing && (
        <div className="print:hidden border-b border-amber-300 bg-amber-50 px-6 py-2 text-xs text-amber-900">
          <div className="mx-auto max-w-[1100px]">
            {pendingStatements > 0 ? (
              <>
                {pendingStatements} statement{pendingStatements === 1 ? "" : "s"} read from the Vault {pendingStatements === 1 ? "is" : "are"} waiting for your approval in{" "}
                <Link to="/glass-box-review" className="font-semibold underline">Glass-Box Review</Link>. Approve {pendingStatements === 1 ? "it" : "them"}, then Regenerate so this review uses the new figures.
              </>
            ) : (
              <>A Vault scan was started for this household. You'll get a notification when its statements are ready in <Link to="/glass-box-review" className="font-semibold underline">Glass-Box Review</Link>.</>
            )}
          </div>
        </div>
      )}

      {isLegacy && !generating && (
        <div className="mx-auto max-w-[1100px] px-6 py-10 print:hidden">
          <div className="rounded-lg border border-[#e2e8f0] bg-white p-6 text-sm text-[#334155]">
            <p className="font-semibold">This review was created in the earlier format.</p>
            <p className="mt-2 text-[#64748b]">Use <strong>Upgrade to new format</strong> to rebuild it from the household's current records as a Quarterly Review in the new layout.</p>
            {review.review_summary && <p className="mt-4 border-l-2 border-[#a37c58] pl-3 italic text-[#64748b]">{review.review_summary}</p>}
          </div>
        </div>
      )}

      {editing && !isLegacy && (
        <div className="mx-auto max-w-[1100px] space-y-5 px-6 py-6 print:hidden">
          <div className="rounded-lg border border-[#e2e8f0] bg-white p-4 space-y-3">
            <div><Label>Summary</Label><Textarea rows={3} value={review.review_summary ?? ""} onChange={(e) => patch({ review_summary: e.target.value })} /></div>
            <div><Label>Focus this quarter</Label><Textarea rows={2} value={review.urgency_flag ?? ""} onChange={(e) => patch({ urgency_flag: e.target.value })} /></div>
            <div><Label>{isSurvey ? "What a Charter would govern" : "Alignment with the Charter"}</Label><Textarea rows={4} value={review.charter_alignment ?? ""} onChange={(e) => patch({ charter_alignment: e.target.value })} /></div>
            <div><Label>Footer</Label><Input value={review.footer_note ?? ""} onChange={(e) => patch({ footer_note: e.target.value })} /></div>
          </div>
          <div className="rounded-lg border border-[#e2e8f0] bg-white p-4 space-y-3">
            <p className="text-sm font-semibold">Alignment cards</p>
            {cards.map((c, i) => (
              <div key={c.key} className="grid gap-2 sm:grid-cols-[180px_180px_1fr] items-start">
                <div className="pt-2 text-sm">{c.label}</div>
                <Select value={c.status} onValueChange={(v) => patchCard(i, { status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
                <div className="space-y-1">
                  <Textarea rows={2} value={c.detail} onChange={(e) => patchCard(i, { detail: e.target.value })} />
                  <Textarea rows={2} placeholder="Charter note" value={c.charter_note ?? ""} onChange={(e) => patchCard(i, { charter_note: e.target.value })} />
                </div>
              </div>
            ))}
          </div>
          {PHASES.map((ph) => (
            <div key={ph.key} className="rounded-lg border border-[#e2e8f0] bg-white p-4 space-y-3">
              <p className="text-sm font-semibold">{ph.label} <span className="font-normal text-[#94a3b8]">· {ph.window}</span></p>
              {(review.action_plan?.[ph.key] ?? []).map((it, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto] items-start">
                  <Input value={it.title} placeholder="Title" onChange={(e) => patchItem(ph.key, i, { title: e.target.value })} />
                  <Textarea rows={2} value={it.detail} placeholder="Detail" onChange={(e) => patchItem(ph.key, i, { detail: e.target.value })} />
                  <Button variant="ghost" size="icon" onClick={() => removeItem(ph.key, i)}><X className="h-4 w-4" /></Button>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => addItem(ph.key)}><Plus className="mr-1 h-4 w-4" /> Add item</Button>
            </div>
          ))}
        </div>
      )}

      {!isLegacy && (
        <div className="mx-auto max-w-[210mm] px-6 py-6 print:p-0 print:max-w-none">
          {/* Page 1 */}
          <div className="stab-doc bg-white shadow-lg print:shadow-none" style={{ width: "210mm", minHeight: "297mm", display: "flex", fontFamily: "'DM Sans', sans-serif", color: "#334155" }}>
            <aside style={{ width: "60mm", backgroundColor: "#1e293b", color: "#fff", padding: "10mm 6mm", display: "flex", flexDirection: "column", gap: "6mm", flexShrink: 0 }}>
              <div>
                <img src={pwLogoWhite} alt="ProsperWise" style={{ width: "42mm", height: "auto", display: "block", marginBottom: "3mm" }} />
                <div style={{ fontSize: "9pt", fontWeight: 300, color: "rgba(255,255,255,.5)", letterSpacing: ".08em", textTransform: "uppercase" }}>Sovereignty Operating System™</div>
              </div>
              <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,.18)" }} />
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "16pt", fontWeight: 300, lineHeight: 1.3 }}>
                Don't Invest. <em style={{ fontStyle: "italic", color: "rgba(255,255,255,.7)" }}>Integrate.</em>
              </div>
              <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,.18)" }} />
              <div>
                <div style={{ fontSize: "6.5pt", letterSpacing: ".12em", textTransform: "uppercase", color: "rgba(255,255,255,.4)", marginBottom: "2mm" }}>Our Process</div>
                {[["1 · Stabilization", "Secure your funds, lower the noise, buy time to think clearly."], ["2 · Charter", "Define your governing constitution and liquidity rules."], ["3 · Integration", "Deploy capital, coordinate your team, silence the noise."]].map(([t, d]) => (
                  <div key={t} style={{ marginBottom: "3mm" }}>
                    <strong style={{ fontSize: "8.5pt", fontWeight: 600 }}>{t}</strong>
                    <p style={{ fontSize: "7.5pt", color: "rgba(255,255,255,.5)", marginTop: "1pt" }}>{d}</p>
                  </div>
                ))}
              </div>
              <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,.18)" }} />
              <div>
                <strong style={{ display: "block", fontSize: "8.5pt", fontWeight: 600 }}>Prepared By:<br />Rolf Issler, BMgt, CLU</strong>
                <p style={{ fontSize: "7.5pt", color: "rgba(255,255,255,.5)", marginTop: "1pt" }}>Sudden Wealth Specialist, Family CFO</p>
              </div>
              <div style={{ marginTop: "auto", paddingTop: "4mm" }}>
                <div style={{ fontSize: "6.5pt", color: "rgba(255,255,255,.4)", lineHeight: 1.5 }}>
                  © {new Date().getFullYear()} ProsperWise Advisors · www.prosperwise.ca<br />
                  Data residency: Canada. All client data stored and processed in Canadian data centers in compliance with PIPEDA.
                </div>
              </div>
            </aside>

            <main style={{ flex: 1, padding: "10mm 10mm 0 10mm", display: "flex", flexDirection: "column", gap: "5mm" }}>
              <div style={{ marginBottom: "3mm" }}>
                <div style={{ fontSize: "7.5pt", letterSpacing: ".1em", textTransform: "uppercase", color: "#94a3b8", marginBottom: "3mm" }}>
                  {docName} &nbsp;·&nbsp; Prepared for <strong>{name}</strong>{dateLabel && <> &nbsp;·&nbsp; {dateLabel}</>}
                </div>
                <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "25pt", fontWeight: 300, color: "#334155", lineHeight: 1.3, letterSpacing: "-0.005em" }}>
                  {isSurvey ? "Sovereignty Survey™" : "Sovereignty Quarterly Review™"}
                </div>
                <hr style={{ width: "18mm", height: "3px", background: "#a37c58", border: "none", marginTop: "4mm" }} />
              </div>

              <div style={{ background: "#fafafa", borderLeft: "3px solid #a37c58", padding: "3mm 5mm", display: "flex", flexDirection: "column", gap: "1mm" }}>
                <div style={{ fontStyle: "italic", fontSize: "7.5pt", color: "#334155", lineHeight: 1.55 }}>{review.review_summary || "—"}</div>
                <div style={{ fontSize: "7.5pt", color: "#334155" }}>{review.urgency_flag || "—"}</div>
              </div>

              <div>
                <div style={colLabel}>{isSurvey ? "What a Charter Would Govern" : "Alignment with Your Charter"}</div>
                {!isSurvey && review.purpose_statement && (
                  <p style={{ ...colText, fontStyle: "italic", color: "#64748b", marginBottom: "2mm" }}>“{review.purpose_statement}”</p>
                )}
                <p style={colText}>{review.charter_alignment || "—"}</p>
              </div>

              <div>
                <div style={colLabel}>Capital &amp; Asset Protection</div>
                {/* Balance sheet: assets on the left; liabilities and net worth on the right (they add up to total assets). */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 10mm", marginBottom: "3mm" }}>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <div style={bsHead}>Assets</div>
                    {(diag.holding_tank_total ?? 0) > 0 && <BsRow label="Holding Tank" value={money(diag.holding_tank_total)} />}
                    <BsRow label="Vineyard" value={money(diag.vineyard_total)} />
                    <BsRow label="Liquidity Reserve" value={money(diag.storehouse_reserves?.liquidity)} />
                    <BsRow label="Strategic Reserve" value={money(diag.storehouse_reserves?.strategic)} />
                    <BsRow label="Philanthropic Trust" value={money(diag.storehouse_reserves?.philanthropic)} />
                    <BsRow label="Legacy Trust" value={money(diag.storehouse_reserves?.legacy)} />
                    <div style={{ marginTop: "auto", paddingTop: "1.5mm" }}>
                      <hr style={{ border: "none", borderTop: "1.5px solid #334155", margin: "0 0 1.5mm" }} />
                      <BsRow label="Total Assets" value={money(diag.aum)} strong />
                      {deltas && deltas.aum !== null && (
                        <div style={{ fontSize: "7pt", color: "#94a3b8", textAlign: "right" }}>{signed(deltas.aum)} since {deltas.previousLabel ?? "last review"}</div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <div style={bsHead}>Liabilities &amp; Net Worth</div>
                    <BsRow label="Liabilities" value={money(liabilities)} tone="#c0392b" />
                    <BsRow label="Net Worth" value={money(diag.net_worth ?? diag.aum)} strong />
                    {deltas && deltas.netWorth !== null && (
                      <div style={{ fontSize: "7pt", color: "#94a3b8", textAlign: "right" }}>{signed(deltas.netWorth)} since {deltas.previousLabel ?? "last review"}</div>
                    )}
                    <div style={{ marginTop: "auto", paddingTop: "1.5mm" }}>
                      <hr style={{ border: "none", borderTop: "1.5px solid #334155", margin: "0 0 1.5mm" }} />
                      <BsRow label="Total Liabilities & Net Worth" value={money(liabilities + (diag.net_worth ?? diag.aum ?? 0))} strong />
                    </div>
                  </div>
                </div>
                {(diag.allocation?.notes ?? []).length > 0 && (
                  <div style={{ marginBottom: "3mm" }}>
                    {diag.allocation!.notes.map((n, i) => (
                      <div key={i} style={{ fontSize: "6.5pt", color: "#94a3b8", fontStyle: "italic", lineHeight: 1.4 }}>{n}</div>
                    ))}
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "4mm" }}>
                  <StatRow label="Asset Protection" value={money(diag.insurance_coverage_total)} tone="#334155" />
                  {diag.harvest && <StatRow label="Harvest to date" value={diag.harvest.current === null ? "—" : money(diag.harvest.current)} tone="#334155" />}
                  {typeof diag.accounts === "number" && <StatRow label="Statements read" value={`${diag.tracked_accounts ?? 0}/${diag.accounts}`} tone="#334155" />}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(60mm, 1fr))", gap: "3mm" }}>
                {cards.map((c) => <StatusCard key={c.key} label={c.label} status={c.status} detail={c.detail} targets={c.targets} note={c.charter_note} />)}
              </div>
            </main>
          </div>

          {/* Page 2 — 90-Day Plan */}
          <div className="stab-doc-page2 bg-white shadow-lg print:shadow-none mt-6 print:mt-0" style={{ width: "210mm", minHeight: "297mm", padding: "12mm", display: "flex", flexDirection: "column", gap: "5mm", fontFamily: "'DM Sans', sans-serif", color: "#334155", pageBreakBefore: "always", breakBefore: "page" }}>
            <PageHeader kicker={docName} name={name} period={period} title={isSurvey ? "90-Day Sovereignty Plan" : "90-Day Alignment Plan"} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8mm", flex: 1 }}>
              {PHASES.map((ph) => (
                <div key={ph.key}>
                  <div style={{ fontSize: "8pt", fontWeight: 600, color: "#334155", marginBottom: "2mm" }}>
                    {ph.label} <span style={{ color: "#94a3b8", fontWeight: 400 }}>· {ph.window}</span>
                  </div>
                  {(review.action_plan?.[ph.key] ?? []).length === 0 ? (
                    <p style={{ ...colText, color: "#94a3b8" }}>—</p>
                  ) : (
                    review.action_plan![ph.key].map((it, i) => (
                      <div key={i} style={{ marginBottom: "3mm" }}>
                        <p style={{ ...colText, fontWeight: 600 }}>{it.title || "—"}</p>
                        {it.detail && <p style={{ ...colText, color: "#64748b" }}>{it.detail}</p>}
                      </div>
                    ))
                  )}
                </div>
              ))}
            </div>
            <div style={{ background: "#a37c58", color: "#fff", margin: "auto -12mm 0 -12mm", padding: "3mm 12mm" }}>
              <div style={{ fontSize: "8.5pt", fontWeight: 500 }}>{review.footer_note}</div>
            </div>
          </div>

          {review.diagnostics?.charter_file && !editing && (
            <div className="mt-6 rounded-lg border border-[#e2e8f0] bg-white p-4 text-xs text-[#64748b] print:hidden">
              <div className="mb-1 font-semibold uppercase tracking-wider text-[#a37c58]">Charter used (staff only)</div>
              <p>{review.diagnostics.charter_file.name}{review.diagnostics.charter_file.modifiedTime ? ` · updated ${format(new Date(review.diagnostics.charter_file.modifiedTime), "MMM d, yyyy")}` : ""} · {review.diagnostics.charter_file.viaSubfolder ? "Charter subfolder" : "Correspondence folder"} · {review.diagnostics.charter_file.ratified ? "treated as ratified" : "looks like a draft"} · {review.diagnostics.charter_file.textRead ? "text read for the commentary" : "text could not be read"}</p>
            </div>
          )}

          {review.diagnostics?.charter_extract && !editing && (
            <div className="mt-6 rounded-lg border border-[#e2e8f0] bg-white p-4 text-xs text-[#64748b] print:hidden">
              <div className="mb-1 font-semibold uppercase tracking-wider text-[#a37c58]">Read from the Charter (staff only)</div>
              <ul className="space-y-1">
                {review.diagnostics.charter_extract.purpose && <li><strong>Purpose:</strong> {review.diagnostics.charter_extract.purpose}</li>}
                {review.diagnostics.charter_extract.mission && <li><strong>Mission of capital:</strong> {review.diagnostics.charter_extract.mission}</li>}
                {review.diagnostics.charter_extract.reserve_rules && <li><strong>Reserve rules:</strong> {review.diagnostics.charter_extract.reserve_rules}</li>}
                {review.diagnostics.charter_extract.monthly_spending !== null && <li><strong>Monthly spending:</strong> {money(review.diagnostics.charter_extract.monthly_spending)}</li>}
              </ul>
              <div className="mt-2 font-semibold">Numeric targets ({review.diagnostics.charter_extract.targets.length})</div>
              {review.diagnostics.charter_extract.targets.length === 0 ? (
                <p>None were read from the Charter.</p>
              ) : (
                <ul className="space-y-1">
                  {review.diagnostics.charter_extract.targets.map((t, i) => (
                    <li key={i}>
                      <span style={{ color: TARGET_COLOR[t.status] }}>{targetMark(t.status).trim()}</span> {t.summary.replace(/^Charter: /, "")}
                      {t.quote && <span className="italic"> — “{t.quote}”</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {completeness && !editing && (
            <div className="mt-6 rounded-lg border border-[#e2e8f0] bg-white p-4 text-xs text-[#64748b] print:hidden">
              <div className="mb-1 font-semibold uppercase tracking-wider text-[#a37c58]">Data on file (staff only)</div>
              <p>Records exist for {completeness.onFile} of {completeness.total} areas.{completeness.missing.length > 0 && <> Not yet on file: {completeness.missing.join(", ")}. These show as "Not Assessed" and are not findings; add the records and regenerate for a fuller picture.</>}</p>
            </div>
          )}

          {review.logic_trace && !editing && (
            <div className="mt-6 rounded-lg border border-[#e2e8f0] bg-white p-4 text-xs text-[#64748b] print:hidden">
              <div className="mb-1 font-semibold uppercase tracking-wider text-[#a37c58]">How this review was built (staff only)</div>
              <p className="whitespace-pre-wrap">{review.logic_trace}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
