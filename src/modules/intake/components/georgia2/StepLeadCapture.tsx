import { useGeorgia2 } from "./state";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { ArrowLeft, Lock } from "lucide-react";
import { z } from "zod";
import { useState } from "react";
import { trackGeorgia2 } from "@/modules/intake/lib/session-tracker";

const ContactSchema = z.object({
  first_name: z.string().trim().min(1, "First name required").max(80),
  email: z.string().trim().email("Valid email required").max(255),
  mobile: z.string().trim().max(40).optional().or(z.literal("")),
});

// Now the step-4 screen -- reached right after the diagnostic questions,
// before the pathway/recommendation is ever shown. This step only
// validates and locally stores contact info; the actual submission to
// georgia2-lead happens later, in StepResults.tsx, once a pathway is
// chosen too (moved there when this step's position in the flow changed).
export function StepLeadCapture() {
  const { state, dispatch } = useGeorgia2();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = (e: React.FormEvent) => {
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
    trackGeorgia2({ reached_lead_capture: true, final_phase: "lead_capture" });
    dispatch({ type: "set_step", step: 5 });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl">Confidential contact.</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Just enough to personalize your pathway and follow up privately. Nothing more.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => dispatch({ type: "set_step", step: 3 })}>
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

        <Button type="submit" size="lg" className="w-full">
          See My Pathway
        </Button>
      </form>
    </div>
  );
}
