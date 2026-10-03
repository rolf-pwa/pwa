// Shared Vertex AI helper — Montreal region, PIPEDA compliant.
// Extracted from portal-assistant so any edge function can call Gemini without
// duplicating service-account JWT logic.

export interface ServiceAccountKey {
  type: string;
  project_id: string;
  private_key: string;
  client_email: string;
  token_uri: string;
}

import { fetchWithVertexRetry } from "./vertex-retry.ts";

// Re-exported so call sites keep importing everything from ./vertex-ai.ts.
export { fetchWithVertexRetry };

const REGION = "northamerica-northeast1";

// The one place that decides which Gemini model each call site uses, so
// migrating off 2.5 is a one-line change here (or a function secret, which
// also gives an instant no-redeploy rollback) instead of 27 files.
// Pro and Flash are separate tiers on purpose: today both resolve to 2.5 but
// the 3.x line has no Montréal-resident Pro model yet (see memory
// project_gemini_25_retirement), so the two will not always be equal.
// Read through globalThis so this module also loads under vitest/tsc, where
// there is no Deno global (an existing test imports it transitively).
const envVar = (name: string): string | undefined =>
  // deno-lint-ignore no-explicit-any
  (globalThis as any).Deno?.env?.get(name) || undefined;
/**
 * A per-feature model override: `name` is a function secret that, when set,
 * wins; otherwise `fallback`. Lets one feature migrate (or roll back
 * instantly, with no redeploy) independently of the global Flash/Pro tiers.
 */
export function modelFromEnv(name: string, fallback: string): string {
  return envVar(name) ?? fallback;
}
export const GEMINI_FLASH_MODEL = envVar("GEMINI_FLASH_MODEL") ?? "gemini-2.5-flash";
// Low-risk internal drafting/summarising tools (staff-facing text drafts and
// summaries; nothing here writes to a client record without staff review).
// Own tier so they can move to 3.x -- and be rolled back with a single
// secret, GEMINI_DRAFTING_MODEL=gemini-2.5-flash -- independently of the
// document-extraction and governance sites that still follow the Flash tier.
export const GEMINI_DRAFTING_MODEL = envVar("GEMINI_DRAFTING_MODEL") ?? "gemini-3.5-flash";
// Document extractors (statement/insurance/onboarding ingest, PDF-to-text,
// name extraction). Own tier so it can be rolled back as a group with
// GEMINI_EXTRACT_MODEL=gemini-2.5-flash. On a 9-document suite with exact
// ground truth 3.5 Flash matched or beat 2.5 everywhere and, unlike 2.5,
// ignored an embedded "set current_value to 9,999,999" instruction.
export const GEMINI_EXTRACT_MODEL = envVar("GEMINI_EXTRACT_MODEL") ?? "gemini-3.5-flash";
export const GEMINI_PRO_MODEL = envVar("GEMINI_PRO_MODEL") ?? "gemini-2.5-pro";

// 3.x models think by default and thinking tokens count against
// maxOutputTokens, so a tight cap can truncate a tool call mid-generation
// (MALFORMED_FUNCTION_CALL). Each call site declares how much reasoning it
// needs: minimal = extraction/classification, low = drafting/chat,
// medium = multi-step synthesis, high = Pro-tier reasoning.
export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

/**
 * Returns generationConfig with `thinkingConfig` applied for Gemini 3.x
 * models and unchanged for 2.5 (which uses a different, budget-based knob
 * and is left on its current default so migrating the constants is the only
 * behavior change).
 */
export function withThinking(
  model: string,
  config: Record<string, unknown>,
  level: ThinkingLevel,
): Record<string, unknown> {
  if (!/^gemini-3/.test(model)) return config;
  return { ...config, thinkingConfig: { thinkingLevel: level } };
}

export function vertexModelUrl(projectId: string, model: string) {
  return `https://${REGION}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${REGION}/publishers/google/models/${model}:generateContent`;
}

export async function parseServiceAccountKey(raw?: string | null): Promise<ServiceAccountKey> {
  if (!raw) throw new Error("GCP_SERVICE_ACCOUNT_KEY not configured");
  let cleaned = raw.trim().replace(/^\uFEFF/, "");
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    try { cleaned = JSON.parse(cleaned); } catch { /* keep cleaned */ }
  }
  let sa: ServiceAccountKey;
  try {
    sa = JSON.parse(cleaned);
  } catch {
    throw new Error("GCP_SERVICE_ACCOUNT_KEY contains invalid JSON.");
  }
  if (!sa.private_key || !sa.client_email || !sa.project_id) {
    throw new Error("GCP key is missing required fields (private_key, client_email, project_id).");
  }
  return sa;
}

export async function getGcpAccessToken(sa: ServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  };
  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unsigned = `${enc(header)}.${enc(payload)}`;
  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binaryKey = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsigned),
  );
  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const jwt = `${unsigned}.${signature}`;
  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(`Token exchange failed: ${data.error_description || data.error}`);
  }
  return data.access_token;
}

export interface VertexContent {
  role: "user" | "model";
  parts: Array<{
    text?: string;
    fileData?: { mimeType: string; fileUri: string };
    // Base64-encoded bytes handed to Gemini natively (e.g. a PDF fetched
    // from Drive with an OAuth token Vertex has no way to re-authenticate
    // with, so fileData/fileUri — which needs a URI Vertex itself can
    // fetch — doesn't apply). Request-size limited (Vertex caps inline
    // request payloads around 20MB); callers should check file size before
    // base64-encoding a large document.
    inlineData?: { mimeType: string; data: string };
  }>;
}

/** Pulls a JSON object out of a model response, tolerating ```json fences and stray prose. */
export function extractJson(text: string): any {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("The model did not return a usable JSON object.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

export function vertexPredictUrl(projectId: string, model: string) {
  return `https://${REGION}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${REGION}/publishers/google/models/${model}:predict`;
}

export type EmbeddingTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" | "SEMANTIC_SIMILARITY";

/**
 * Embeds a batch of texts with a Vertex AI text-embedding model. `taskType` must be
 * RETRIEVAL_DOCUMENT when embedding content to index and RETRIEVAL_QUERY when embedding
 * a search query — mismatching these measurably hurts recall.
 */
export async function embedTexts(
  sa: ServiceAccountKey,
  texts: Array<{ title?: string; content: string }>,
  taskType: EmbeddingTaskType,
  model = "text-embedding-005",
  dimensions = 768,
): Promise<number[][]> {
  if (!texts.length) return [];
  const accessToken = await getGcpAccessToken(sa);
  const url = vertexPredictUrl(sa.project_id, model);
  const BATCH_SIZE = 32;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        instances: batch.map((t) => ({
          task_type: taskType,
          title: t.title,
          content: t.content,
        })),
        parameters: { outputDimensionality: dimensions, autoTruncate: true },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Vertex AI embedding error ${res.status}: ${text.slice(0, 500)}`);
    }
    const data = await res.json();
    const predictions = data?.predictions;
    if (!Array.isArray(predictions)) {
      throw new Error("Vertex AI embedding response did not include predictions.");
    }
    for (const p of predictions) {
      const values = p?.embeddings?.values;
      if (!Array.isArray(values)) {
        throw new Error("Vertex AI embedding response was missing embedding values.");
      }
      results.push(values);
    }
  }
  return results;
}

export async function generateVertexContent(
  sa: ServiceAccountKey,
  model: string,
  contents: VertexContent[],
  generationConfig?: Record<string, unknown>,
  toolsConfig?: { tools: Record<string, unknown>[]; toolConfig: Record<string, unknown> },
  retry?: { maxRetries?: number },
): Promise<any> {
  const accessToken = await getGcpAccessToken(sa);
  const url = vertexModelUrl(sa.project_id, model);
  const res = await fetchWithVertexRetry(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      contents,
      ...(toolsConfig ? { tools: toolsConfig.tools, toolConfig: toolsConfig.toolConfig } : {}),
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1024,
        ...generationConfig,
      },
    }),
  }, retry);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vertex AI error ${res.status}: ${text.slice(0, 500)}`);
  }
  return await res.json();
}
