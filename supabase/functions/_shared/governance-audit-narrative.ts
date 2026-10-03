// Grounded narrative generation for the Quarterly Governance Audit, ported
// directly from the Review Agent prototype's narrative/generate.py and
// narrative/style_guide.md.
//
// Takes the already-computed figures from the calc/* port (drift scores,
// pillar totals, target/current Income-Equity split, terminal tax
// estimate, estate liquidity analysis, assumptions) and fills in the prose
// sections: executive summary, pillar analysis narratives, element
// deep-dive findings/corrective actions, and discussion points.
//
// The model is never given room to introduce new numbers -- it receives
// the computed data as JSON in the prompt and is instructed (via the
// house style guide, inlined below) to use only what's there. This
// follows the same "hand the model only the already-computed JSON,
// instruct it never to alter a figure" convention this codebase already
// established for stabilization-map-generate, via Gemini function-calling
// (a structured tool schema) rather than free-text JSON, matching this
// session's established convention over the prototype's own
// pydantic-structured-output mechanism.

import { generateVertexContent, type ServiceAccountKey, type VertexContent, GEMINI_FLASH_MODEL, withThinking } from "./vertex-ai.ts";

// Ported verbatim from narrative/style_guide.md.
export const STYLE_GUIDE = `# Prosperwise Sovereignty Governance Audit -- voice & terminology

Derived from a real finished audit (Lively-Lambert, July 2026). Match this register.

## Terminology (use these exact terms, capitalized as shown)

- **The Sovereign** -- the client. **The Family CFO** -- the advisor/reviewer, referred to in
  third person ("the Family CFO recommends...").
- **The Vineyard** -- the growth engine (equity holdings). **The Storehouse** / **The Keep** --
  the liquidity reserve. **The Armoury** -- the strategic reserve (insurance CSV, HELOC room).
  **The Granary** -- the philanthropic trust. **The Legacy Vault** -- terminal/estate assets.
  **The River** -- scheduled income/distribution flows (e.g. a PIP).
- "Structural drift", "systemic boundaries", "Charter Aligned", "Charter Baseline".

## Voice

- Address the client directly as "you"/"your" in the Executive Summary and Discussion Points;
  refer to accounts by number in parentheses.
- State dollar figures precisely and often, e.g. "$142,298.02", never rounded to "$142k".
- Confident and direct about what's true today; hedge only on genuine forward uncertainty
  (e.g. "approximately", "subject to market conditions") -- never hedge on figures that were
  actually computed.
- Findings are factual and diagnostic ("An operational execution drift occurred...");
  corrective actions are imperative ("Sweep the pending $X into...", "Rebalance...").
- Discussion Points are longer paragraphs that explain a specific structural tension and its
  consequence in plain language before naming a recommended remedy.

## Hard constraint

Every dollar figure, percentage, and account number used in generated prose MUST come from
the \`computed\` JSON supplied in the prompt. Never invent, round differently, or recompute a
number -- if a fact isn't in the provided data, omit it or phrase around it rather than
guessing.`;

const PROMPT_TEMPLATE = (styleGuide: string, computedJson: string) => `\
You are drafting prose sections of a Prosperwise "Sovereignty Governance Audit" for a client, \
in the house style described below. This is a DRAFT for the advisor's review before client \
delivery, not a final client-facing document -- it's fine to flag open questions.

# Style guide
${styleGuide}

# Computed data for this review (the ONLY source of truth for numbers/facts -- do not invent \
any figure, account number, or fact not present here)
${computedJson}

# What to produce
Call produce_audit_narrative with:
1. executive_summary_bullets: 5-10 bullets for the "Family CFO Clinical Note" opening summary \
-- lead with the most consequential findings (e.g. any estate deadlock, largest drift, largest \
tax exposure), grounded only in the computed data above.
2. pillar_narratives: one entry per pillar present in the computed data's pillar_totals, using \
the house terminology (Storehouse/Vineyard/Armoury/Granary/Legacy Vault) and citing exact \
dollar totals from the data.
3. element_narratives: for each element in scorecard_elements, write 1-4 audit_findings \
(factual, diagnostic) and 0-3 required_corrective_actions (imperative). For any element marked \
"PENDING ADVISOR REVIEW" in the input, do not fabricate findings -- instead write a single \
finding stating what data would be needed to score it, and no corrective actions.
4. discussion_points: 2-5 longer-form discussion points (title + paragraph body) covering the \
most structurally significant findings (deadlocks, large tax exposures, rebalancing needs, \
recommended actions) grounded in the computed data -- explain the tension and consequence \
before naming the remedy, per the style guide.`;

const NARRATIVE_TOOL_SCHEMA = {
  functionDeclarations: [
    {
      name: "produce_audit_narrative",
      description: "Produce the prose sections of a Sovereignty Governance Audit, grounded strictly in the supplied computed data.",
      parameters: {
        type: "OBJECT",
        properties: {
          executive_summary_bullets: { type: "ARRAY", items: { type: "STRING" } },
          pillar_narratives: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                pillar: { type: "STRING", description: "e.g. Vineyard, Keep, Armoury, Granary, Legacy Vault." },
                narrative: { type: "STRING" },
              },
              required: ["pillar", "narrative"],
            },
          },
          element_narratives: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                element_name: { type: "STRING" },
                audit_findings: { type: "ARRAY", items: { type: "STRING" } },
                required_corrective_actions: { type: "ARRAY", items: { type: "STRING" } },
              },
              required: ["element_name", "audit_findings", "required_corrective_actions"],
            },
          },
          discussion_points: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                body: { type: "STRING" },
              },
              required: ["title", "body"],
            },
          },
        },
        required: ["executive_summary_bullets", "pillar_narratives", "element_narratives", "discussion_points"],
      },
    },
  ],
};

export interface PillarNarrative {
  pillar: string;
  narrative: string;
}

export interface ElementNarrative {
  elementName: string;
  auditFindings: string[];
  requiredCorrectiveActions: string[];
}

export interface DiscussionPoint {
  title: string;
  body: string;
}

export interface NarrativeOutput {
  executiveSummaryBullets: string[];
  pillarNarratives: PillarNarrative[];
  elementNarratives: ElementNarrative[];
  discussionPoints: DiscussionPoint[];
}

export async function generateAuditNarrative(
  sa: ServiceAccountKey,
  computedData: Record<string, unknown>,
  scorecardElements: string[],
): Promise<NarrativeOutput> {
  const payload = { computed: computedData, scorecard_elements: scorecardElements };
  const prompt = PROMPT_TEMPLATE(STYLE_GUIDE, JSON.stringify(payload, null, 2));

  const contents: VertexContent[] = [{ role: "user", parts: [{ text: prompt }] }];
  const result = await generateVertexContent(
    sa,
    GEMINI_FLASH_MODEL,
    contents,
    withThinking(GEMINI_FLASH_MODEL, { temperature: 0.4, maxOutputTokens: 8192 }, "medium"),
    {
      tools: [NARRATIVE_TOOL_SCHEMA],
      toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["produce_audit_narrative"] } },
    },
  );

  // deno-lint-ignore no-explicit-any
  const parts = result?.candidates?.[0]?.content?.parts as any[] | undefined;
  const call = parts?.find((p) => p.functionCall)?.functionCall;
  if (!call || call.name !== "produce_audit_narrative") {
    throw new Error("Vertex did not return a structured narrative (no matching function call).");
  }
  // deno-lint-ignore no-explicit-any
  const args = (call.args ?? {}) as Record<string, any>;

  return {
    executiveSummaryBullets: Array.isArray(args.executive_summary_bullets) ? args.executive_summary_bullets : [],
    pillarNarratives: Array.isArray(args.pillar_narratives)
      ? args.pillar_narratives.map((p: { pillar: string; narrative: string }) => ({ pillar: p.pillar, narrative: p.narrative }))
      : [],
    elementNarratives: Array.isArray(args.element_narratives)
      ? args.element_narratives.map((e: { element_name: string; audit_findings?: string[]; required_corrective_actions?: string[] }) => ({
          elementName: e.element_name,
          auditFindings: e.audit_findings ?? [],
          requiredCorrectiveActions: e.required_corrective_actions ?? [],
        }))
      : [],
    discussionPoints: Array.isArray(args.discussion_points)
      ? args.discussion_points.map((d: { title: string; body: string }) => ({ title: d.title, body: d.body }))
      : [],
  };
}

/**
 * Defensive grounding check, not part of the prototype: extracts every
 * dollar figure the model actually wrote (e.g. "$142,298.02") and flags
 * any that don't appear -- in some numeric form -- anywhere in the
 * computed data supplied to the prompt. Mirrors this codebase's established
 * "never trust AI-generated numbers/identifiers blindly" principle (e.g.
 * daily-briefing-generate resolving links server-side rather than trusting
 * the model). Not a guarantee (a figure could coincidentally match without
 * being the *right* fact), but a cheap, real check the style guide's hard
 * constraint is actually being honored -- a future staff UI can surface
 * this as a review flag before a draft goes to a client.
 */
export function findUngroundedDollarFigures(narrative: NarrativeOutput, computedData: Record<string, unknown>): string[] {
  const groundedNumbers = new Set<string>();
  const collectNumbers = (value: unknown) => {
    if (typeof value === "number") {
      groundedNumbers.add(Math.abs(value).toFixed(2));
      groundedNumbers.add(String(Math.round(Math.abs(value))));
    } else if (typeof value === "string") {
      const n = Number(value.replace(/,/g, ""));
      if (!Number.isNaN(n) && value.trim() !== "") {
        groundedNumbers.add(Math.abs(n).toFixed(2));
        groundedNumbers.add(String(Math.round(Math.abs(n))));
      }
    } else if (Array.isArray(value)) {
      value.forEach(collectNumbers);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(collectNumbers);
    }
  };
  collectNumbers(computedData);

  const allText = [
    ...narrative.executiveSummaryBullets,
    ...narrative.pillarNarratives.map((p) => p.narrative),
    ...narrative.elementNarratives.flatMap((e) => [...e.auditFindings, ...e.requiredCorrectiveActions]),
    ...narrative.discussionPoints.map((d) => d.body),
  ].join("\n");

  const dollarFigureRe = /\$[\d,]+(?:\.\d{2})?/g;
  const ungrounded: string[] = [];
  for (const match of allText.matchAll(dollarFigureRe)) {
    const raw = match[0].replace(/[$,]/g, "");
    const n = Number(raw);
    if (Number.isNaN(n)) continue;
    const asDecimal = n.toFixed(2);
    const asInt = String(Math.round(n));
    if (!groundedNumbers.has(asDecimal) && !groundedNumbers.has(asInt)) {
      ungrounded.push(match[0]);
    }
  }
  return [...new Set(ungrounded)];
}

/** Mutates an AuditDocument-shaped object in place, merging generated prose into an already-computed structure. Mirrors the prototype's apply_narrative(). */
export function applyNarrative(
  doc: {
    executive_summary_bullets: string[];
    pillar_analyses: { pillar: string; narrative: string }[];
    element_deep_dives: { element_name: string; audit_findings: string[]; required_corrective_actions: string[] }[];
    discussion_points: DiscussionPoint[];
  },
  narrative: NarrativeOutput,
): void {
  doc.executive_summary_bullets = narrative.executiveSummaryBullets;

  const narrativeByPillar = new Map(narrative.pillarNarratives.map((p) => [p.pillar, p.narrative]));
  for (const pa of doc.pillar_analyses) {
    const n = narrativeByPillar.get(pa.pillar);
    if (n) pa.narrative = n;
  }

  const findingsByElement = new Map(narrative.elementNarratives.map((e) => [e.elementName, e]));
  for (const dd of doc.element_deep_dives) {
    const gen = findingsByElement.get(dd.element_name);
    if (gen) {
      dd.audit_findings = gen.auditFindings;
      dd.required_corrective_actions = gen.requiredCorrectiveActions;
    }
  }

  doc.discussion_points = narrative.discussionPoints;
}
