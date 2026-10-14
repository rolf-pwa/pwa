import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const hook = vi.fn();
vi.mock("@/modules/intake/hooks/useOnboarding", () => ({ useOnboarding: (t: string) => hook(t) }));
import { OnboardingSplashGate, splashStepsFor, currentSplashIndex, markSplashSeen } from "@/modules/intake/components/OnboardingSplash";

const state = (over: Record<string, unknown> = {}): any => ({
  household: { step: 1, legacyUpgrade: false, wealthEventType: null, profileCompletedAt: null, onboardingCompletedAt: null, ...over },
  contact: { firstName: "Sam", fullName: "Sam Lee" },
});
const mount = () => render(<OnboardingSplashGate portalToken="tok" onContinue={vi.fn()} onAskForHelp={vi.fn()}><div>THE PORTAL</div></OnboardingSplashGate>);

describe("OnboardingSplashGate", () => {
  beforeEach(() => { sessionStorage.clear(); hook.mockReset(); });

  it("shows Georgia's welcome with all five steps while onboarding is under way", () => {
    hook.mockReturnValue({ state: state(), disabled: false, loading: false });
    mount();
    expect(screen.getByText(/Welcome, Sam/)).toBeTruthy();
    expect(screen.queryByText("THE PORTAL")).toBeNull();
    expect(screen.getByText(/5\. Book your Survey Session/)).toBeTruthy();
  });

  it("lets the client look around, and the portal then shows", () => {
    hook.mockReturnValue({ state: state(), disabled: false, loading: false });
    mount();
    fireEvent.click(screen.getByText(/Look around the portal first/));
    expect(screen.getByText("THE PORTAL")).toBeTruthy();
  });

  it("goes straight to the portal when onboarding is complete or not enabled", () => {
    hook.mockReturnValue({ state: state({ onboardingCompletedAt: "2026-10-01" }), disabled: false, loading: false });
    mount();
    expect(screen.getByText("THE PORTAL")).toBeTruthy();
  });

  it("goes straight to the portal for a household outside the guided flow", () => {
    hook.mockReturnValue({ state: null, disabled: true, loading: false });
    mount();
    expect(screen.getByText("THE PORTAL")).toBeTruthy();
  });

  it("does not show again after stepping out of the guided flow in the same visit", () => {
    markSplashSeen("tok");
    hook.mockReturnValue({ state: state(), disabled: false, loading: false });
    mount();
    expect(screen.getByText("THE PORTAL")).toBeTruthy();
  });

  it("resumes with 'Welcome back' once started", () => {
    hook.mockReturnValue({ state: state({ step: 4, profileCompletedAt: "x" }), disabled: false, loading: false });
    mount();
    expect(screen.getByText(/Welcome back, Sam/)).toBeTruthy();
    expect(screen.getByText(/step 4 of 5/)).toBeTruthy();
  });
});

describe("splash steps", () => {
  it("leaves out the context step for a business sale", () => {
    const steps = splashStepsFor(state({ wealthEventType: "business_exit" }));
    expect(steps.map((s) => s.title)).not.toContain("A bit more context");
    expect(steps).toHaveLength(4);
  });
  it("finds where the household is among the steps shown", () => {
    const biz = state({ wealthEventType: "business_exit", step: 4 });
    expect(currentSplashIndex(biz, splashStepsFor(biz))).toBe(2);
  });
  it("uses the shorter path for existing clients", () => {
    expect(splashStepsFor(state({ legacyUpgrade: true })).map((s) => s.title)).toContain("Vision and values");
  });
});

describe("clickable steps", () => {
  it("opens the chosen step when its card is clicked", () => {
    sessionStorage.clear();
    hook.mockReturnValue({ state: state({ step: 2, profileCompletedAt: "x" }), disabled: false, loading: false });
    const onContinue = vi.fn();
    render(<OnboardingSplashGate portalToken="tok2" onContinue={onContinue} onAskForHelp={vi.fn()}><div>P</div></OnboardingSplashGate>);
    fireEvent.click(screen.getByRole("button", { name: /step 4: Your documents/ }));
    expect(onContinue).toHaveBeenCalledWith(4);
  });
});
