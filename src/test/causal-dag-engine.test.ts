import { describe, expect, it } from "vitest";
import {
  compareInterventions, evaluate, topologicalOrder, weighted, type CausalModel,
} from "../../supabase/functions/_shared/causal-dag-engine";
import { CAUSAL_MODEL_V2, evidenceFromOntology, V2_INTERVENTIONS } from "../../supabase/functions/_shared/causal-model-v2";

const node = (id: string, parents: string[] = []) => ({
  id, label: id, parents, equation: () => 0.5, explain: () => "",
});

describe("engine", () => {
  it("orders parents before children", () => {
    const order = topologicalOrder({ nodes: [node("c", ["b"]), node("b", ["a"]), node("a")] }).map((n) => n.id);
    expect(order).toEqual(["a", "b", "c"]);
  });
  it("rejects cycles, unknown parents and duplicate ids", () => {
    expect(() => topologicalOrder({ nodes: [node("a", ["b"]), node("b", ["a"])] })).toThrow(/Cycle/);
    expect(() => topologicalOrder({ nodes: [node("a", ["zzz"])] })).toThrow(/Unknown parent/);
    expect(() => topologicalOrder({ nodes: [node("a"), node("a")] })).toThrow(/Duplicate/);
  });
  it("weighted() renormalises over present inputs and refuses low coverage", () => {
    expect(weighted({ a: 1, b: undefined }, [["a", 0.7], ["b", 0.3]])).toBe(1);
    expect(weighted({ a: undefined, b: 1 }, [["a", 0.7], ["b", 0.3]])).toBeUndefined();
  });
  it("do() cuts incoming edges: an intervened node ignores its parents", () => {
    const m: CausalModel = {
      nodes: [
        { id: "x", label: "x", parents: [], equation: () => undefined, explain: () => "" },
        { id: "y", label: "y", parents: ["x"], equation: (p) => p.x, explain: () => "from x", isRisk: true },
      ],
    };
    expect(evaluate(m, { x: 0.9 }).values.y).toBe(0.9);
    const r = evaluate(m, { x: 0.9 }, { y: 0.1 });
    expect(r.values.y).toBe(0.1);
    expect(r.steps.find((s) => s.node === "y")?.intervened).toBe(true);
    expect(() => evaluate(m, {}, { nope: 1 })).toThrow(/unknown node/);
  });
});

describe("V2 model", () => {
  it("is a valid DAG", () => {
    expect(() => topologicalOrder(CAUSAL_MODEL_V2)).not.toThrow();
  });
  const payload = {
    financial_state: { liquid_capital_cad: 600_000, monthly_burn_rate_cad: 20_000 },
    relational_state: { begging_hand_pressure_index: "Critical" as const, spousal_alignment_score: 4 },
    emotional_state: { guilt_survivor_index: 9 },
  };
  it("scores liquidity risk from evidence and explains each step", () => {
    const ev = evaluate(CAUSAL_MODEL_V2, evidenceFromOntology(payload));
    expect(ev.values.liquidity_depletion_risk).toBeGreaterThan(0.5);
    expect(ev.steps.map((s) => s.node)).toContain("say_no_difficulty");
    expect(ev.steps.every((s) => s.because.length > 0)).toBe(true);
  });
  it("a 90-day capital freeze lowers liquidity risk (and leaves unrelated risks alone)", () => {
    const [res] = compareInterventions(CAUSAL_MODEL_V2, evidenceFromOntology(payload), V2_INTERVENTIONS);
    const liq = res.effects.find((e) => e.risk === "liquidity_depletion_risk")!;
    expect(liq.after).toBeLessThan(liq.before);
    expect(liq.delta).toBeLessThan(0);
    expect(res.effects.find((e) => e.risk === "founder_identity_risk")).toBeUndefined(); // no business-exit evidence
  });
  it("gives no score when evidence is insufficient", () => {
    const ev = evaluate(CAUSAL_MODEL_V2, evidenceFromOntology({}));
    expect(ev.values.liquidity_depletion_risk).toBeUndefined();
    expect(ev.values.founder_identity_risk).toBeUndefined();
  });
  it("scores founder identity risk for a business exit", () => {
    const ev = evaluate(CAUSAL_MODEL_V2, evidenceFromOntology({
      event_spoke_type: "business_exit",
      event_spoke_data: { identity_detachment_score: 2, need_for_control_score: 8, daily_purpose_void_score: 9 },
    }));
    expect(ev.values.founder_identity_risk).toBeGreaterThan(0.7);
  });
});
