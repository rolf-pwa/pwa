// causal-dag-engine.ts — a small deterministic structural causal model (SCM)
// engine: nodes with structural equations over a DAG, evaluated in
// topological order, with Pearl-style do() interventions (an intervened node
// ignores its own equation and its incoming edges are cut) so "what if we
// froze capital for 90 days?" is answered by re-evaluating the same graph.
//
// Pure: no LLM, no I/O. This is NOT probabilistic inference. There are no
// noise terms, so counterfactuals are exact re-evaluations, and node values
// are 0..1 index scores (displayed as 0-100), not calibrated probabilities.
// The numbers are only as good as the equations in the model that uses this
// engine -- see causal-model-v2.ts for who owns those.
//
// Missing data never produces a number: a node whose required inputs are
// missing is `undefined` ("not enough information"), matching the
// discipline of the existing causal-dag-evaluator.ts rule registry.

export type NodeValue = number | undefined;

export interface CausalNode {
  id: string;
  label: string;
  /** Upstream node ids; these are the DAG's edges (parent -> this). */
  parents: string[];
  /** Structural equation. Return undefined when inputs are insufficient. */
  equation: (parents: Record<string, NodeValue>) => NodeValue;
  /** Plain-English "because" for a computed value, for Glass-Box reasoning chains. */
  explain: (value: number, parents: Record<string, NodeValue>) => string;
  /** Risk nodes are the outputs interventions are scored against. */
  isRisk?: boolean;
}

export interface CausalModel {
  nodes: CausalNode[];
}

export interface ReasoningStep {
  node: string;
  label: string;
  value: number;
  because: string;
  intervened?: boolean;
}

export interface Evaluation {
  values: Record<string, NodeValue>;
  steps: ReasoningStep[];
}

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Weighted mean of the available parents; undefined if less than minCoverage of the weight is present. */
export function weighted(
  parents: Record<string, NodeValue>,
  inputs: Array<[id: string, weight: number]>,
  minCoverage = 0.6,
): NodeValue {
  const total = inputs.reduce((s, [, w]) => s + w, 0);
  let have = 0;
  let sum = 0;
  for (const [id, w] of inputs) {
    const v = parents[id];
    if (v !== undefined) { have += w; sum += w * v; }
  }
  if (have === 0 || have / total < minCoverage) return undefined;
  return clamp01(sum / have);
}

/** Topological order; throws on an unknown parent or a cycle (the graph must be a DAG). */
export function topologicalOrder(model: CausalModel): CausalNode[] {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  if (byId.size !== model.nodes.length) throw new Error("Duplicate node id in causal model");
  const state = new Map<string, 1 | 2>(); // 1 = visiting, 2 = done
  const order: CausalNode[] = [];
  const visit = (id: string, path: string[]) => {
    const node = byId.get(id);
    if (!node) throw new Error(`Unknown parent node "${id}"`);
    const s = state.get(id);
    if (s === 2) return;
    if (s === 1) throw new Error(`Cycle in causal model: ${[...path, id].join(" -> ")}`);
    state.set(id, 1);
    for (const p of node.parents) visit(p, [...path, id]);
    state.set(id, 2);
    order.push(node);
  };
  for (const n of model.nodes) visit(n.id, []);
  return order;
}

/**
 * Evaluate the model. `evidence` supplies values for root nodes (nodes with
 * no parents); `doValues` are do() interventions on any node.
 */
export function evaluate(
  model: CausalModel,
  evidence: Record<string, NodeValue>,
  doValues: Record<string, number> = {},
): Evaluation {
  const order = topologicalOrder(model);
  for (const id of Object.keys(doValues)) {
    if (!order.some((n) => n.id === id)) throw new Error(`Cannot intervene on unknown node "${id}"`);
  }
  const values: Record<string, NodeValue> = {};
  const steps: ReasoningStep[] = [];
  for (const node of order) {
    if (node.id in doValues) {
      const v = clamp01(doValues[node.id]);
      values[node.id] = v;
      steps.push({ node: node.id, label: node.label, value: v, intervened: true,
        because: `Set directly to ${Math.round(v * 100)} by the intervention (its normal causes are ignored).` });
      continue;
    }
    if (node.parents.length === 0) {
      values[node.id] = evidence[node.id] === undefined ? undefined : clamp01(evidence[node.id] as number);
      continue; // evidence nodes are inputs, not reasoning steps
    }
    const parentVals: Record<string, NodeValue> = {};
    for (const p of node.parents) parentVals[p] = values[p];
    const v = node.equation(parentVals);
    values[node.id] = v === undefined ? undefined : clamp01(v);
    if (values[node.id] !== undefined) {
      steps.push({ node: node.id, label: node.label, value: values[node.id] as number,
        because: node.explain(values[node.id] as number, parentVals) });
    }
  }
  return { values, steps };
}

export interface InterventionSpec {
  id: string;
  label: string;
  do: Record<string, number>;
}

export interface InterventionResult {
  intervention_id: string;
  label: string;
  /** Per risk node: score before and after, on a 0-100 scale. Only risks defined in both runs. */
  effects: Array<{ risk: string; label: string; before: number; after: number; delta: number }>;
}

export function compareInterventions(
  model: CausalModel,
  evidence: Record<string, NodeValue>,
  interventions: InterventionSpec[],
): InterventionResult[] {
  const base = evaluate(model, evidence);
  return interventions.map((iv) => {
    const after = evaluate(model, evidence, iv.do);
    const effects: InterventionResult["effects"] = [];
    for (const node of model.nodes.filter((n) => n.isRisk)) {
      const b = base.values[node.id];
      const a = after.values[node.id];
      if (b === undefined || a === undefined) continue;
      effects.push({
        risk: node.id, label: node.label,
        before: Math.round(b * 100), after: Math.round(a * 100), delta: Math.round((a - b) * 100),
      });
    }
    return { intervention_id: iv.id, label: iv.label, effects };
  });
}
