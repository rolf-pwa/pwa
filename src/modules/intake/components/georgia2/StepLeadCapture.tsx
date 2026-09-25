import { useGeorgia2 } from "./state";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Loader2, Lock } from "lucide-react";
import { z } from "zod";
import { useState } from "react";
import { trackGeorgia2 } from "@/modules/intake/lib/session-tracker";
import { BackLink, Question, WizardProgress, wizardProgress } from "./WizardParts";
import { submitLead } from "./submitLead";

const ContactSchema = z.object({
  first_name: z.string().trim().min(1, "First name required").max(80),
  email: z.string().trim().email("Valid email required").max(255),
  mobile: z.string().trim().max(40).optional().or(z.literal("")),
});

// The step-4 screen -- reached right after the diagnostic questions, before
// the results and action plan are shown (they stay gated until this is
// submitted). Submitting creates the lead and the server emails the results
// automatically; the results screen is only revealed once that succeeds.
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
      await submitLead(state, "confidential_roadmap");
      trackGeorgia2({ lead_captured: true, reached_lead_capture: true, final_phase: "complete", ended: true });
      dispatch({ type: "set_step", step: 5 });
    } catch (err) {
      dispatch({ type: "submit_error", error: err instanceof Error ? err.message : "Something went wrong" });
    } finally {
      dispatch({ type: "submitting", value: false });
    }
  };

  const { n } = wizardProgress(state);

  return (
    <div>
      <WizardProgress />
      <Question
        number={n}
        hint="Your Sovereignty Snapshot and prescribed directives are ready. Enter your details to unlock them — we'll email you a copy too. Just enough to follow up privately, nothing more."
      >
        Where should we send your confidential results?
      </Question>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="g2-first">First Name</Label>
          <Input
            id="g2-first"
            value={state.contact.first_name}
            onChange={(e) => dispatch({ type: "set_contact", contact: { first_name: e.target.value } })}
            autoComplete="given-name"
            maxLength={80}
            className="h-12 bg-muted/40"
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
            className="h-12 bg-muted/40"
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
            className="h-12 bg-muted/40"
          />
        </div>

        <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
          <span>Montréal data pinning. Zero tracking cookies. Your details never leave Canadian infrastructure.</span>
        </p>

        {state.submitError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {state.submitError}
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <BackLink onClick={() => dispatch({ type: "set_step", step: 3 })} />
          <Button type="submit" size="lg" className="mt-8" disabled={state.submitting}>
            {state.submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Reveal My Results
          </Button>
        </div>
      </form>
    </div>
  );
}
