// review-agent-admin: staff-only window onto Georgia's review windows (its tables are service-role only).
//   overview          mode, limits, every obligation with its family, and the latest events
//   setMode           off | shadow | live (live needs confirm: true and restarts `since`, so only later windows are managed)
//   setPaused         pause or resume one obligation

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { latestModels, portfolioPackFor } from "../_shared/portfolio-review-data.ts";
import { pacificDate } from "../_shared/review-windows.ts";
import { MODEL_PROMPT, validateModels } from "../_shared/ia-model-parse.ts";
import { isPooledFamily } from "../_shared/review-units.ts";
import { buildClientView, portfolioReviewReadyEmail, type ClientIncludes } from "../_shared/portfolio-review-client.ts";
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
        await db.from("review_obligations").update({ published_at: o.published_at ?? new Date().toISOString(), published_by: staff.userId, proposal_summary: summary, updated_at: new Date().toISOString() }).eq("id", id);
        await log(o.published_at ? "rebalancing_republished" : "rebalancing_published");
        return json({ ok: true });
      }
      if (action === "unpublishRebalancing") {
        if (o.acknowledged_at) return json({ error: "The client has already acknowledged this one, so it can't be taken back." }, 400);
        await db.from("review_obligations").update({ published_at: null, proposal_summary: null, updated_at: new Date().toISOString() }).eq("id", id);
        await log("rebalancing_unpublished");
        return json({ ok: true });
      }
      // completeRebalancing
      if (!o.acknowledged_at) return json({ error: "The client has not acknowledged this one yet." }, 400);
      if (o.completed_at) return json({ ok: true });
      await db.from("review_obligations").update({ completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id);
      await db.from("pm_tasks").update({ status: "done", completed_at: new Date().toISOString() }).eq("family_id", o.family_id).eq("status", "open").like("title", "Rebalance %: acknowledged");
      const { data: adults } = await db.from("contacts").select("id").eq("family_id", o.family_id).in("family_role", ["head_of_family", "spouse"]);
      for (const a of adults ?? []) await db.from("portal_client_notifications").insert({ contact_id: a.id, title: "Your portfolio rebalancing is complete", body: "Your portfolio has been rebalanced. Sign in to see your accounts.", source_type: "rebalancing_complete", link_tab: "financials" });
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
    if (action === "portfolioPack") {
      const householdId = String(body?.householdId ?? "");
      if (!householdId) return json({ error: "householdId required" }, 400);
      const { data: hh } = await db.from("households").select("id, label, family_id, service_tier, families(name)").eq("id", householdId).maybeSingle();
      if (!hh) return json({ error: "Household not found" }, 404);
      const { pack, profiles, models } = await portfolioPackFor(db, householdId, pacificDate(Date.now()));
      const { data: pub } = await db.from("portfolio_review_publications").select("id, published_at, published_by, note, includes").eq("household_id", householdId).is("unpublished_at", null).order("published_at", { ascending: false }).limit(1).maybeSingle();
      const { data: decRows } = pub ? await db.from("portfolio_review_decisions").select("decision, item_ids, items, created_at, contact_id").eq("publication_id", pub.id).order("created_at", { ascending: true }) : { data: [] as any[] };
      const decContacts = [...new Set((decRows ?? []).map((d: any) => d.contact_id))];
      const { data: decPeople } = decContacts.length ? await db.from("contacts").select("id, first_name, last_name").in("id", decContacts) : { data: [] as any[] };
      const decName = new Map((decPeople ?? []).map((c: any) => [c.id, `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim()]));
      const decisions = (decRows ?? []).map((d: any) => ({ decision: d.decision, item_ids: d.item_ids ?? [], items: d.items ?? [], created_at: d.created_at, by: decName.get(d.contact_id) ?? null }));
      return json({ household: { id: hh.id, label: hh.label, family_id: hh.family_id, family_name: (hh as any).families?.name ?? null, service_tier: hh.service_tier }, pack, profiles, models, publication: pub ?? null, decisions });
    }
    // ── Publish the Portfolio Review to the client's portal: the view is built here from the pack, frozen, and Georgia lets the household's adults know ──
    if (action === "publishPortfolioReview") {
      const householdId = String(body?.householdId ?? "");
      if (!householdId) return json({ error: "householdId required" }, 400);
      const inc = body?.includes ?? {};
      const includes: ClientIncludes = { returns: inc.returns !== false, mix: inc.mix !== false, funds: inc.funds !== false, reset: inc.reset !== false, rebalancing: inc.rebalancing !== false };
      const note = String(body?.note ?? "").slice(0, 2000);
      const { data: hh } = await db.from("households").select("id, label").eq("id", householdId).maybeSingle();
      if (!hh) return json({ error: "Household not found" }, 404);
      const { pack } = await portfolioPackFor(db, householdId, pacificDate(Date.now()));
      if (!pack.accounts.length) return json({ error: "There are no managed accounts to show." }, 400);
      const view = buildClientView(pack, includes, note, hh.label ?? "Household");
      const { data: prior } = await db.from("portfolio_review_publications").select("id, notified_at").eq("household_id", householdId).is("unpublished_at", null);
      const firstTime = !(prior ?? []).some((p: any) => p.notified_at);
      await db.from("portfolio_review_publications").update({ unpublished_at: new Date().toISOString() }).eq("household_id", householdId).is("unpublished_at", null);
      const { data: row, error } = await db.from("portfolio_review_publications").insert({ household_id: householdId, published_by: staff.email, note: note || null, includes, view }).select("id").single();
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
      await db.from("portfolio_review_publications").update({ unpublished_at: new Date().toISOString() }).eq("household_id", householdId).is("unpublished_at", null);
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
      const { count } = await db.from("portfolio_review_publications").select("id", { count: "exact", head: true }).eq("household_id", householdId).is("unpublished_at", null);
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
      const { error } = await db.from("guarantee_resets").upsert({ household_id: householdId, account_number: accountNumber, last_reset_date: d, updated_by: staff.email, updated_at: new Date().toISOString() }, { onConflict: "household_id,account_number" });
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
