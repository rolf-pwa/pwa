import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { Georgia2Provider, useGeorgia2 } from "@/modules/intake/components/georgia2/state";
import { StepFreeform } from "@/modules/intake/components/georgia2/StepFreeform";
import { StepEmergency } from "@/modules/intake/components/georgia2/StepEmergency";

function Probe() {
  const { state } = useGeorgia2();
  return (
    <div>
      <span data-testid="step">{state.step}</span>
      <span data-testid="result">{state.freeformResult ? JSON.stringify(state.freeformResult) : "none"}</span>
    </div>
  );
}

function Arrange({ children, step = 2 }: { children: React.ReactNode; step?: 1 | 2 | 3 | 4 | 5 }) {
  const { dispatch } = useGeorgia2();
  useEffect(() => {
    dispatch({ type: "set_catalyst", catalyst: "inheritance" });
    dispatch({ type: "set_step", step });
  }, [dispatch, step]);
  return <>{children}</>;
}

const mockFetch = (handler: (url: string, body: any) => unknown) => {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : {};
    return new Response(JSON.stringify(handler(String(url), body)), { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
};

afterEach(() => vi.unstubAllGlobals());

describe("StepFreeform", () => {
  it("skips straight to the gate with no text and never calls the analyzer", async () => {
    const fetchFn = mockFetch(() => ({}));
    render(
      <Georgia2Provider>
        <Arrange>
          <Probe />
          <StepFreeform />
        </Arrange>
      </Georgia2Provider>
    );
    fireEvent.click(screen.getByText("Skip"));
    await waitFor(() => expect(screen.getByTestId("step").textContent).toBe("3"));
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("continues to the gate on a benign answer and keeps the extraction", async () => {
    mockFetch(() => ({ ok: true, threat_detected: false, extraction: { emotional_state: "guilt", primary_friction: "internal_paralysis" } }));
    render(
      <Georgia2Provider>
        <Arrange>
          <Probe />
          <StepFreeform />
        </Arrange>
      </Georgia2Provider>
    );
    fireEvent.change(screen.getByLabelText("Anything else weighing on you"), { target: { value: "I feel guilty spending it." } });
    fireEvent.click(screen.getByText("Continue"));
    await waitFor(() => expect(screen.getByTestId("step").textContent).toBe("3"));
    expect(screen.getByTestId("result").textContent).toContain("guilt");
  });

  it("moves to the safety screen when the analyzer flags the text", async () => {
    mockFetch(() => ({ ok: true, threat_detected: true, threat_source: "keywords" }));
    render(
      <Georgia2Provider>
        <Arrange>
          <Probe />
          <StepFreeform />
        </Arrange>
      </Georgia2Provider>
    );
    fireEvent.change(screen.getByLabelText("Anything else weighing on you"), { target: { value: "He threatened me." } });
    fireEvent.click(screen.getByText("Continue"));
    await waitFor(() => expect(screen.getByTestId("step").textContent).toBe("5"));
  });

  it("asks the visitor to remove sensitive details instead of proceeding", async () => {
    mockFetch(() => ({ ok: false, pii: true }));
    render(
      <Georgia2Provider>
        <Arrange>
          <Probe />
          <StepFreeform />
        </Arrange>
      </Georgia2Provider>
    );
    fireEvent.change(screen.getByLabelText("Anything else weighing on you"), { target: { value: "my sin is 123-456-789" } });
    fireEvent.click(screen.getByText("Continue"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("account number"));
    expect(screen.getByTestId("step").textContent).toBe("2");
  });

  it("carries on normally if the analyzer is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    render(
      <Georgia2Provider>
        <Arrange>
          <Probe />
          <StepFreeform />
        </Arrange>
      </Georgia2Provider>
    );
    fireEvent.change(screen.getByLabelText("Anything else weighing on you"), { target: { value: "It's a lot." } });
    fireEvent.click(screen.getByText("Continue"));
    await waitFor(() => expect(screen.getByTestId("step").textContent).toBe("3"));
  });
});

describe("StepEmergency", () => {
  it("shows reassurance and the Clarity Call page, with no emergency numbers or callback form", () => {
    render(
      <Georgia2Provider>
        <Arrange step={5}>
          <StepEmergency />
        </Arrange>
      </Georgia2Provider>
    );
    expect(screen.getByText(/Nothing about your finances needs to be decided or moved today/)).toBeTruthy();
    const link = screen.getByText("Book a Clarity Call").closest("a");
    expect(link?.getAttribute("href")).toBe("https://www.prosperwise.ca/clarity-call");
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/911|9-8-8|988/);
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByText(/reach out/i)).toBeNull();
  });

  it("lets the visitor return to the regular diagnostic", async () => {
    render(
      <Georgia2Provider>
        <Arrange step={5}>
          <Probe />
          <StepEmergency />
        </Arrange>
      </Georgia2Provider>
    );
    fireEvent.click(screen.getByText(/This isn't urgent/));
    await waitFor(() => expect(screen.getByTestId("step").textContent).toBe("3"));
  });
});
