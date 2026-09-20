import pwLogoWhite from "@/assets/prosperwise-logo-white.png";
import type { HouseholdCharter, NamedItem } from "../../hooks/useCharterIntake";

// Clones SovereigntyCharter.tsx's (v1 Charter) exact print/PDF visual system —
// no shared print component exists anywhere in this codebase (every one of
// SovereigntyCharter.tsx/StabilizationMap.tsx/QuarterlySystemReview.tsx/
// GovernanceAudit.tsx/ProTasksPanel.tsx independently duplicates its own copy),
// so this is a deliberate, consistent sixth copy of the same recipe: A4
// portrait, a dark header band per page, bronze-accented card helpers, a
// window.print() trigger in the parent page. Cormorant Garamond/DM Sans are
// already loaded globally via index.html — nothing to add here.

const pageStyle: React.CSSProperties = {
  width: "210mm",
  minHeight: "297mm",
  display: "flex",
  flexDirection: "column",
  fontFamily: "'DM Sans', sans-serif",
  color: "#334155",
};

// "charter-v2-page" mirrors v1's own "stab-doc" class: the only purpose is
// giving @media print something to zero the on-screen marginTop: "6mm" page
// separator on — v1 already has this reset (`.stab-doc { margin: 0 !important; }`),
// and without an equivalent here every page after the first prints with a
// stray 6mm gap pushed onto it, shifting layout against the size:A4/margin:0 @page rule.
const pageWrap = "charter-v2-page bg-white";

function formatCurrency(val: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);
}

function formatDate(val: string | null) {
  return val ? new Date(val).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" }) : "—";
}

function PageHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div style={{ backgroundColor: "#1e293b", color: "#fff", padding: "9mm 12mm 8mm" }}>
      <div style={{ fontSize: "8pt", fontWeight: 300, color: "rgba(255,255,255,.55)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: "3mm" }}>
        {eyebrow}
      </div>
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "23pt", fontWeight: 300, lineHeight: 1.08 }}>{title}</div>
    </div>
  );
}

function SectionCard({ title, body }: { title: string; body?: string | null }) {
  return (
    <div style={{ background: "#fafafa", borderLeft: "3px solid #a37c58", padding: "3mm 4mm" }}>
      <div style={{ fontSize: "6.5pt", letterSpacing: ".12em", textTransform: "uppercase", color: "#94a3b8", marginBottom: "1.5mm" }}>{title}</div>
      <p style={{ fontSize: "7.5pt", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{body?.trim() || "Not yet written."}</p>
    </div>
  );
}

function ArticleCard({ title, body }: { title: string; body?: string | null }) {
  return (
    <div style={{ border: "1px solid #e2e8f0", padding: "4mm", background: "#fff" }}>
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "13pt", fontWeight: 500, color: "#334155", marginBottom: "1.5mm" }}>{title}</div>
      <p style={{ fontSize: "7.5pt", lineHeight: 1.6, color: "#334155", whiteSpace: "pre-wrap" }}>{body?.trim() || "Not yet drafted."}</p>
    </div>
  );
}

function ContainerCard({ title, description }: { title: string; description?: string }) {
  return (
    <div style={{ background: "#fafafa", borderLeft: "3px solid #a37c58", padding: "3mm 4mm" }}>
      <strong style={{ display: "block", fontSize: "8.5pt", fontWeight: 600, color: "#334155", marginBottom: "1mm" }}>{title}</strong>
      {description?.trim() ? <p style={{ fontSize: "7.5pt", lineHeight: 1.5, color: "#334155" }}>{description}</p> : null}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "#fafafa", borderLeft: "3px solid #a37c58", padding: "3mm 4mm" }}>
      <div style={{ fontSize: "6.5pt", letterSpacing: ".12em", textTransform: "uppercase", color: "#94a3b8", marginBottom: "1.2mm" }}>{label}</div>
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "16pt", fontWeight: 500, color: "#334155" }}>{value}</div>
    </div>
  );
}

function EyebrowLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: "6.5pt", letterSpacing: ".12em", textTransform: "uppercase", color: "#94a3b8", marginBottom: "2mm" }}>{children}</div>
  );
}

function ListTable({
  headers,
  rows,
  emptyLabel,
}: {
  headers: string[];
  rows: string[][];
  emptyLabel: string;
}) {
  const headCell: React.CSSProperties = {
    fontSize: "7pt",
    fontWeight: 600,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: ".08em",
    padding: "2.4mm 2mm",
    borderBottom: "1px solid #e2e8f0",
    textAlign: "left",
  };
  const bodyCell: React.CSSProperties = { fontSize: "7.5pt", padding: "2.4mm 2mm", borderBottom: "1px solid #e2e8f0", verticalAlign: "top" };

  if (rows.length === 0) {
    return <div style={{ background: "#fafafa", padding: "4mm", fontSize: "8pt", color: "#64748b" }}>{emptyLabel}</div>;
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
      <thead>
        <tr style={{ background: "#fafafa" }}>
          {headers.map((h) => (
            <th key={h} style={headCell}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr key={idx}>
            {row.map((cell, cellIdx) => (
              <td key={cellIdx} style={bodyCell}>
                {cell || "—"}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const MILESTONE_STATUS_LABEL: Record<string, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  complete: "Complete",
};

interface Props {
  charter: HouseholdCharter;
  householdLabel: string;
}

export function CharterV2PrintDocument({ charter, householdLabel }: Props) {
  const treasury = charter.treasury_snapshot;
  const governance = charter.governance_snapshot;
  const philanthropicBalance = treasury?.storehouse_reserves.philanthropic ?? null;
  const lastAffirmed = charter.family_values_addendum_reaffirmed_at || charter.family_values_addendum_signed_at;
  const staleness = (() => {
    if (!lastAffirmed) return null;
    const affirmed = new Date(lastAffirmed);
    if (Number.isNaN(affirmed.getTime())) return null;
    const ageYears = (Date.now() - affirmed.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    return { isStale: ageYears > 3, ageYears: Math.round(ageYears * 10) / 10 };
  })();

  const statusLabel =
    charter.status === "complete"
      ? `Complete — ratified ${formatDate(charter.completed_at)}`
      : "Draft — not yet marked complete";

  return (
    <div id="charter-v2-printable-root" className="mx-auto max-w-[210mm]">
      {/* Page 1 — Cover + Foundational Bedrock */}
      <div className={pageWrap} style={pageStyle}>
        <div style={{ backgroundColor: "#1e293b", color: "#fff", padding: "10mm 12mm 9mm" }}>
          <img src={pwLogoWhite} alt="ProsperWise" style={{ width: "54mm", height: "auto", display: "block", marginBottom: "4mm" }} />
          <div style={{ fontSize: "8pt", fontWeight: 300, color: "rgba(255,255,255,.55)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: "4mm" }}>
            Sovereignty Operating System™
          </div>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "24pt", fontWeight: 300, lineHeight: 1.08 }}>The Sovereignty Charter</div>
          <div style={{ fontSize: "8pt", color: "rgba(255,255,255,.7)", marginTop: "2.5mm" }}>Sovereignty Charter v2.0 · Prepared for {householdLabel}</div>
        </div>

        <div style={{ padding: "12mm", display: "flex", flexDirection: "column", gap: "6mm" }}>
          <div>
            <div style={{ fontSize: "7.5pt", letterSpacing: ".1em", textTransform: "uppercase", color: "#94a3b8", marginBottom: "1.5mm" }}>
              Foundational Bedrock
            </div>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "25pt", fontWeight: 300, color: "#334155", lineHeight: 1.1 }}>
              Family Vision, Values &amp; Grounding Principles
            </div>
            <hr style={{ width: "18mm", height: "3px", background: "#a37c58", border: "none", marginTop: "2.5mm" }} />
          </div>

          <SectionCard title="Family Vision" body={charter.vision_text} />

          <div>
            <EyebrowLabel>Core Values</EyebrowLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4mm" }}>
              {charter.core_values.map((v: NamedItem) => (
                <ContainerCard key={v.key} title={v.title} description={v.description} />
              ))}
            </div>
          </div>

          <div>
            <EyebrowLabel>System Grounding Principles</EyebrowLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4mm" }}>
              {charter.grounding_principles.map((p: NamedItem) => (
                <ContainerCard key={p.key} title={p.title} description={p.description} />
              ))}
            </div>
          </div>
        </div>

        <div style={{ background: "#a37c58", color: "#fff", marginTop: "auto", padding: "3mm 12mm", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: "8.5pt", fontWeight: 500 }}>Status: {statusLabel}</div>
          <div style={{ fontSize: "7.5pt", opacity: 0.9 }}>Generated {formatDate(new Date().toISOString())}</div>
        </div>
      </div>

      {/* Page 2 — Perspective 1: Treasury & Capital Structure */}
      <div className={`${pageWrap} print-page-break`} style={{ ...pageStyle, marginTop: "6mm" }}>
        <PageHeader eyebrow="Perspective 1 · Financial" title="Treasury & Capital Structure" />
        <div style={{ padding: "12mm", display: "flex", flexDirection: "column", gap: "6mm" }}>
          {treasury ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "4mm" }}>
                <MetricCard label="AUM" value={formatCurrency(treasury.aum)} />
                <MetricCard label="Net Worth" value={formatCurrency(treasury.net_worth)} />
                <MetricCard label="Vineyard" value={formatCurrency(treasury.vineyard_total)} />
                <MetricCard label="Holding Tank" value={formatCurrency(treasury.holding_tank_total)} />
              </div>
              <div>
                <EyebrowLabel>The Storehouses</EyebrowLabel>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4mm" }}>
                  {(
                    [
                      ["liquidity", "Liquidity Reserve"],
                      ["strategic", "Strategic Reserve"],
                      ["philanthropic", "Philanthropic Trust"],
                      ["legacy", "Legacy Trust"],
                    ] as const
                  ).map(([key, label]) => {
                    const pct = treasury.storehouse_funded_pct[key];
                    return (
                      <ContainerCard
                        key={key}
                        title={label}
                        description={`${formatCurrency(treasury.storehouse_reserves[key])}${pct !== null ? ` (${Math.round(pct)}% funded)` : ""}`}
                      />
                    );
                  })}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5mm" }}>
                <ArticleCard title="Vineyard Replenishment Policy" body={charter.vineyard_replenishment_policy} />
                <ArticleCard title="The River Boundary Rule" body={charter.river_boundary_note} />
              </div>
            </>
          ) : (
            <SectionCard title="Treasury Snapshot" body="Not yet computed." />
          )}
        </div>
      </div>

      {/* Page 3 — Perspective 2: Family Well-Being & Stakeholder Harmony */}
      <div className={`${pageWrap} print-page-break`} style={{ ...pageStyle, marginTop: "6mm" }}>
        <PageHeader eyebrow="Perspective 2 · Customer" title="Family Well-Being & Stakeholder Harmony" />
        <div style={{ padding: "12mm", display: "flex", flexDirection: "column", gap: "5mm" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5mm" }}>
            <ArticleCard title="Discretionary Trust Guidelines" body={charter.discretionary_trust_guidelines} />
            <ArticleCard title="POA & Incapacity Protocol" body={charter.poa_incapacity_protocol} />
            <ArticleCard title="Shareholder Voting & Succession Philosophy" body={charter.shareholder_voting_philosophy} />
            <ArticleCard title="The Sovereignty Boundary Protocol" body={charter.boundary_protocol_note} />
            <ArticleCard title="Capital Request Framework" body={charter.capital_request_framework_note} />
            <ArticleCard title="Matrimonial & Asset Ring-Fencing" body={charter.matrimonial_ringfencing_note} />
          </div>
          <div>
            <EyebrowLabel>Meeting Transcripts Referenced</EyebrowLabel>
            <ListTable
              headers={["Title", "Synced"]}
              rows={charter.meeting_transcripts.map((t) => [t.title, formatDate(t.added_at)])}
              emptyLabel="No meeting transcripts synced yet."
            />
          </div>
        </div>
      </div>

      {/* Page 4 — Perspective 3: Operating Governance & Spoke Orchestration */}
      <div className={`${pageWrap} print-page-break`} style={{ ...pageStyle, marginTop: "6mm" }}>
        <PageHeader eyebrow="Perspective 3 · Internal Process" title="Operating Governance & Spoke Orchestration" />
        <div style={{ padding: "12mm", display: "flex", flexDirection: "column", gap: "5mm" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4mm" }}>
            <MetricCard
              label="Vault Protocol Readiness"
              value={governance ? `${governance.vault_protocol_readiness.percent}%` : "Not yet computed"}
            />
            {governance?.track_type === "corporate" && governance.tax_shields ? (
              <>
                <MetricCard label="SBD Clawback" value={formatCurrency(governance.tax_shields.sbd_clawback)} />
                <MetricCard label="Active Asset Ratio" value={`${Math.round(governance.tax_shields.active_asset_ratio.ratio * 100)}%`} />
                <MetricCard
                  label="CDA Balance"
                  value={governance.tax_shields.cda_balance !== null ? formatCurrency(governance.tax_shields.cda_balance) : "Not entered"}
                />
              </>
            ) : (
              <ContainerCard title="Corporate Tax Friction Shields" description="Not applicable — personal-track household." />
            )}
          </div>

          <div>
            <EyebrowLabel>Legal Documents Referenced</EyebrowLabel>
            <ListTable
              headers={["Title", "Type", "Category"]}
              rows={charter.legal_documents.map((d) => [d.title, d.document_type, d.source_category])}
              emptyLabel="No legal documents synced yet."
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5mm" }}>
            <ArticleCard title="Hub-and-Spoke Coordination Cadence" body={charter.hub_spoke_cadence_note} />
            <ArticleCard title="Tri-Party MOU Protocol" body={charter.tri_party_mou_note} />
            <ArticleCard title="Pure Fiduciary Standard" body={charter.pure_fiduciary_standard_note} />
            <ArticleCard title="Corporate Tax Friction Shields Commentary" body={charter.tax_friction_shields_note} />
          </div>
        </div>
      </div>

      {/* Page 5 — Perspective 4: Human Capital & Generational Stewardship */}
      <div className={`${pageWrap} print-page-break`} style={{ ...pageStyle, marginTop: "6mm" }}>
        <PageHeader eyebrow="Perspective 4 · Learning & Growth" title="Human Capital & Generational Stewardship" />
        <div style={{ padding: "12mm", display: "flex", flexDirection: "column", gap: "5mm" }}>
          <ArticleCard title="OpCo-to-WealthCo Identity Transition" body={charter.identity_transition_note} />

          <div>
            <EyebrowLabel>Next-Gen Milestones</EyebrowLabel>
            <ListTable
              headers={["Family Member", "Milestone", "Status"]}
              rows={charter.next_gen_milestones.map((m) => [m.member_name, m.milestone_title, MILESTONE_STATUS_LABEL[m.status] || m.status])}
              emptyLabel="No milestones added yet."
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "5mm" }}>
            <MetricCard
              label="Philanthropic Storehouse Balance"
              value={philanthropicBalance !== null ? formatCurrency(philanthropicBalance) : "Not yet computed"}
            />
            <ArticleCard title="Philanthropic Stewardship Engine" body={charter.philanthropic_stewardship_note} />
          </div>

          <div>
            <EyebrowLabel>Family Values Addendum</EyebrowLabel>
            <div style={{ background: "#fafafa", padding: "3mm 4mm", fontSize: "7.5pt", display: "flex", flexDirection: "column", gap: "1mm" }}>
              <div>Signed: {formatDate(charter.family_values_addendum_signed_at)}</div>
              <div>Reaffirmed: {formatDate(charter.family_values_addendum_reaffirmed_at)}</div>
              {staleness ? (
                <div style={{ color: staleness.isStale ? "#b45309" : "#047857" }}>
                  {staleness.isStale ? "Stale" : "Current"} — last affirmed {staleness.ageYears} years ago
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div style={{ background: "#a37c58", color: "#fff", marginTop: "auto", padding: "3mm 12mm", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: "8.5pt", fontWeight: 500 }}>End of Sovereignty Charter</div>
          <div style={{ fontSize: "7.5pt", opacity: 0.9 }}>Status: {statusLabel}</div>
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 0; }
          body { background: white !important; }
          .charter-v2-page { margin: 0 !important; }
          .print-page-break { break-before: page; page-break-before: always; }
        }
      `}</style>
    </div>
  );
}
