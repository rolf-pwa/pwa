// georgia-rules-core.ts: the pure parts of Georgia's rulebook (no network, no Deno), so they can be tested.

/** What she does without being asked, so it can be listed and reviewed. */
export const AUTONOMOUS_KINDS = ["notice_handled", "notice_flagged", "text_replied", "text_flagged", "emails_filed", "emails_unfiled", "texts_marked_read", "calendar_accepted", "calendar_flagged"];

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** True when two rule wordings say the same thing closely enough not to be suggested twice. */
export function sameRule(a: string, b: string): boolean {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}
/** Rules that would move money, delete, or reach out in a new way are never suggested. */
export const UNSAFE_RULE = /\b(withdraw\w*|transfer\w*|wire\w*|pay\w*|delet\w*|remov\w* all|trad(?:e|es|ing)|buy\w*|sell\w*|redeem\w*|send (?:an )?email to (?:the )?client)\b/i;

export const SUGGEST_TOOL = {
  name: "suggest_rules",
  description: "List standing rules Rolf has effectively already set by giving the same answer to the same kind of question more than once.",
  parameters: {
    type: "OBJECT",
    properties: {
      rules: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            rule: { type: "STRING", description: "An instruction to Georgia, one sentence, specific, e.g. 'When an iA acknowledgement arrives for a client, log it on their task and do not ask me.'" },
            area: { type: "STRING", description: "email, texts, calendar, tasks, notices or general" },
            times: { type: "INTEGER", description: "How many separate times he gave this answer" },
            evidence: { type: "STRING", description: "One short sentence: what she asked and what he said." },
          },
          required: ["rule", "times", "evidence"],
        },
      },
    },
    required: ["rules"],
  },
};
