import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EVENT_SLUGS, parseEntryParams, sanitizeSource } from "@/modules/intake/lib/entry-params";
import { TRANSITION_CATALYSTS } from "@/modules/intake/lib/derive";
import { Georgia2Provider, useGeorgia2 } from "@/modules/intake/components/georgia2/state";

function Probe() {
  const { state } = useGeorgia2();
  return (
    <span data-testid="s">
      {JSON.stringify({ step: state.step, catalyst: state.catalyst, domain: state.domain, source: state.source })}
    </span>
  );
}
const load = (search: string) => {
  window.history.pushState({}, "", `/discovery-v2/embed${search}`);
  render(
    <Georgia2Provider>
      <Probe />
    </Georgia2Provider>
  );
  return JSON.parse(screen.getByTestId("s").textContent!);
};

afterEach(() => window.history.pushState({}, "", "/"));

describe("parseEntryParams", () => {
  it("maps every documented event slug, and every tile is reachable", () => {
    const reached = new Set(Object.values(EVENT_SLUGS));
    for (const c of TRANSITION_CATALYSTS) expect(reached.has(c), c).toBe(true);
    expect(parseEntryParams("?event=inheritance").catalyst).toBe("inheritance");
    expect(parseEntryParams("?event=business-exit").catalyst).toBe("founder_exit");
    expect(parseEntryParams("?event=Executive-Retirement").catalyst).toBe("executive_exit");
    expect(parseEntryParams("?event=windfall").catalyst).toBe("sudden_windfall");
  });

  it("ignores unknown events and works with no params", () => {
    expect(parseEntryParams("?event=nonsense").catalyst).toBeNull();
    expect(parseEntryParams("").catalyst).toBeNull();
    expect(parseEntryParams("").source).toBeNull();
  });

  it("sanitizes the source and falls back to utm_source", () => {
    expect(parseEntryParams("?source=Inheritance-Page").source).toBe("inheritance-page");
    expect(parseEntryParams("?utm_source=newsletter").source).toBe("newsletter");
    expect(parseEntryParams("?source=a&utm_source=b").source).toBe("a");
    expect(sanitizeSource("<script>alert(1)</script>")).toBeNull();
    expect(sanitizeSource("has space")).toBeNull();
    expect(sanitizeSource("x".repeat(65))).toBeNull();
    expect(sanitizeSource("ok_1.2-3")).toBe("ok_1.2-3");
  });
});

describe("Georgia2Provider entry links", () => {
  it("opens on question 2 with the transition chosen and the source recorded", () => {
    expect(load("?event=inheritance&source=inheritance-page")).toEqual({
      step: 2,
      catalyst: "inheritance",
      domain: "personal",
      source: "inheritance-page",
    });
  });

  it("derives the corporate domain for a business event", () => {
    expect(load("?event=pre-exit-growth").domain).toBe("corporate");
  });

  it("starts normally at the transition question when the event is missing or invalid", () => {
    expect(load("")).toEqual({ step: 1, catalyst: null, domain: null, source: null });
  });

  it("records a source without skipping the transition question", () => {
    expect(load("?source=footer-link")).toMatchObject({ step: 1, catalyst: null, source: "footer-link" });
  });
});
