import { useState } from "react";
import { Loader2, Phone } from "lucide-react";
import { z } from "zod";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { useGeorgia2 } from "./state";
import { submitLead } from "./submitLead";

// Shown instead of the normal gate when the free-text answer trips the safety
// screen. Everything on this screen is static, human-written copy: no model
// output ever appears here. It offers safety numbers, reassurance that
// nothing needs deciding today, a personal reply from Rolf, and a way back to
// the regular diagnostic in case the screening was a false alarm.
//
// COPY STATUS: drafted for review by Rolf -- confirm wording, and the
// crisis/emergency numbers, before treating as final.

const ContactSchema = z.object({
  first_name: z.string().trim().min(1, "First name required").max(80),
  email: z.string().trim().email("Valid email required").max(255),
  mobile: z.string().trim().max(40).optional().or(z.literal("")),
});

export function StepEmergency() {
  const { state, dispatch } = useGeorgia2();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);

  const request = async (e: React.FormEvent) => {
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
      await submitLead(state, "urgent_contact", { emergency: true });
      setSent(true);
    } catch (err) {
      dispatch({ type: "submit_error", error: err instanceof Error ? err.message : "Something went wrong" });
    } finally {
      dispatch({ type: "submitting", value: false });
    }
  };

  return (
    <div>
      <h2 className="font-serif text-3xl leading-snug md:text-4xl">Let's slow this down.</h2>
      <p className="mt-4 text-base leading-relaxed text-muted-foreground">
        What you've shared sounds heavy, and your safety and wellbeing come before any financial decision.
      </p>

      <div className="mt-6 space-y-2 rounded-md border border-accent/50 bg-accent/5 px-5 py-4 text-sm leading-relaxed">
        <p>
          <strong>If you or someone else is in immediate danger, call 911.</strong>
        </p>
        <p>
          If you're struggling to cope, you can call or text <strong>9-8-8</strong> (Canada's Suicide Crisis Helpline)
          at any time, day or night.
        </p>
      </div>

      <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
        Nothing about your finances needs to be decided or moved today. If anyone is pressuring you to transfer money or
        sign something, pause and don't do either until you've spoken with a professional you trust.
      </p>

      <div className="mt-8 rounded-md border border-border bg-muted/40 px-5 py-5">
        {sent ? (
          <div role="status">
            <p className="font-serif text-xl">Thank you.</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Rolf has been notified and will reach out to you personally.
            </p>
          </div>
        ) : (
          <form onSubmit={request} className="space-y-4">
            <div>
              <p className="font-serif text-xl">Would you like Rolf to reach out to you personally?</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Just your name and how to reach you. There's no obligation.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g2e-first">First Name</Label>
              <Input
                id="g2e-first"
                value={state.contact.first_name}
                onChange={(e) => dispatch({ type: "set_contact", contact: { first_name: e.target.value } })}
                autoComplete="given-name"
                maxLength={80}
                className="h-12 bg-background"
              />
              {errors.first_name && <p className="text-xs text-destructive">{errors.first_name}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g2e-email">Email</Label>
              <Input
                id="g2e-email"
                type="email"
                value={state.contact.email}
                onChange={(e) => dispatch({ type: "set_contact", contact: { email: e.target.value } })}
                autoComplete="email"
                maxLength={255}
                className="h-12 bg-background"
              />
              {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g2e-mobile">Mobile (optional)</Label>
              <Input
                id="g2e-mobile"
                type="tel"
                value={state.contact.mobile}
                onChange={(e) => dispatch({ type: "set_contact", contact: { mobile: e.target.value } })}
                autoComplete="tel"
                maxLength={40}
                className="h-12 bg-background"
              />
            </div>
            {state.submitError && (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                {state.submitError}
              </p>
            )}
            <Button type="submit" size="lg" disabled={state.submitting}>
              {state.submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Yes, please reach out
            </Button>
          </form>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <a
          href="https://www.prosperwise.ca/clarity-call"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <Phone className="h-4 w-4" /> Prefer to book a call yourself?
        </a>
        <button
          type="button"
          onClick={() => dispatch({ type: "set_step", step: 3 })}
          className="text-left text-muted-foreground underline-offset-4 hover:text-foreground hover:underline sm:text-right"
        >
          This isn't urgent — continue my diagnostic
        </button>
      </div>
    </div>
  );
}
