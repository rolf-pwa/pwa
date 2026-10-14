import { useState, type ReactNode } from "react";
import { ArrowRight, CheckCircle2, Circle, HelpCircle, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { useOnboarding, type OnboardingState } from "../hooks/useOnboarding";

interface SplashStep { id: number; title: string; time: string; body: string; skippable?: boolean }

/** Georgia's wording for each step. Fixed text; only the first name is personalised. */
export const SPLASH_STEPS: SplashStep[] = [
  { id: 1, title: "Your household", time: "2 minutes", body: "Confirm who is in your household, so everything is set up for the right people." },
  { id: 2, title: "Your wealth event", time: "2 minutes", body: "Tell me a little about what brought you here. It helps Rolf prepare for your session." },
  { id: 3, title: "A bit more context", time: "2 minutes", skippable: true, body: "A few gentle questions about your situation, so Rolf comes to your session already understanding it." },
  { id: 4, title: "Your documents", time: "As much as you have", body: "Add the documents you have to hand. I've made a list based on your situation. I read and file each one into your private vault, so you don't have to organise anything. The more you share now, the more precise your Survey will be." },
  { id: 5, title: "Book your Survey Session", time: "1 minute", body: "Choose a time to sit down with Rolf. It is the conversation that completes your Sovereignty Survey, and he will have everything you've shared in front of him." },
];

/** Existing clients enrolled by Rolf follow a different path. */
export const LEGACY_SPLASH_STEPS: SplashStep[] = [
  { id: 1, title: "Household info", time: "2 minutes", body: "Confirm what we have on file for your household." },
  { id: 2, title: "Vision and values", time: "5 minutes", body: "Tell me what matters most to you and what you want your capital to do. Rolf builds your plan around it." },
  { id: 3, title: "Your documents", time: "As much as you have", body: "Add the documents you have to hand. I read and file each one into your private vault, so you don't have to organise anything." },
  { id: 4, title: "Book your meeting", time: "1 minute", body: "Choose a time to sit down with Rolf." },
];

const seenKey = (token: string) => `pw-onboarding-splash-seen:${token}`;
/** The splash comes back on every fresh visit, but not each time they step out of the guided flow and back. */
export const splashSeenThisVisit = (token: string) => { try { return sessionStorage.getItem(seenKey(token)) === "1"; } catch { return false; } };
export const markSplashSeen = (token: string) => { try { sessionStorage.setItem(seenKey(token), "1"); } catch { /* the splash simply shows again */ } };

/** The steps this household will actually do, with the optional context step left out for business events. */
export function splashStepsFor(state: Pick<OnboardingState, "household">): SplashStep[] {
  if (state.household.legacyUpgrade) return LEGACY_SPLASH_STEPS;
  const business = state.household.wealthEventType === "business_exit" || state.household.wealthEventType === "business_growth";
  return business ? SPLASH_STEPS.filter((s) => !s.skippable) : SPLASH_STEPS;
}

/** Where they are, as an index into the steps shown. */
export function currentSplashIndex(state: Pick<OnboardingState, "household">, steps: SplashStep[]): number {
  const raw = state.household.step;
  const i = steps.findIndex((s) => s.id >= raw);
  return i === -1 ? steps.length - 1 : i;
}

interface SplashProps { state: OnboardingState; onContinue: (stepId?: number) => void; onLookAround: () => void; onAskForHelp: () => void }

export function OnboardingSplash({ state, onContinue, onLookAround, onAskForHelp }: SplashProps) {
  const steps = splashStepsFor(state);
  const current = currentSplashIndex(state, steps);
  const started = current > 0 || Boolean(state.household.profileCompletedAt);
  const firstName = state.contact.firstName || state.contact.fullName || "there";
  return (
    <div className="mx-auto max-w-2xl space-y-5 py-4">
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="space-y-3 p-6">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground"><Sparkles className="h-3.5 w-3.5 text-primary" /> Sovereignty Operating System™</div>
          <h1 className="font-serif text-2xl font-semibold text-foreground">{started ? `Welcome back, ${firstName}.` : `Welcome, ${firstName}.`}</h1>
          <p className="text-sm text-muted-foreground">
            {started
              ? `You're on step ${current + 1} of ${steps.length}. Pick up right where you left off.`
              : "I'm Georgia, Rolf's AI assistant, and I'll walk you through getting started. This takes about ten minutes, and you can stop and come back at any time. Here's what we'll do together."}
          </p>
        </CardContent>
      </Card>

      <ol className="space-y-3">
        {steps.map((s, i) => {
          const done = i < current;
          const isCurrent = i === current;
          return (
            <li key={s.id}>
              <button type="button" onClick={() => onContinue(s.id)} aria-label={`${done ? "Review" : "Open"} step ${i + 1}: ${s.title}`}
                className={`block w-full rounded-lg border p-4 text-left transition hover:border-primary/60 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${isCurrent ? "border-primary/40 bg-card shadow-sm" : "border-border bg-card/60"} ${!isCurrent && !done ? "opacity-80" : ""}`}>
              <div className="flex items-start gap-3">
                {done ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" /> : <Circle className={`mt-0.5 h-5 w-5 shrink-0 ${isCurrent ? "text-primary" : "text-muted-foreground"}`} />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <h2 className="font-serif text-base font-semibold text-foreground">{i + 1}. {s.title}</h2>
                    <span className="text-xs text-muted-foreground">{done ? "Done" : s.time}</span>
                  </div>
                  {!done && <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>}
                </div>
                <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col items-center gap-3 pt-1">
        <Button size="lg" className="w-full gap-2 sm:w-auto" onClick={() => onContinue()}>
          {started ? "Continue where you left off" : "Let's begin"} <ArrowRight className="h-4 w-4" />
        </Button>
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-sm">
          <button type="button" onClick={onAskForHelp} className="inline-flex items-center gap-1 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"><HelpCircle className="h-3.5 w-3.5" /> Ask Georgia</button>
          <button type="button" onClick={onLookAround} className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Look around the portal first</button>
        </div>
        <p className="max-w-md text-center text-xs text-muted-foreground">Questions? Ask me here anytime, or reply to any of my emails and I'll make sure Rolf sees it.</p>
      </div>
    </div>
  );
}

interface GateProps { portalToken: string; onContinue: (stepId?: number) => void; onAskForHelp: () => void; children: ReactNode }

/**
 * Shows the welcome splash instead of the portal until onboarding is complete. Households that are not in the guided flow, and clients
 * who finished, go straight through. "Look around" lets them peek for the rest of this visit.
 */
export function OnboardingSplashGate({ portalToken, onContinue, onAskForHelp, children }: GateProps) {
  const { state, disabled, loading } = useOnboarding(portalToken);
  const [seen, setSeen] = useSeen(portalToken);
  if (!portalToken) return <>{children}</>;
  if (loading && !seen) return <div className="flex items-center justify-center py-24"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  const active = Boolean(state) && !disabled && !state!.household.onboardingCompletedAt;
  if (!active || seen) return <>{children}</>;
  return <OnboardingSplash state={state!} onContinue={(stepId) => { markSplashSeen(portalToken); onContinue(stepId); }} onAskForHelp={onAskForHelp} onLookAround={() => setSeen(true)} />;
}

function useSeen(token: string): [boolean, (v: boolean) => void] {
  const [seen, setSeen] = useState(() => splashSeenThisVisit(token));
  return [seen, (v) => { if (v) markSplashSeen(token); setSeen(v); }];
}
