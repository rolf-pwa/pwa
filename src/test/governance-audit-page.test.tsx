// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const doc = vi.hoisted(() => ({
  client_name: "Colleen Jerczynski", review_date: "2026-10-07", reviewing_family_cfo: "Rolf Issler", track_type: "personal",
  executive_summary_bullets: ["Your system is in good order."],
  scorecard: [{ elementName: "Capital Infrastructure & Asset Allocation", target: "5 / 5", currentScore: 0, maxScore: 5, status: "PENDING ADVISOR REVIEW" }],
  pillar_analyses: [{ pillar: "Keep", current_total: 171024, narrative: "The Keep holds $171,024.00." }],
  element_deep_dives: [{ element_name: "Capital Infrastructure & Asset Allocation", charter_baseline: "Liquidity Reserve: target $100,000", current_score: 0, max_score: 5, audit_findings: ["A finding."], required_corrective_actions: ["Do the thing."] }],
  discussion_points: [{ title: "Reserve", body: "Discuss the reserve." }],
  computed: {
    pillar_totals: { Vineyard: 739573, Keep: 171024, Armoury: 61408, "Legacy Vault": 1537500 },
    target_income_equity_split: null, current_income_equity_split: null,
    terminal_tax_estimate: { registered_terminal_tax: 0, capital_gains_tax: 1000 },
    estate_liquidity_analysis: { total_estate_liquid_assets: 1, total_beneficiary_bypass_assets: 2, total_liabilities_and_taxes: 3, surplus_or_deficit: -4 },
    assumptions: ["An assumption."],
  },
  extraction_errors: [], narrative_ungrounded_dollar_figures: [], compliance_notes: ["Sovereignty Charter: ratified."],
  charter_summary: { source: "vault", ratified: true, file_name: "Charter - signed.pdf", purpose: "Lifelong independence." },
  charter_targets: [{ label: "Liquidity Reserve Target", area: "liquidity", status: "met", summary: "Charter: Liquidity Reserve Target (target $100,000); actual $171,024, met, $71,024 above the target.", quote: "q" }],
  estate_documents: { source: "documents", adults: [], trusts: 0, status: "Partial", detail: "Colleen: Will signed 2023-01-17; no Power of Attorney on file.", actions: ["Locate or draft Colleen's Power of Attorney."] },
  income_structure: { totalIncome: 123200, external: [{ label: "Government Benefits", annual_amount: 23200 }], externalTotal: 23200, capitalRequired: 100000, withdrawnYtd: 96162, capitalRemaining: 3838 },
  income_ytd: { withdrawals: 96162, year_fraction: 0.77 },
  income_tax: { basis: "household_tax_page", province: "BC", taxYearTables: 2024, mix: null, notes: [], totalDraws: 100000, totalBenefits: 23200, grossIncome: 123200, totalTax: 21000, afterTaxIncome: 102200, effectiveRate: 0.17,
    taxpayers: [{ name: "Colleen Jerczynski", taxableIncome: 60000, federalTax: 12000, provincialTax: 9000, totalTax: 21000, effectiveRate: 0.17, marginalRate: 0.282 }] },
  balance_sheet: { total_assets: 2519505, net_worth: 1610505, liabilities: 909000 },
}));

vi.mock("@/shared/integrations/supabase/client", () => {
  const row = { id: "a1", household_id: "h1", is_draft: false, generation_status: "complete", generation_error: null, generated_at: "2026-10-07", computed: doc };
  const chain = (data: unknown) => ({ select: () => chain(data), eq: () => chain(data), maybeSingle: async () => ({ data, error: null }) });
  return { supabase: { from: (t: string) => chain(t === "governance_audits" ? row : { status: "complete" }), auth: { getSession: async () => ({ data: { session: null } }) } } };
});

import GovernanceAudit from "../modules/audit/pages/GovernanceAudit";

describe("Governance Audit page in the Review's document style", () => {
  it("renders the sections in A4 pages with the shared sidebar, balance sheet, Charter and estate blocks", async () => {
    render(<MemoryRouter initialEntries={["/governance-audit/a1"]}><Routes><Route path="/governance-audit/:id" element={<GovernanceAudit />} /></Routes></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Sovereignty Governance Audit™")).toBeTruthy());
    for (const t of ["I. Executive Governance Summary", "Systemic Health Scorecard", "II. Capital Infrastructure Ledger", "Liquidity Reserve", "Legacy Trust", "Total Assets", "Liabilities & Net Worth", "Estate Documents on File", "Income & Tax", "Charter requires", "Year to date", "Projected year", "Total income", "Income after tax", "III. Element Deep-Dive & Scoring", "IV. Facilitated Discussion Points", "Compliance status"]) {
      expect(screen.getAllByText((_, el) => !!el?.textContent?.includes(t)).length, t).toBeGreaterThan(0);
    }
    expect(screen.getByText("Don't Invest.")).toBeTruthy(); // the shared brand sidebar
    expect(document.querySelectorAll(".stab-doc, .stab-doc-page2").length).toBe(3);
  });
});
