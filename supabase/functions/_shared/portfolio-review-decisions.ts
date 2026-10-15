// portfolio-review-decisions.ts: a client's response to the proposal on their published Portfolio Review (authorize some items, or talk it
// through first). Records the exact wording shown and hands the work to Rolf. Nothing here changes a portfolio.

// deno-lint-ignore-file no-explicit-any
import { REVIEW_AUTHORIZE_STATEMENT, REVIEW_AUTHORIZE_STATEMENT_VERSION, checkAuthorization, type ProposalItem } from "./portfolio-review-client.ts";

const ADULT_ROLES = ["head_of_household", "head_of_family", "spouse"];
const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const describe = (i: ProposalItem) => i.kind === "switch"
  ? `${i.label}${i.owner ? ` (${i.owner})` : ""}: switch about ${money(i.amount)} ${i.direction === "to_income" ? "from equity into income funds" : "from income into equity funds"}${i.taxable ? " [TAXABLE: check the gain first]" : ""}`
  : `${i.label}${i.owner ? ` (${i.owner})` : ""}: reset the death benefit guarantee from ${money(i.currentGuarantee)} to about ${money(i.newGuarantee)}`;

export async function recordReviewDecision(db: any, me: any, body: any, meta: { ip: string | null; ua: string | null; today: string; assigneeEmail: string }): Promise<{ status: number; body: Record<string, unknown> }> {
  const action = body?.action as "review_authorize" | "review_talk_first";
  if (!me?.household_id || me.is_minor || !ADULT_ROLES.includes(String(me.family_role ?? ""))) return { status: 403, body: { error: "Not available" } };
  const { data: pub } = await db.from("portfolio_review_publications").select("id, household_id, view").eq("id", String(body?.publication_id ?? "")).eq("household_id", me.household_id).is("unpublished_at", null).maybeSingle();
  if (!pub) return { status: 404, body: { error: "This review is no longer available." } };
  const { data: prior } = await db.from("portfolio_review_decisions").select("decision, item_ids").eq("publication_id", pub.id);
  const already = (prior ?? []).filter((d: any) => d.decision === "authorized").flatMap((d: any) => d.item_ids ?? []);
  const name = `${me.first_name ?? ""} ${me.last_name ?? ""}`.trim() || "A client";
  const household = pub.view?.householdLabel ?? "Household";
  const { data: rolf } = await db.from("profiles").select("user_id").eq("email", meta.assigneeEmail).maybeSingle();
  const task = async (title: string, description: string, days: number) => {
    if (!rolf?.user_id) return;
    await db.from("pm_tasks").insert({ title, description, status: "open", client_visible: false, assignee_id: rolf.user_id, created_by: rolf.user_id, family_id: me.family_id, household_id: me.household_id, contact_id: me.id, due_date: addDays(meta.today, days) });
  };

  if (action === "review_authorize") {
    const check = checkAuthorization(pub.view, already, Array.isArray(body?.item_ids) ? body.item_ids.map(String) : []);
    if (!check.ok) return { status: 400, body: { error: check.error } };
    const { error } = await db.from("portfolio_review_decisions").insert({
      publication_id: pub.id, household_id: me.household_id, contact_id: me.id, decision: "authorized", item_ids: check.items.map((i) => i.id), items: check.items,
      statement_version: REVIEW_AUTHORIZE_STATEMENT_VERSION, statement_text: REVIEW_AUTHORIZE_STATEMENT, ip: meta.ip, user_agent: meta.ua,
    });
    if (error) return { status: 500, body: { error: "Could not record that. Please try again." } };
    await task(`Carry out: ${household} authorized ${check.items.length} change${check.items.length === 1 ? "" : "s"}`, `${name} authorized these in the portal on ${meta.today}:\n\n${check.items.map((i) => `- ${describe(i)}`).join("\n")}\n\nConfirm the amounts with them first (they move with markets), do the switches and resets on the iA advisor site, then close this task. The authorization, with the exact wording they agreed to, is stored with the review.`, 3);
    await db.from("staff_notifications").insert({ title: `${household} authorized ${check.items.length} change${check.items.length === 1 ? "" : "s"}`, body: `${name} authorized changes on their Portfolio Review.`, link: `/households/${me.household_id}/portfolio-review`, contact_id: me.id, source_type: "portfolio_review" });
    await db.from("review_agent_events").insert({ family_id: me.family_id, mode: "live", kind: "portfolio_review_authorized", detail: { by: name, household_id: me.household_id, items: check.items.map((i) => i.id) } });
    return { status: 200, body: { ok: true, authorized: check.items.length } };
  }

  // review_talk_first
  const { error } = await db.from("portfolio_review_decisions").insert({ publication_id: pub.id, household_id: me.household_id, contact_id: me.id, decision: "talk_first", item_ids: [], items: [], ip: meta.ip, user_agent: meta.ua });
  if (error) return { status: 500, body: { error: "Could not record that. Please try again." } };
  await task(`${household} wants to talk through their Portfolio Review`, `${name} asked to talk through the proposal on their Portfolio Review before authorizing anything. They are booking a meeting; if it is not on your calendar, call them.`, 2);
  await db.from("staff_notifications").insert({ title: `${household} wants to talk it through`, body: `${name} asked to talk through the proposal on their Portfolio Review.`, link: `/households/${me.household_id}/portfolio-review`, contact_id: me.id, source_type: "portfolio_review" });
  await db.from("review_agent_events").insert({ family_id: me.family_id, mode: "live", kind: "portfolio_review_talk_first", detail: { by: name, household_id: me.household_id } });
  return { status: 200, body: { ok: true } };
}
