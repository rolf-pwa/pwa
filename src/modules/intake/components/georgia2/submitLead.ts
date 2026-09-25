import { computeGauges, type Pathway } from "@/modules/intake/lib/derive";
import type { Georgia2State } from "./state";

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

// Posts the lead to georgia2-lead. The first call for a session creates the
// lead and emails the results automatically; later calls (a pathway click,
// or re-submitting after Back) update that same lead. keepalive lets a
// pathway click survive the page navigating away right after it.
export async function submitLead(state: Georgia2State, pathway: Pathway): Promise<void> {
  if (!state.domain || !state.catalyst) throw new Error("Missing diagnostic answers");
  const gauges = computeGauges(state.domain, state.catalyst, state.answers);
  const res = await fetch(`${FUNCTIONS_URL}/georgia2-lead`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({
      session_key: state.sessionKey,
      first_name: state.contact.first_name,
      email: state.contact.email,
      mobile: state.contact.mobile || null,
      domain: state.domain,
      catalyst: state.catalyst,
      chosen_pathway: pathway,
      answers: state.answers,
      risk_scores_calculated: {
        tax_drag_risk: gauges.taxDragRisk,
        structure_safety: gauges.structureSafety,
        noise_strain: gauges.noiseStrain,
        readiness_score: gauges.readiness,
      },
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Submission failed (${res.status})`);
  }
}
