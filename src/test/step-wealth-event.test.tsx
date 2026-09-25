import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { StepWealthEvent } from "@/modules/intake/components/onboarding/StepWealthEvent";
import type { OnboardingState } from "@/modules/intake/hooks/useOnboarding";

function stateWith(household: Partial<OnboardingState["household"]>): OnboardingState {
  return {
    household: {
      label: "",
      address: "",
      step: 3,
      auditBookedAt: null,
      profileCompletedAt: null,
      wealthEventType: null,
      wealthEventNotes: "",
      wealthEventCompletedAt: null,
      visionNotes: "",
      valuesNotes: "",
      purposeNotes: "",
      onboardingCompletedAt: null,
      legacyUpgrade: false,
      vaultReady: false,
      ...household,
    },
    wealthEventOptions: ["inheritance", "divorce", "business_exit"],
  } as unknown as OnboardingState;
}

describe("StepWealthEvent", () => {
  it("asks the question normally when nothing was pre-filled", () => {
    render(<StepWealthEvent state={stateWith({})} saving={false} onSave={vi.fn()} />);
    expect(screen.getByText("What best describes your situation?")).toBeTruthy();
    expect(screen.queryByText(/From your Sovereignty Diagnostic/)).toBeNull();
  });

  it("shows a pre-filled diagnostic answer as a confirmation and saves it as-is", () => {
    const onSave = vi.fn();
    render(
      <StepWealthEvent
        state={stateWith({ wealthEventType: "inheritance", wealthEventFromDiagnostic: true })}
        saving={false}
        onSave={onSave}
      />
    );
    expect(screen.queryByText("What best describes your situation?")).toBeNull();
    expect(screen.getByText(/From your Sovereignty Diagnostic/)).toBeTruthy();
    expect(screen.getByText("Inheritance")).toBeTruthy();
    fireEvent.click(screen.getByText("Save and continue"));
    expect(onSave).toHaveBeenCalledWith("inheritance", "");
  });

  it("lets the client change a pre-filled answer", () => {
    render(
      <StepWealthEvent
        state={stateWith({ wealthEventType: "inheritance", wealthEventFromDiagnostic: true })}
        saving={false}
        onSave={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("Change"));
    expect(screen.getByText("What best describes your situation?")).toBeTruthy();
  });
});
