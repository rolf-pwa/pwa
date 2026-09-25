import { Phone } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { useGeorgia2 } from "./state";

// Shown instead of the normal gate when the free-text answer trips the safety
// screen. Everything on this screen is static, human-written copy: no model
// output ever appears here. It reassures, offers the Clarity Call page as the
// one way to talk to someone (there is deliberately no request-a-callback
// form, and nothing here promises a response), and gives a one-click way
// back to the regular diagnostic in case the screening was a false alarm.
//
// COPY STATUS: reviewed by Rolf 2026-09-26 -- no emergency-number lines, no
// ad-hoc outreach.
export function StepEmergency() {
  const { dispatch } = useGeorgia2();

  return (
    <div>
      <h2 className="font-serif text-3xl leading-snug md:text-4xl">Let's slow this down.</h2>
      <p className="mt-4 text-base leading-relaxed text-muted-foreground">
        What you've shared sounds heavy, and your wellbeing comes before any financial decision.
      </p>

      <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
        Nothing about your finances needs to be decided or moved today. If anyone is pressuring you to transfer money or
        sign something, pause and don't do either until you've spoken with a professional you trust.
      </p>

      <div className="mt-8 rounded-md border border-border bg-muted/40 px-5 py-5">
        <p className="font-serif text-xl">Would you like to talk it through?</p>
        <p className="mt-1 text-sm text-muted-foreground">
          You can book a Clarity Call at a time that suits you. There's no obligation.
        </p>
        <Button asChild size="lg" className="mt-4">
          <a href="https://www.prosperwise.ca/clarity-call" target="_blank" rel="noopener noreferrer">
            <Phone className="mr-2 h-4 w-4" />
            Book a Clarity Call
          </a>
        </Button>
      </div>

      <button
        type="button"
        onClick={() => dispatch({ type: "set_step", step: 3 })}
        className="mt-6 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        This isn't urgent — continue my diagnostic
      </button>
    </div>
  );
}
