// review-agent-admin: staff-only window onto Georgia's review windows (its tables are service-role only).
//   overview          mode, limits, every obligation with its family, and the latest events
//   setMode           off | shadow | live (live needs confirm: true and restarts `since`, so only later windows are managed)
//   setPaused         pause or resume one obligation
//   supportOverview   Ask Georgia: Rolf's away dates and the recent client conversations, flagged ones first
//   supportReview     mark a conversation reviewed
//   supportReply      Rolf writes in a client's thread; Georgia then holds her answers there; the client is told in-app
//   supportHandBack   Georgia answers in that thread again
//   setAway           set or clear the dates clients are told Rolf is away

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { latestModels, portfolioPackFor } from "../_shared/portfolio-review-data.ts";
import { inviteesOf, pacificDate, type FamilyContact } from "../_shared/review-windows.ts";
import { storableMessages } from "../_shared/support-context.ts";
import { MODEL_PROMPT, validateModels } from "../_shared/ia-model-parse.ts";
import { isPooledFamily } from "../_shared/review-units.ts";
import { buildClientProposal, buildClientView, describeAuthorizedItem, narrativeParagraphs, portfolioReviewReadyEmail, type ClientIncludes } from "../_shared/portfolio-review-client.ts";
import { attachItem, buildPackage, createFile, listFiles, removeItem } from "../_shared/insurance-file-service.ts";
import { ffCompile, ffGet, ffSave, ffSend } from "../_shared/fact-find-service.ts";
import { rCompile, rGet, rSave, rSend } from "../_shared/replacement-service.ts";
import { fileComparison } from "../_shared/quote-service.ts";
import { adults, fileNeedsAnalysis, finalizeDoc, listDocs, previewDoc, sendDoc, voidDoc } from "../_shared/insurance-doc-service.ts";
import { planVaultCatchUp } from "../_shared/vault-catchup.ts";
import { ensurePersonalDrawers, provisionClientFolderTree } from "../_shared/vault-provisioning.ts";
import { getServiceGoogleAccessToken } from "../_shared/google-token.ts";
import { packReadiness } from "../_shared/pack-readiness.ts";
import { sendServiceEmailDetailed } from "../_shared/service-email.ts";
import { AGENT_SENDER, PORTAL_URL } from "../_shared/onboarding-agent.ts";
import { GEMINI_EXTRACT_MODEL, extractJson, generateVertexContent, parseServiceAccountKey, withThinking } from "../_shared/vertex-ai.ts";

const ALLOWED_ORIGINS = [
  "https://prosperwise-portal.web.app",
  "https://prosperwise.lovable.app",
  "https://app.prosperwise.ca",
  "https://id-preview--339dfc8f-3e82-4b05-8a36-a9f66fc58449.lovable.app",
];
function cors(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".lovable.app") || origin.endsWith(".lovableproject.com") ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-region",
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function requireStaff(req: Request): Promise<{ userId: string; email: string } | null> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data } = await userClient.auth.getUser();
  if (!data?.user?.email?.endsWith("@prosperwise.ca")) return null;
  return { userId: data.user.id, email: data.user.email };
}

/** Set when nobody in the unit has an email Georgia can use, so a publish tells Rolf before she hands the family back to him. */
async function noInviteeWarning(db: any, familyId: string, householdId: string | null): Promise<string | undefined> {
  const q = db.from("contacts").select("id, first_name, last_name, email, family_role, is_minor, household_id, no_automated_email");
  const { data } = await (householdId ? q.eq("household_id", householdId) : q.eq("family_id", familyId));
  const people: FamilyContact[] = (data ?? []).map((p: any) => ({ id: p.id, firstName: p.first_name, lastName: p.last_name, email: p.email, role: p.family_role, isMinor: p.is_minor, householdId: p.household_id, noAutoEmail: p.no_automated_email }));
  return inviteesOf(people, !!householdId).length ? undefined : "Nobody in this household has an email address Georgia can use, so she cannot invite them. Add one to the contact record and she will pick it up.";
}

Deno.serve(async (req) => {
  const headers = { ...cors(req), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers });
  try {
    const staff = await requireStaff(req);
    if (!staff) return json({ error: "Not authorized" }, 401);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");

    if (action === "overview") {
      const { data: config } = await db.from("review_agent_config").select("*").eq("id", true).maybeSingle();
      const { data: obligations } = await db.from("review_obligations").select("*").order("window_start", { ascending: true }).limit(300);
      const ids = [...new Set((obligations ?? []).map((o: any) => o.family_id))];
      const { data: fams } = ids.length ? await db.from("families").select("id, name").in("id", ids) : { data: [] as any[] };
      const name = new Map((fams ?? []).map((f: any) => [f.id, f.name]));
      // A meeting owed by a single household is shown as "Family: Household".
      const hids = [...new Set((obligations ?? []).map((o: any) => o.household_id).filter(Boolean))];
      const { data: hhRows } = hids.length ? await db.from("households").select("id, label").in("id", hids) : { data: [] as any[] };
      const hhLabel = new Map((hhRows ?? []).map((h: any) => [h.id, h.label]));
      const { data: events } = await db.from("review_agent_events").select("id, family_id, obligation_id, mode, kind, detail, created_at").order("created_at", { ascending: false }).limit(60);
      return json({
        config,
        obligations: (obligations ?? []).map((o: any) => ({ ...o, family_name: o.household_id && hhLabel.get(o.household_id) ? `${name.get(o.family_id) ?? ""}: ${hhLabel.get(o.household_id)}` : name.get(o.family_id) ?? null })),
        events: (events ?? []).map((e: any) => ({ ...e, family_name: name.get(e.family_id) ?? null })),
      });
    }

    if (action === "setMode") {
      const mode = String(body?.mode ?? "");
      if (!["off", "shadow", "live"].includes(mode)) return json({ error: "invalid mode" }, 400);
      if (mode === "live" && body?.confirm !== true) return json({ error: "Going live needs confirm: true" }, 400);
      const { data: before } = await db.from("review_agent_config").select("mode").eq("id", true).maybeSingle();
      const patch: Record<string, unknown> = { mode, updated_at: new Date().toISOString() };
      if (mode === "live" && before?.mode !== "live") patch.since = new Date().toISOString();
      await db.from("review_agent_config").update(patch).eq("id", true);
      await db.from("review_agent_events").insert({ family_id: null, mode, kind: "mode_changed", detail: { from: before?.mode ?? null, to: mode, by: staff.email } });
      return json({ ok: true, mode });
    }

    // ── What the engine proposes for a Tier 1 rebalancing (household-level obligations): switches by asset class and death benefit resets ──
    if (action === "rebalancingProposal") {
      const { data: o } = await db.from("review_obligations").select("id, kind, household_id, proposal, published_at").eq("id", String(body?.obligationId ?? "")).maybeSingle();
      if (!o || o.kind !== "rebalancing") return json({ error: "That is not a rebalancing." }, 404);
      // Once published the client's proposal is frozen: show that, not a fresh calculation.
      if (o.published_at && o.proposal) return json({ proposal: o.proposal, frozen: true, householdId: o.household_id });
      if (!o.household_id) return json({ proposal: null, householdId: null, reason: "This rebalancing is for a whole family, not a single household, so there is no engine proposal. Write the summary by hand." });
      const { pack } = await portfolioPackFor(db, o.household_id, pacificDate(Date.now()));
      const proposal = buildClientProposal(pack);
      return json({ proposal, householdId: o.household_id, reason: proposal ? null : "Nothing to propose: every account is inside its profile's range and there is no reset due, or the household has no profile or fund detail yet." });
    }

    // ── Portfolio rebalancing: prepared by Rolf family by family, published to the portal, then carried out after the client acknowledges ──
    if (action === "publishRebalancing" || action === "unpublishRebalancing" || action === "completeRebalancing") {
      const id = String(body?.obligationId ?? "");
      const { data: o } = await db.from("review_obligations").select("*").eq("id", id).maybeSingle();
      if (!o || o.kind !== "rebalancing") return json({ error: "That is not a rebalancing." }, 404);
      const log = (kind: string, detail: Record<string, unknown> = {}) => db.from("review_agent_events").insert({ family_id: o.family_id, obligation_id: id, mode: o.mode, kind, detail: { by: staff.email, ...detail } });

      if (action === "publishRebalancing") {
        const summary = String(body?.summary ?? "").trim();
        if (summary.length < 10) return json({ error: "Write a short summary of the rebalancing for the client (at least a sentence)." }, 400);
        if (o.acknowledged_at) return json({ error: "The client has already acknowledged this one." }, 400);
        // The engine's proposal is frozen with the first publish (and refreshed if Rolf takes it back and republishes).
        let proposal = o.proposal ?? null;
        if (!o.published_at && o.household_id) {
          const { pack } = await portfolioPackFor(db, o.household_id, pacificDate(Date.now()));
          proposal = buildClientProposal(pack);
        }
        await db.from("review_obligations").update({ published_at: o.published_at ?? new Date().toISOString(), published_by: staff.userId, proposal_summary: summary, proposal, updated_at: new Date().toISOString() }).eq("id", id);
        await log(o.published_at ? "rebalancing_republished" : "rebalancing_published");
        return json({ ok: true, warning: await noInviteeWarning(db, o.family_id, o.household_id ?? null) });
      }
      if (action === "unpublishRebalancing") {
        if (o.acknowledged_at) return json({ error: "The client has already acknowledged this one, so it can't be taken back." }, 400);
        await db.from("review_obligations").update({ published_at: null, proposal_summary: null, proposal: null, updated_at: new Date().toISOString() }).eq("id", id);
        await log("rebalancing_unpublished");
        return json({ ok: true });
      }
      // completeRebalancing
      if (!o.acknowledged_at) return json({ error: "The client has not acknowledged this one yet." }, 400);
      if (o.completed_at) return json({ ok: true });
      await db.from("review_obligations").update({ completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id);
      // Close Rolf's task to carry it out (old and new titles) and its subtasks.
      const { data: carry } = await db.from("pm_tasks").select("id").eq("family_id", o.family_id).eq("status", "open").or("title.like.Rebalance %: acknowledged,title.like.Rebalance %: carry out%");
      const carryIds = (carry ?? []).map((t: any) => t.id);
      if (carryIds.length) {
        const doneAt = new Date().toISOString();
        await db.from("pm_tasks").update({ status: "done", completed_at: doneAt }).in("id", carryIds);
        await db.from("pm_tasks").update({ status: "done", completed_at: doneAt }).in("parent_task_id", carryIds).eq("status", "open");
      }
      const adultQuery = db.from("contacts").select("id").in("family_role", ["head_of_family", "head_of_household", "spouse"]).or("is_minor.is.null,is_minor.eq.false");
      const { data: adults } = await (o.household_id ? adultQuery.eq("household_id", o.household_id) : adultQuery.eq("family_id", o.family_id));
      for (const a of adults ?? []) await db.from("portal_client_notifications").insert({ contact_id: a.id, title: "Your portfolio rebalancing is complete", body: "Your portfolio has been rebalanced. Sign in to see your accounts.", source_type: "rebalancing_complete", link_tab: "financials" });
      // The resets in it are now done: record them so the pack does not offer them again before the next statement.
      try {
        const resets: any[] = Array.isArray(o.proposal?.resets) ? o.proposal.resets : [];
        if (o.household_id && resets.length) {
          const today = pacificDate(Date.now());
          const { pack: now } = await portfolioPackFor(db, o.household_id, today);
          for (const r of resets) {
            const accountId = String(r.id ?? "").split(":")[1];
            const { data: t } = await db.from("holding_tank").select("account_number").eq("id", accountId).maybeSingle();
            const { data: v } = t ? { data: null } : await db.from("vineyard_accounts").select("account_number").eq("id", accountId).maybeSingle();
            const number = t?.account_number ?? v?.account_number;
            if (!number) continue;
            const value = now.resets.rows.find((x) => x.accountId === accountId)?.fundValue ?? r.newGuarantee ?? null;
            await db.from("guarantee_resets").upsert({ household_id: o.household_id, account_number: number, last_reset_date: today, guaranteed_at_death: value, source: "rebalancing_completed", updated_by: staff.email, updated_at: new Date().toISOString() }, { onConflict: "household_id,account_number" });
          }
        }
      } catch (e) { console.error("[review-agent-admin] recording resets:", e instanceof Error ? e.message : String(e)); }
      await log("rebalancing_completed");
      return json({ ok: true });
    }

    if (action === "reminderOverview") {
      const { data: config } = await db.from("meeting_reminder_config").select("mode, send_start_hour, send_end_hour, last_unmatched").eq("id", true).maybeSingle();
      const { data: recent } = await db.from("meeting_reminders").select("id, contact_id, kind, start_time, mode, meeting_name, email_ok, note, created_at").order("created_at", { ascending: false }).limit(40);
      const ids = [...new Set((recent ?? []).map((r: any) => r.contact_id))];
      const { data: cs } = ids.length ? await db.from("contacts").select("id, first_name, last_name").in("id", ids) : { data: [] as any[] };
      const nm = new Map((cs ?? []).map((c: any) => [c.id, `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim()]));
      return json({ config, recent: (recent ?? []).map((r: any) => ({ ...r, name: nm.get(r.contact_id) ?? null })) });
    }

    // ── Portfolio Review pack: a household's allocation, returns and drift from its Investor Profile ──
    // ── Insurance files: a compliance checklist per sale or policy, and the audit package built in Drive ──
    if (action === "insFiles") {
      const householdId = String(body?.householdId ?? "");
      if (!householdId) return json({ error: "householdId required" }, 400);
      return json(await listFiles(db, householdId));
    }
    if (action === "insFileCreate") { const r = await createFile(db, staff.email, String(body?.householdId ?? ""), body?.title, body?.kind, body?.policyId, body?.contactId); return json(r, "error" in r ? 400 : 200); }
    if (action === "insFileAttach") { const r = await attachItem(db, staff.email, String(body?.fileId ?? ""), String(body?.kind ?? ""), { driveLink: body?.driveLink, meetingTaskId: body?.meetingTaskId, notApplicable: body?.notApplicable, note: body?.note }); return json(r, "error" in r ? 400 : 200); }
    if (action === "insFileRemoveItem") return json(await removeItem(db, String(body?.itemId ?? "")));
    if (action === "qFile") { const r = await fileComparison(db, staff.email, { householdId: String(body?.householdId ?? ""), contactId: String(body?.contactId ?? ""), policyType: String(body?.policyType ?? ""), fileId: body?.fileId }); return json(r, "error" in r ? 400 : 200); }
    if (action === "rGet") return json(await rGet(db, String(body?.householdId ?? "")));
    if (action === "rCompile") { const r = await rCompile(db, staff.email, { householdId: String(body?.householdId ?? ""), clientIds: body?.clientIds, policyId: body?.policyId, newPolicy: body?.newPolicy, fileId: body?.fileId }); return json(r, "error" in r ? 400 : 200); }
    if (action === "rSave") { const r = await rSave(db, String(body?.id ?? ""), body?.edits); return json(r, "error" in r ? 400 : 200); }
    if (action === "rSend") { const r = await rSend(db, staff.email, String(body?.id ?? ""), { typedName: body?.typedName, agree: body?.agree, noApplication: body?.noApplication, fileId: body?.fileId, ip: (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null }); return json(r, "error" in r ? 400 : 200); }
    if (action === "ffGet") return json(await ffGet(db, String(body?.householdId ?? "")));
    if (action === "ffCompile") { const r = await ffCompile(db, staff.email, String(body?.householdId ?? ""), String(body?.contactId ?? ""), body?.fileId); return json(r, "error" in r ? 400 : 200); }
    if (action === "ffSave") { const r = await ffSave(db, String(body?.id ?? ""), body?.edits); return json(r, "error" in r ? 400 : 200); }
    if (action === "ffSend") { const r = await ffSend(db, staff.email, String(body?.id ?? ""), body?.fileId); return json(r, "error" in r ? 400 : 200); }
    if (action === "naFile") { const r = await fileNeedsAnalysis(db, staff.email, String(body?.analysisId ?? ""), body?.fileId); return json(r, "error" in r ? 400 : 200); }
    if (action === "insDocList") return json({ documents: await listDocs(db, String(body?.householdId ?? "")), adults: await adults(db, String(body?.householdId ?? "")) });
    if (action === "insDocPreview") { const r = await previewDoc(db, String(body?.householdId ?? ""), body?.kind, body?.contactIds, body?.fields); return json(r, "error" in r ? 400 : 200); }
    if (action === "insDocSend") { const r = await sendDoc(db, staff.email, { householdId: String(body?.householdId ?? ""), kind: body?.kind, contactIds: body?.contactIds, fileId: body?.fileId, fields: body?.fields, bodyMd: body?.bodyMd }); return json(r, "error" in r ? 400 : 200); }
    if (action === "insDocVoid") { const r = await voidDoc(db, String(body?.documentId ?? ""), String(body?.reason ?? "Voided"), staff.email); return json(r, "error" in r ? 400 : 200); }
    if (action === "insDocFinalize") return json(await finalizeDoc(db, String(body?.documentId ?? "")));
    if (action === "insFilePackage") { const r = await buildPackage(db, staff.email, String(body?.fileId ?? "")); return json(r, "error" in r ? 400 : 200); }

    if (action === "portfolioPack") {
      const householdId = String(body?.householdId ?? "");
      if (!householdId) return json({ error: "householdId required" }, 400);
      const { data: hh } = await db.from("households").select("id, label, family_id, service_tier, families(name)").eq("id", householdId).maybeSingle();
      if (!hh) return json({ error: "Household not found" }, 404);
      const { pack, profiles, models } = await portfolioPackFor(db, householdId, pacificDate(Date.now()));
      const { data: pub } = await db.from("portfolio_review_publications").select("id, published_at, published_by, note, includes").eq("household_id", householdId).eq("kind", "review").is("unpublished_at", null).order("published_at", { ascending: false }).limit(1).maybeSingle();
      const { data: rebPub } = await db.from("portfolio_review_publications").select("id, published_at, published_by, note, includes").eq("household_id", householdId).eq("kind", "rebalance").is("unpublished_at", null).order("published_at", { ascending: false }).limit(1).maybeSingle();
      const { data: rebOb } = await db.from("review_obligations").select("id, window_start, window_end, status, published_at, acknowledged_at, completed_at, proposal").eq("household_id", householdId).eq("kind", "rebalancing").eq("mode", "live").neq("status", "cancelled").is("completed_at", null).gte("window_end", pacificDate(Date.now())).order("window_start", { ascending: true }).limit(1).maybeSingle();
      // How far each account holder has got with authorizing the changes to their own accounts.
      let rebalanceProgress: { owner: string; total: number; authorized: number; at: string | null }[] = [];
      if (rebOb?.proposal && rebOb.published_at) {
        const { data: acks } = await db.from("rebalance_acknowledgements").select("items, created_at").eq("obligation_id", rebOb.id).eq("decision", "acknowledged");
        const doneAt = new Map<string, string>();
        for (const a of acks ?? []) for (const i of Array.isArray(a.items) ? a.items : []) doneAt.set(String(i.id), a.created_at);
        const byOwner = new Map<string, { owner: string; total: number; authorized: number; at: string | null }>();
        for (const i of [...(rebOb.proposal.switches ?? []), ...(rebOb.proposal.resets ?? [])]) {
          const key = i.ownerId ?? i.owner ?? "owner";
          const row = byOwner.get(key) ?? { owner: i.owner ?? "Account holder", total: 0, authorized: 0, at: null };
          row.total++;
          if (doneAt.has(i.id)) { row.authorized++; row.at = doneAt.get(i.id) ?? row.at; }
          byOwner.set(key, row);
        }
        rebalanceProgress = [...byOwner.values()];
      }
      // Exactly what the clients authorized: every item they were shown, who ticked it and when, and each person's recorded response with the wording they agreed to.
      // Looked up for the latest published rebalancing even after it is done.
      let authorizations: any = null;
      const { data: authOb } = await db.from("review_obligations").select("id, window_start, window_end, published_at, acknowledged_at, completed_at, proposal, proposal_summary").eq("household_id", householdId).eq("kind", "rebalancing").eq("mode", "live").neq("status", "cancelled").not("published_at", "is", null).order("published_at", { ascending: false }).limit(1).maybeSingle();
      if (authOb) {
        const { data: acks } = await db.from("rebalance_acknowledgements").select("contact_id, decision, items, created_at, statement_version, statement_text").eq("obligation_id", authOb.id).order("created_at", { ascending: true });
        const ids = [...new Set((acks ?? []).map((a: any) => a.contact_id))];
        const { data: people } = ids.length ? await db.from("contacts").select("id, first_name, last_name").in("id", ids) : { data: [] as any[] };
        const nameOf = new Map((people ?? []).map((c: any) => [c.id, `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim()]));
        const by = new Map<string, { who: string; at: string }>();
        for (const a of acks ?? []) if (a.decision === "acknowledged") for (const i of Array.isArray(a.items) ? a.items : []) by.set(String(i.id), { who: nameOf.get(a.contact_id) ?? "A client", at: a.created_at });
        const items = [...(authOb.proposal?.switches ?? []).map((i: any) => ({ ...i, kind: "switch" })), ...(authOb.proposal?.resets ?? []).map((i: any) => ({ ...i, kind: "reset" }))].map((i: any) => ({ id: i.id, text: describeAuthorizedItem(i), authorizedBy: by.get(i.id)?.who ?? null, authorizedAt: by.get(i.id)?.at ?? null }));
        authorizations = {
          obligationId: authOb.id, windowStart: authOb.window_start, windowEnd: authOb.window_end, publishedAt: authOb.published_at, allAuthorized: !!authOb.acknowledged_at, completedAt: authOb.completed_at, note: authOb.proposal_summary ?? null, items,
          responses: (acks ?? []).map((a: any) => ({ who: nameOf.get(a.contact_id) ?? "A client", decision: a.decision, at: a.created_at, count: Array.isArray(a.items) ? a.items.length : null, statementVersion: a.statement_version, statementText: a.statement_text })),
        };
      }
      return json({ household: { id: hh.id, label: hh.label, family_id: hh.family_id, family_name: (hh as any).families?.name ?? null, service_tier: hh.service_tier }, pack, profiles, models, publication: pub ?? null, rebalancePublication: rebPub ?? null, authorizations, rebalancingObligation: rebOb ? { id: rebOb.id, window_start: rebOb.window_start, window_end: rebOb.window_end, status: rebOb.status, published_at: rebOb.published_at, acknowledged_at: rebOb.acknowledged_at, completed_at: rebOb.completed_at } : null, rebalanceProgress });
    }
    // ── One-time catch-up: bring existing households into the Drive Vault structure (idempotent; creates folders only) ──
    if (action === "vaultCatchUp") {
      const { data: hhs } = await db.from("households").select("id, label, family_id, service_tier, relationship_ended_at, vault_root_folder_id, vault_folder_id, families(name, vfo_enabled)");
      const { data: fams } = await db.from("families").select("id, name, vfo_enabled, vault_root_folder_id");
      const { data: people } = await db.from("contacts").select("household_id, family_role, is_minor, personal_vault_folder_id").not("household_id", "is", null);
      const plan = planVaultCatchUp((hhs ?? []).map((h: any) => ({ id: h.id, label: h.label, familyName: h.families?.name ?? null, familyId: h.family_id, vfo: !!h.families?.vfo_enabled, serviceTier: h.service_tier, relationshipEnded: !!h.relationship_ended_at, vaultRoot: h.vault_root_folder_id, vaultFolder: h.vault_folder_id })), (people ?? []).map((p: any) => ({ householdId: p.household_id, role: p.family_role, isMinor: p.is_minor, personalDrawer: p.personal_vault_folder_id })), (fams ?? []).map((f: any) => ({ id: f.id, name: f.name, vfo: !!f.vfo_enabled, vaultRoot: f.vault_root_folder_id })));
      if (body?.dryRun !== false) return json({ plan });
      // One household per call for a new Vault (each builds dozens of Drive folders, and a request has a time limit). The page calls again until nothing is left.
      const done: { name: string; kind: string; ok: boolean; detail: string }[] = [];
      for (const h of plan.provision.slice(0, 1)) {
        const r = await provisionClientFolderTree(db, h.id, "vault_catchup", { requestedBy: { id: staff.userId, email: staff.email } });
        done.push({ name: h.name, kind: "Vault", ok: r.ok, detail: r.ok ? `Vault created${r.personalDrawers ? `, ${r.personalDrawers} personal drawer${r.personalDrawers === 1 ? "" : "s"}` : ""}` : String(r.error) });
      }
      if (!plan.provision.length && plan.legacy.length) {
        // An older Vault: if its Household Vault folder already holds Advisor Files it is the current layout with the column unset, so just
        // record it. Otherwise build the new structure beside it. The old folders and every file in them are left exactly as they were.
        const token = await getServiceGoogleAccessToken(db);
        const gj = async (u: string) => { const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } }); return r.ok ? await r.json() : null; };
        for (const h of plan.legacy.slice(0, 1)) {
          try {
            const { data: row } = await db.from("households").select("vault_root_folder_id").eq("id", h.id).maybeSingle();
            const oldRoot = row?.vault_root_folder_id as string;
            const meta = await gj(`https://www.googleapis.com/drive/v3/files/${oldRoot}?supportsAllDrives=true&fields=id,parents`);
            const parent: string | null = meta?.parents?.[0] ?? null;
            const sibs = parent ? await gj(`https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&includeItemsFromAllDrives=true&q=${encodeURIComponent(`'${parent}' in parents and trashed=false`)}&fields=files(name)`) : null;
            if ((sibs?.files ?? []).some((f: any) => /^advisor files$/i.test(String(f.name).trim()))) {
              await db.from("households").update({ vault_folder_id: parent }).eq("id", h.id);
              done.push({ name: h.name, kind: "Older Vault", ok: true, detail: "Already the current layout: recorded its Household Vault folder" });
              continue;
            }
            const r = await provisionClientFolderTree(db, h.id, "vault_catchup", { rebuild: true, requestedBy: { id: staff.userId, email: staff.email } });
            if (r.ok) {
              await db.from("vault_audit_log").insert({ household_id: h.id, actor_type: "staff", actor_id: staff.userId, actor_label: "staff", actor_email: staff.email, action: "reprovision", drive_id: r.vaultRootFolderId ?? null, drive_name: null, metadata: { household_id: h.id, via: "vault_catchup", previous_root: r.previousRoot ?? oldRoot, note: "A new Vault structure was built beside the old one. The old Drive folders were not changed." } });
            }
            done.push({ name: h.name, kind: "Older Vault", ok: r.ok, detail: r.ok ? `New structure built${r.personalDrawers ? `, ${r.personalDrawers} personal drawer${r.personalDrawers === 1 ? "" : "s"}` : ""}. Old folder untouched: https://drive.google.com/drive/folders/${r.previousRoot ?? oldRoot}` : String(r.error) });
          } catch (e) { done.push({ name: h.name, kind: "Older Vault", ok: false, detail: e instanceof Error ? e.message : String(e) }); }
        }
      }
      if (!plan.provision.length && !plan.legacy.length && plan.familyVaults.length) {
        // The Family Vault of a VFO family: made by vault-service's own action, called with the staff member's sign-in.
        for (const f of plan.familyVaults.slice(0, 1)) {
          try {
            const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/vault-service`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization") ?? "", apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "" }, body: JSON.stringify({ action: "provisionFamilyVault", familyId: f.id }) });
            const j = await r.json().catch(() => ({}));
            done.push({ name: f.name, kind: "Family Vault", ok: r.ok, detail: r.ok ? "Family Vault created" : String(j?.detail ?? j?.error ?? `HTTP ${r.status}`) });
          } catch (e) { done.push({ name: f.name, kind: "Family Vault", ok: false, detail: e instanceof Error ? e.message : String(e) }); }
        }
      }
      if (!plan.provision.length && !plan.legacy.length && !plan.familyVaults.length) {
        const token = plan.drawers.length ? await getServiceGoogleAccessToken(db) : "";
        for (const h of plan.drawers.slice(0, 4)) {
          try { const n = await ensurePersonalDrawers(db, h.id, token, "vault_catchup"); done.push({ name: h.name, kind: "Drawers", ok: true, detail: `${n} personal drawer${n === 1 ? "" : "s"} created` }); }
          catch (e) { done.push({ name: h.name, kind: "Drawers", ok: false, detail: e instanceof Error ? e.message : String(e) }); }
        }
      }
      return json({ plan, done });
    }

    // ── Which households with open reviews or rebalancings are ready for Rolf to prepare, and what each is missing ──
    if (action === "packReadiness") {
      const today = pacificDate(Date.now());
      const { data: obs } = await db.from("review_obligations").select("family_id, household_id, kind, window_end, status").eq("mode", "live").in("kind", ["annual_review", "rebalancing"]).in("status", ["open", "booked", "paused", "escalated"]).gte("window_end", today);
      const { data: hhs } = await db.from("households").select("id, label, family_id, service_tier, relationship_ended_at, families(name)");
      const byId = new Map((hhs ?? []).map((h: any) => [h.id as string, h]));
      const wanted = new Map<string, Set<string>>();
      for (const o of obs ?? []) {
        const ids = o.household_id ? [o.household_id] : (hhs ?? []).filter((h: any) => h.family_id === o.family_id && !h.relationship_ended_at).map((h: any) => h.id);
        for (const id of ids) wanted.set(id, (wanted.get(id) ?? new Set()).add(o.kind === "rebalancing" ? "Rebalancing" : "Portfolio Review"));
      }
      const ids = [...wanted.keys()].filter((id) => byId.has(id));
      const rows: any[] = [];
      for (let i = 0; i < ids.length; i += 5) {
        await Promise.all(ids.slice(i, i + 5).map(async (id) => {
          const h: any = byId.get(id);
          try {
            const { pack } = await portfolioPackFor(db, id, today);
            const r = packReadiness(pack);
            rows.push({ householdId: id, household: h.label, family: h.families?.name ?? null, tier: h.service_tier, needs: [...wanted.get(id)!].sort(), accounts: pack.accounts.length, ...r });
          } catch (e) {
            rows.push({ householdId: id, household: h.label, family: h.families?.name ?? null, tier: h.service_tier, needs: [...wanted.get(id)!].sort(), accounts: 0, ready: false, todo: [`Could not build the pack: ${e instanceof Error ? e.message : String(e)}`], notes: [] });
          }
        }));
      }
      rows.sort((a, b) => Number(a.ready) - Number(b.ready) || String(a.family).localeCompare(String(b.family)));
      return json({ rows });
    }

    // ── Publish the Portfolio Review to the client's portal: the view is built here from the pack, frozen, and Georgia lets the household's adults know ──
    if (action === "publishPortfolioReview") {
      const householdId = String(body?.householdId ?? "");
      if (!householdId) return json({ error: "householdId required" }, 400);
      const inc = body?.includes ?? {};
      const includes: ClientIncludes = { returns: inc.returns !== false, mix: inc.mix !== false, funds: inc.funds !== false, reset: inc.reset !== false, rebalancing: inc.rebalancing !== false };
      const note = String(body?.note ?? "").slice(0, 2000);
      const kind: "review" | "rebalance" = body?.kind === "rebalance" ? "rebalance" : "review";
      // The advisor may have rewritten the shaded commentary boxes; an empty box means the suggested wording.
      const narratives = { mix: narrativeParagraphs(body?.narratives?.mix)?.join("\n\n") ?? null, funds: narrativeParagraphs(body?.narratives?.funds)?.join("\n\n") ?? null };
      const storedIncludes = { ...includes, narratives };
      const { data: hh } = await db.from("households").select("id, label, family_id").eq("id", householdId).maybeSingle();
      if (!hh) return json({ error: "Household not found" }, 404);
      const { pack } = await portfolioPackFor(db, householdId, pacificDate(Date.now()));
      if (!pack.accounts.length) return json({ error: "There are no managed accounts to show." }, 400);
      const view = buildClientView(pack, includes, note, hh.label ?? "Household", kind, narratives);

      // The Tier 1 rebalancing: the same page and pack, tied to the household's rebalancing obligation so Georgia's reminders, the task and "to carry out" keep working.
      if (kind === "rebalance") {
        if (note.trim().length < 10) return json({ error: "Write a short note for the client (at least a sentence)." }, 400);
        // The mix comes from the last statement scan; past the limit, switches are only proposed once Rolf has checked current holdings on iA.
        if (pack.holdings.stale && body?.holdingsChecked !== true) return json({ error: `The fund detail is from ${pack.holdings.asOf} (${pack.holdings.ageDays} days old). Check the current holdings on iA's advisor site, then confirm you have before publishing.` }, 400);
        const { data: ob } = await db.from("review_obligations").select("*").eq("household_id", householdId).eq("kind", "rebalancing").eq("mode", "live").neq("status", "cancelled").is("completed_at", null).gte("window_end", pacificDate(Date.now())).order("window_start", { ascending: true }).limit(1).maybeSingle();
        if (!ob) return json({ error: "No rebalancing is due for this household." }, 400);
        if (ob.acknowledged_at) return json({ error: "The client has already authorized this rebalancing." }, 400);
        if (!view.proposal && !view.funds && !view.fundsSets?.length) return json({ error: "There is nothing to show: the household has no fund detail or nothing to propose." }, 400);
        const nowIso = new Date().toISOString();
        const wasPublished = Boolean(ob.published_at);
        await db.from("review_obligations").update({ published_at: ob.published_at ?? nowIso, published_by: staff.userId, proposal_summary: note.trim(), proposal: view.proposal ?? null, updated_at: nowIso }).eq("id", ob.id);
        await db.from("portfolio_review_publications").update({ unpublished_at: nowIso }).eq("household_id", householdId).eq("kind", "rebalance").is("unpublished_at", null);
        const { error: pe } = await db.from("portfolio_review_publications").insert({ household_id: householdId, kind: "rebalance", obligation_id: ob.id, published_by: staff.email, note: note.trim(), includes: storedIncludes, view });
        if (pe) return json({ error: pe.message }, 400);
        if (!wasPublished) {
          const { data: adults } = await db.from("contacts").select("id").eq("household_id", householdId).in("family_role", ["head_of_household", "head_of_family", "spouse"]).eq("is_minor", false);
          for (const a of adults ?? []) await db.from("portal_client_notifications").insert({ contact_id: a.id, title: "Your rebalancing is ready to review", body: "Rolf has prepared a rebalancing for you. Sign in to review it.", source_type: "rebalancing", link_tab: "dashboard" });
        }
        await db.from("review_agent_events").insert({ family_id: ob.family_id, obligation_id: ob.id, mode: ob.mode, kind: wasPublished ? "rebalancing_republished" : "rebalancing_published", detail: { by: staff.email, via: "pack" } });
        return json({ ok: true, emailed: 0, updated: wasPublished, warning: await noInviteeWarning(db, ob.family_id, householdId) });
      }
      const { data: prior } = await db.from("portfolio_review_publications").select("id, notified_at").eq("household_id", householdId).eq("kind", "review").is("unpublished_at", null);
      const firstTime = !(prior ?? []).some((p: any) => p.notified_at);
      await db.from("portfolio_review_publications").update({ unpublished_at: new Date().toISOString() }).eq("household_id", householdId).eq("kind", "review").is("unpublished_at", null);
      const { data: row, error } = await db.from("portfolio_review_publications").insert({ household_id: householdId, kind: "review", published_by: staff.email, note: note || null, includes: storedIncludes, view }).select("id").single();
      if (error) return json({ error: error.message }, 400);
      let notified = 0;
      if (firstTime) {
        const { data: adults } = await db.from("contacts").select("id, first_name, email, family_role, is_minor, no_automated_email").eq("household_id", householdId).in("family_role", ["head_of_household", "head_of_family", "spouse"]);
        for (const a of adults ?? []) {
          if (a.is_minor) continue;
          await db.from("portal_client_notifications").insert({ contact_id: a.id, title: "Your Portfolio Review is ready", body: "Rolf has prepared your Portfolio Review. Sign in to read it.", source_type: "portfolio_review", link_tab: "dashboard" });
          if (a.email && !a.no_automated_email) {
            const { subject, html } = portfolioReviewReadyEmail(a.first_name ?? "", PORTAL_URL, "This is an automated email from Georgia, Rolf's AI Assistant. If you need to get in touch with Rolf, just reply to this email, and I'll make sure he gets it.");
            const sent = await sendServiceEmailDetailed(db, { to: a.email, subject, html, from: Deno.env.get("ONBOARDING_AGENT_FROM") || AGENT_SENDER });
            if (sent.ok) notified++;
          }
        }
        await db.from("portfolio_review_publications").update({ notified_at: new Date().toISOString() }).eq("id", row.id);
      }
      await db.from("review_agent_events").insert({ family_id: null, mode: "live", kind: "portfolio_review_published", detail: { household_id: householdId, by: staff.email, emailed: notified, updated: !firstTime } });
      return json({ ok: true, emailed: notified, updated: !firstTime });
    }
    if (action === "unpublishPortfolioReview") {
      const householdId = String(body?.householdId ?? "");
      if (body?.kind === "rebalance") {
        const { data: ob } = await db.from("review_obligations").select("id, acknowledged_at").eq("household_id", householdId).eq("kind", "rebalancing").eq("mode", "live").neq("status", "cancelled").is("completed_at", null).gte("window_end", pacificDate(Date.now())).order("window_start", { ascending: true }).limit(1).maybeSingle();
        if (ob?.acknowledged_at) return json({ error: "The client has already authorized this one, so it can't be taken back." }, 400);
        if (ob) await db.from("review_obligations").update({ published_at: null, proposal_summary: null, proposal: null, updated_at: new Date().toISOString() }).eq("id", ob.id);
        await db.from("portfolio_review_publications").update({ unpublished_at: new Date().toISOString() }).eq("household_id", householdId).eq("kind", "rebalance").is("unpublished_at", null);
        await db.from("review_agent_events").insert({ family_id: null, mode: "live", kind: "rebalancing_unpublished", detail: { household_id: householdId, by: staff.email, via: "pack" } });
        return json({ ok: true });
      }
      await db.from("portfolio_review_publications").update({ unpublished_at: new Date().toISOString() }).eq("household_id", householdId).eq("kind", "review").is("unpublished_at", null);
      await db.from("review_agent_events").insert({ family_id: null, mode: "live", kind: "portfolio_review_unpublished", detail: { household_id: householdId, by: staff.email } });
      return json({ ok: true });
    }
    // ── What the household's AI Workbench should show: its governing tier, Charter status, review windows and whether a review is published ──
    if (action === "workbenchFacts") {
      const householdId = String(body?.householdId ?? "");
      const { data: hh } = await db.from("households").select("id, family_id, service_tier").eq("id", householdId).maybeSingle();
      if (!hh) return json({ error: "Household not found" }, 404);
      const { data: fam } = await db.from("families").select("service_tier, vfo_enabled, has_ratified_charter, service_tier_source").eq("id", hh.family_id).maybeSingle();
      const pooled = !fam || isPooledFamily(fam);
      const { data: cfg } = await db.from("review_agent_config").select("mode").eq("id", true).maybeSingle();
      const mode = cfg?.mode === "shadow" ? "shadow" : "live";
      let q = db.from("review_obligations").select("kind, window_start, window_end, status").eq("family_id", hh.family_id).eq("mode", mode).neq("status", "cancelled");
      q = pooled ? q.is("household_id", null) : q.eq("household_id", householdId);
      const { data: obligations } = await q;
      const { count } = await db.from("portfolio_review_publications").select("id", { count: "exact", head: true }).eq("household_id", householdId).eq("kind", "review").is("unpublished_at", null);
      return json({ tier: pooled ? fam?.service_tier ?? null : hh.service_tier ?? null, hasRatifiedCharter: Boolean(fam?.has_ratified_charter), obligations: obligations ?? [], publishedReview: (count ?? 0) > 0 });
    }

    // ── iA model portfolios: upload the published PDF, check what was read, then save it as a new dated set ──
    if (action === "readModelPdf") {
      const b64 = String(body?.pdfBase64 ?? "");
      if (!b64) return json({ error: "pdfBase64 required" }, 400);
      if (b64.length > 8_000_000) return json({ error: "That file is too large (limit about 5 MB)." }, 400);
      const sa = await parseServiceAccountKey(Deno.env.get("GCP_SERVICE_ACCOUNT_KEY"));
      const result = await generateVertexContent(sa, GEMINI_EXTRACT_MODEL, [{ role: "user", parts: [{ text: MODEL_PROMPT }, { inlineData: { mimeType: "application/pdf", data: b64 } }] }], withThinking(GEMINI_EXTRACT_MODEL, { temperature: 0.1, maxOutputTokens: 8000 }, "minimal"));
      let raw: any;
      try { raw = extractJson(result.candidates?.[0]?.content?.parts?.[0]?.text ?? ""); } catch { return json({ error: "The document could not be read as model portfolios." }, 422); }
      return json({ validation: validateModels(raw, pacificDate(Date.now())) });
    }
    if (action === "saveModels") {
      // Re-checked here: the browser's preview is not trusted.
      const v = validateModels({ as_of: body?.asOf, portfolios: (body?.models ?? []).map((m: any) => ({ profile: m.key, income_min: m.incomeMin, income_max: m.incomeMax, equity_min: m.equityMin, equity_max: m.equityMax, funds: m.funds, fixed_income_weight: m.incomeTarget })) }, pacificDate(Date.now()));
      if (!v.ok || !v.parsed.asOf) return json({ error: v.errors.join(" ") || "Not valid" }, 400);
      const rows = v.parsed.models.map((m, i) => ({ as_of: v.parsed.asOf, profile_key: m.key, label: m.label, sort_order: i + 1, income_min: m.incomeMin, income_max: m.incomeMax, equity_min: m.equityMin, equity_max: m.equityMax, income_target: m.incomeTarget, funds: m.funds, source_file: String(body?.sourceFile ?? "").slice(0, 200) || null }));
      const { error } = await db.from("ia_model_portfolios").upsert(rows, { onConflict: "as_of,profile_key" });
      if (error) return json({ error: error.message }, 400);
      await db.from("review_agent_events").insert({ family_id: null, mode: "live", kind: "ia_models_saved", detail: { as_of: v.parsed.asOf, by: staff.email, file: body?.sourceFile ?? null } });
      return json({ ok: true, asOf: v.parsed.asOf });
    }
    if (action === "saveInvestorProfile") {
      const householdId = String(body?.householdId ?? "");
      const accountNumber = String(body?.accountNumber ?? "").trim() || null;
      const pct = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
      // A model profile takes its target from iA's published model; "custom" uses the numbers typed in.
      const profileKey = String(body?.profileKey ?? "").trim().toLowerCase() || null;
      const model = profileKey && profileKey !== "custom" ? (await latestModels(db)).find((m) => m.key === profileKey) ?? null : null;
      if (profileKey && profileKey !== "custom" && !model) return json({ error: "Unknown profile" }, 400);
      const income = model ? model.incomeTarget : pct(body?.incomePct);
      let equity = model ? 100 - model.incomeTarget : pct(body?.equityPct);
      if (!householdId || income === null || !Number.isFinite(income) || income < 0 || income > 100) return json({ error: "Income % must be between 0 and 100" }, 400);
      if (equity === null) equity = 100 - income;
      const band = pct(body?.bandPct) ?? 0;
      const row = { household_id: householdId, account_number: accountNumber, label: model ? model.label : String(body?.label ?? "").trim().slice(0, 80) || null, profile_key: model ? model.key : null, income_pct: income, equity_pct: equity, band_pct: band, source: "manual", as_of: pacificDate(Date.now()), updated_by: staff.email, updated_at: new Date().toISOString() };
      const lookup = db.from("investor_profiles").select("id").eq("household_id", householdId);
      const { data: found } = await (accountNumber === null ? lookup.is("account_number", null) : lookup.eq("account_number", accountNumber)).maybeSingle();
      const { error } = found?.id ? await db.from("investor_profiles").update(row).eq("id", found.id) : await db.from("investor_profiles").insert(row);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
    if (action === "saveGuaranteeReset") {
      const householdId = String(body?.householdId ?? "");
      const accountNumber = String(body?.accountNumber ?? "").trim();
      const d = body?.lastResetDate ? String(body.lastResetDate) : null;
      if (!householdId || !accountNumber) return json({ error: "householdId and accountNumber required" }, 400);
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return json({ error: "Date must be YYYY-MM-DD" }, 400);
      const { error } = await db.from("guarantee_resets").upsert({ household_id: householdId, account_number: accountNumber, last_reset_date: d, guaranteed_at_death: null, source: "manual", updated_by: staff.email, updated_at: new Date().toISOString() }, { onConflict: "household_id,account_number" });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
    if (action === "deleteInvestorProfile") {
      const householdId = String(body?.householdId ?? "");
      const accountNumber = String(body?.accountNumber ?? "").trim() || null;
      const q = db.from("investor_profiles").delete().eq("household_id", householdId);
      const { error } = await (accountNumber === null ? q.is("account_number", null) : q.eq("account_number", accountNumber));
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "setReminderMode") {
      const mode = String(body?.mode ?? "");
      if (!["off", "shadow", "live"].includes(mode)) return json({ error: "invalid mode" }, 400);
      if (mode === "live" && body?.confirm !== true) return json({ error: "Going live needs confirm: true" }, 400);
      const { data: before } = await db.from("meeting_reminder_config").select("mode").eq("id", true).maybeSingle();
      await db.from("meeting_reminder_config").update({ mode, updated_at: new Date().toISOString() }).eq("id", true);
      await db.from("review_agent_events").insert({ family_id: null, mode, kind: "reminder_mode_changed", detail: { from: before?.mode ?? null, to: mode, by: staff.email } });
      return json({ ok: true, mode });
    }

    // Rolf closes a review or rebalancing himself (done outside the flow, or no longer needed): Georgia stops, nobody is emailed.
    if (action === "supportOverview") {
      const { data: away } = await db.from("staff_availability").select("away_from, away_until, note").eq("id", true).maybeSingle();
      const { data: rows } = await db.from("portal_assistant_conversations").select("id, contact_id, messages, flag, flag_summary, flagged_at, away_when_flagged, reviewed_at, updated_at, advisor_active").order("updated_at", { ascending: false }).limit(60);
      const ids = [...new Set((rows ?? []).map((r: any) => r.contact_id))];
      const { data: cs } = ids.length ? await db.from("contacts").select("id, full_name").in("id", ids) : { data: [] as any[] };
      const name = new Map((cs ?? []).map((c: any) => [c.id, c.full_name]));
      const list = (rows ?? []).map((r: any) => ({ ...r, contact_name: name.get(r.contact_id) ?? "Client" }));
      // Waiting for Rolf first (urgent, then routine), then the rest by recency.
      const rank = (r: any) => (r.flag && !r.reviewed_at ? (r.flag === "urgent" ? 0 : 1) : 2);
      list.sort((a: any, b: any) => rank(a) - rank(b));
      return json({ away: away ?? { away_from: null, away_until: null, note: null }, conversations: list });
    }

    if (action === "supportReview") {
      const id = String(body?.id ?? "");
      if (!id) return json({ error: "id required" }, 400);
      await db.from("portal_assistant_conversations").update({ reviewed_at: new Date().toISOString() }).eq("id", id);
      return json({ ok: true });
    }

    if (action === "supportReply") {
      const id = String(body?.id ?? "");
      const content = typeof body?.content === "string" ? body.content.trim().slice(0, 4000) : "";
      if (!id || !content) return json({ error: "A conversation and a message are required." }, 400);
      const { data: conv } = await db.from("portal_assistant_conversations").select("id, contact_id, messages").eq("id", id).maybeSingle();
      if (!conv) return json({ error: "Conversation not found." }, 404);
      const nowIso = new Date().toISOString();
      const messages = storableMessages([...storableMessages(conv.messages), { role: "advisor", content, at: nowIso }]);
      await db.from("portal_assistant_conversations").update({ messages, advisor_active: true, last_advisor_reply_at: nowIso, reviewed_at: nowIso, updated_at: nowIso }).eq("id", id);
      // The client is told in the portal and by a short email with no content, once per half hour.
      // @ts-ignore EdgeRuntime is provided by Supabase Edge Functions runtime
      EdgeRuntime.waitUntil(
        fetch(`${SUPABASE_URL}/functions/v1/notify-portal-request`, {
          method: "POST",
          headers: { "x-region": "ca-central-1", "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ notify_type: "chat_reply", contact_id: conv.contact_id }),
        }).catch((e) => console.error("[review-agent-admin] client notify failed", e)),
      );
      return json({ ok: true, messages });
    }

    if (action === "supportHandBack") {
      const id = String(body?.id ?? "");
      if (!id) return json({ error: "id required" }, 400);
      await db.from("portal_assistant_conversations").update({ advisor_active: false }).eq("id", id);
      return json({ ok: true });
    }

    if (action === "setAway") {
      const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
      const until = date(body?.away_until);
      const from = date(body?.away_from);
      if (until && from && from > until) return json({ error: "The away dates are the wrong way round." }, 400);
      const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 300) : null;
      await db.from("staff_availability").update({ away_from: until ? from : null, away_until: until, note: until ? note : null, updated_at: new Date().toISOString() }).eq("id", true);
      return json({ ok: true });
    }

    if (action === "markComplete") {
      const id = String(body?.obligationId ?? "");
      const { data: o } = await db.from("review_obligations").select("*").eq("id", id).maybeSingle();
      if (!o) return json({ error: "not found" }, 404);
      if (!["open", "booked", "paused", "escalated"].includes(o.status)) return json({ ok: true });
      const now = new Date().toISOString();
      const patch: Record<string, unknown> = { status: "held", updated_at: now };
      if (o.kind === "rebalancing" && !o.completed_at) patch.completed_at = now;
      await db.from("review_obligations").update(patch).eq("id", id);
      if (o.kind === "rebalancing") {
        const { data: carry } = await db.from("pm_tasks").select("id").eq("family_id", o.family_id).eq("status", "open").or("title.like.Rebalance %: acknowledged,title.like.Rebalance %: carry out%");
        const carryIds = (carry ?? []).map((t: any) => t.id);
        if (carryIds.length) {
          await db.from("pm_tasks").update({ status: "done", completed_at: now }).in("id", carryIds);
          await db.from("pm_tasks").update({ status: "done", completed_at: now }).in("parent_task_id", carryIds).eq("status", "open");
        }
      }
      await db.from("review_agent_events").insert({ family_id: o.family_id, obligation_id: id, mode: o.mode, kind: "marked_complete", detail: { by: staff.email, kind: o.kind, was: o.status } });
      return json({ ok: true });
    }

    if (action === "setPaused") {
      const id = String(body?.obligationId ?? "");
      const paused = body?.paused === true;
      const { data: o } = await db.from("review_obligations").select("*").eq("id", id).maybeSingle();
      if (!o) return json({ error: "not found" }, 404);
      if (paused && !["open", "booked"].includes(o.status)) return json({ error: `A ${o.status} meeting can't be paused` }, 400);
      if (!paused && o.status !== "paused") return json({ error: "Not paused" }, 400);
      await db.from("review_obligations").update({ status: paused ? "paused" : "open", updated_at: new Date().toISOString() }).eq("id", id);
      await db.from("review_agent_events").insert({ family_id: o.family_id, obligation_id: id, mode: o.mode, kind: paused ? "paused" : "resumed", detail: { by: staff.email } });
      return json({ ok: true });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
