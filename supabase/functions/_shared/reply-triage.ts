// reply-triage.ts: reads a client's reply to one of Georgia's emails and says what kind of reply it is. Used by the
// onboarding and review-window agents. The model sees the reply with names, amounts and contact details removed. If it
// fails or is unsure the caller treats the reply as needing a person.

import { scrubText } from "./pii-scrub.ts";
import { GEMINI_EXTRACT_MODEL, extractJson, generateVertexContent, parseServiceAccountKey, withThinking } from "./vertex-ai.ts";
import { classifierPrompt, parseClassification, type ReplyIntent } from "./onboarding-replies.ts";

export async function triageReply(text: string, names: string[]): Promise<{ intent: ReplyIntent; summary: string; failed: string | null }> {
  try {
    const sa = await parseServiceAccountKey(Deno.env.get("GCP_SERVICE_ACCOUNT_KEY"));
    const out = await generateVertexContent(
      sa, GEMINI_EXTRACT_MODEL,
      [{ role: "user", parts: [{ text: classifierPrompt(scrubText(text, { names })) }] }],
      withThinking(GEMINI_EXTRACT_MODEL, { temperature: 0, maxOutputTokens: 512 }, "low"),
    );
    // deno-lint-ignore no-explicit-any
    const raw = (out.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
    const parsed = parseClassification(extractJson(raw));
    return { ...parsed, failed: null };
  } catch (e) {
    return { intent: "other", summary: "", failed: e instanceof Error ? e.message : String(e) };
  }
}
