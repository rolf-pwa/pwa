import { useGeorgia2 } from "./state";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { ArrowLeft, Lock, Loader2 } from "lucide-react";
import { z } from "zod";
import { useState } from "react";
import { trackGeorgia2 } from "@/modules/intake/lib/session-tracker";
import { computeGauges } from "@/modules/intake/lib/derive";

const ContactSchema = z.object({
  first_name: z.string().trim().min(1, "First name required").max(80),
  email: z.string().trim().email("Valid email required").max(255),
  mobile: z.string().trim().max(40).optional().or(z.literal("")),
});

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export function StepLeadCapture() {
  const { state, dispatch } = useGeorgia2();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    const parsed = ContactSchema.safeParse(state.contact);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed.error.flatten().fieldErrors)) {
        if (v && v[0]) errs[k] = v[0];
      }
      setErrors(errs);
      return;
    }
    dispatch({ type: "submitting", value: true });
    dispatch({ type: "submit_error", error: null });
    try {
      // Same computeGauges() BlueprintCanvas has been rendering live all
      // along — persisted now so Phase 2's Delta Engine has a stable,
      // queryable self-reported baseline (see the schema migration's own
      // comment for why this isn't recomputed server-side).
      const gauges = computeGauges(state.domain, state.catalyst, state.answers, state.scale);
      const res = await fetch(`${FUNCTIONS_URL}/georgia2-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_key: state.sessionKey,
          first_name: parsed.data.first_name,
          email: parsed.data.email,
          mobile: parsed.data.mobile || null,
          domain: state.domain,
          catalyst: state.catalyst,
          chosen_pathway: state.chosenPathway,
          scale: state.scale,
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
      trackGeorgia2({ lead_captured: true, final_phase: "complete", ended: true });
      if (state.chosenPathway === "survey") {
        const url = "https://www.prosperwise.ca/sovereignty-audit#pricing";
        // Break out of the embed iframe so the visitor lands on the real page.
        try {
          if (window.top && window.top !== window.self) {
            window.top.location.href = url;
          } else {
            window.location.href = url;
          }
        } catch {
          window.open(url, "_blank", "noopener,noreferrer");
        }
        return;
      }
      dispatch({ type: "set_step", step: 6 });

    } catch (err) {
      dispatch({
        type: "submit_error",
        error: err instanceof Error ? err.message : "Something went wrong",
      });
    } finally {
      dispatch({ type: "submitting", value: false });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl">Confidential contact.</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Just enough to send your next steps privately. Nothing more.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => dispatch({ type: "set_step", step: 4 })}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-primary">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <strong>Montréal Data Pinning Active.</strong> Zero tracking cookies. Your details never leave
          Canadian infrastructure.
        </span>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="g2-first">First Name</Label>
          <Input
            id="g2-first"
            value={state.contact.first_name}
            onChange={(e) => dispatch({ type: "set_contact", contact: { first_name: e.target.value } })}
            autoComplete="given-name"
            maxLength={80}
          />
          {errors.first_name && <p className="text-xs text-destructive">{errors.first_name}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="g2-email">Confidential Email</Label>
          <Input
            id="g2-email"
            type="email"
            value={state.contact.email}
            onChange={(e) => dispatch({ type: "set_contact", contact: { email: e.target.value } })}
            autoComplete="email"
            maxLength={255}
          />
          {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="g2-mobile">Confidential Mobile (optional)</Label>
          <Input
            id="g2-mobile"
            type="tel"
            value={state.contact.mobile}
            onChange={(e) => dispatch({ type: "set_contact", contact: { mobile: e.target.value } })}
            autoComplete="tel"
            maxLength={40}
          />
        </div>

        {state.submitError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {state.submitError}
          </div>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={state.submitting}>
          {state.submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting securely…
            </>
          ) : (
            "Submit Confidentially"
          )}
        </Button>
      </form>
    </div>
  );
}
