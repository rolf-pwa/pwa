// Client Portal task view, backed by pm_tasks/pm_task_comments instead of
// Asana. Read + comment only -- clients never create tasks (matches the
// Asana-backed version this replaces).

import { notifyStaffOfClientReply, type TaskRef } from "../_shared/task-notify.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validatePortalContact } from "../_shared/portal-auth.ts";
import { clientGet, clientPending, clientSign, clientSigned } from "../_shared/insurance-doc-client.ts";
import { clientDownload, finalizeDoc } from "../_shared/insurance-doc-service.ts";
import { clientReportDownload, clientReports } from "../_shared/report-sharing.ts";

const ALLOWED_ORIGINS = [
  "https://prosperwise-portal.web.app",
  "https://prosperwise.lovable.app",
  "https://app.prosperwise.ca",
  "https://id-preview--339dfc8f-3e82-4b05-8a36-a9f66fc58449.lovable.app",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
  };
}

/** What a client sees of the owner: Georgia when she holds the task, otherwise nothing. The agent key itself never leaves the server. */
// deno-lint-ignore-file no-explicit-any
const forClient = (rows: any[] | null) => (rows ?? []).map(({ assigned_agent_key, ...t }) => ({ ...t, assignee_label: assigned_agent_key === "georgia" ? "Georgia" : null }));

const TASK_FIELDS =
  "id, parent_task_id, title, description, status, due_date, completed_at, contact_id, household_id, created_at, assigned_agent_key";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const body = await req.json().catch(() => ({}));
    const { action, portal_token, task_id, body: commentBody } = body;

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const portalContact = await validatePortalContact(supabase, portal_token);
    if (!portalContact) return json({ error: "Unauthorized" }, 401);
    const { contactId, householdId } = portalContact;

    const inScopeFilter = (q: any) =>
      householdId
        ? q.or(`contact_id.eq.${contactId},household_id.eq.${householdId}`)
        : q.eq("contact_id", contactId);

    // Verifies a task_id actually belongs to this contact/household and is
    // client-visible before letting a request read/write anything scoped to
    // it -- never trust a client-supplied task id blindly.
    const taskInScope = async (id: string) => {
      const { data } = await supabase
        .from("pm_tasks")
        .select("id, contact_id, household_id, client_visible")
        .eq("id", id)
        .maybeSingle();
      if (!data || !data.client_visible) return null;
      if (data.contact_id !== contactId && (!householdId || data.household_id !== householdId)) return null;
      return data;
    };

    if (action === "list") {
      let q = supabase.from("pm_tasks").select(TASK_FIELDS).is("parent_task_id", null).eq("client_visible", true);
      q = inScopeFilter(q).order("due_date", { ascending: true, nullsFirst: false });
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      return json({ tasks: forClient(data) });
    }

    if (action === "subtasks") {
      if (!task_id) return json({ error: "task_id is required" }, 400);
      const parent = await taskInScope(task_id);
      if (!parent) return json({ error: "Not found" }, 404);
      const { data, error } = await supabase
        .from("pm_tasks")
        .select(TASK_FIELDS)
        .eq("parent_task_id", task_id)
        .eq("client_visible", true)
        .order("due_date", { ascending: true, nullsFirst: false });
      if (error) return json({ error: error.message }, 500);
      return json({ tasks: forClient(data) });
    }

    if (action === "comments") {
      if (!task_id) return json({ error: "task_id is required" }, 400);
      const task = await taskInScope(task_id);
      if (!task) return json({ error: "Not found" }, 404);

      const { data: comments, error } = await supabase
        .from("pm_task_comments")
        .select("id, task_id, author_id, author_contact_id, author_agent_key, body, body_format, kind, edited_at, created_at")
        .eq("task_id", task_id)
        .order("created_at", { ascending: true });
      if (error) return json({ error: error.message }, 500);

      const staffIds = [...new Set((comments || []).filter((c) => c.author_id).map((c) => c.author_id))];
      const clientIds = [...new Set((comments || []).filter((c) => c.author_contact_id).map((c) => c.author_contact_id))];
      const [{ data: staff }, { data: clients }] = await Promise.all([
        staffIds.length ? supabase.from("profiles").select("user_id, full_name").in("user_id", staffIds) : Promise.resolve({ data: [] }),
        clientIds.length ? supabase.from("contacts").select("id, first_name, last_name").in("id", clientIds) : Promise.resolve({ data: [] }),
      ]);
      const staffById = new Map((staff || []).map((s: any) => [s.user_id, s.full_name]));
      const contactById = new Map((clients || []).map((c: any) => [c.id, `${c.first_name} ${c.last_name || ""}`.trim()]));

      const resolved = (comments || []).map((c: any) => ({
        id: c.id,
        task_id: c.task_id,
        body: c.body,
        // Only staff comments can be formatted; a client's is always shown as plain text.
        body_format: c.author_id && c.body_format === "html" ? "html" : "text",
        kind: c.kind === "system" ? "system" : "comment",
        edited_at: c.edited_at ?? null,
        created_at: c.created_at,
        // Georgia's comments (an agent, no staff or client author) are shown as hers, never as the client's own.
        author_type: c.author_id || c.author_agent_key ? "staff" : "client",
        author_name: c.author_id ? staffById.get(c.author_id) || "ProsperWise" : c.author_agent_key ? "Georgia" : contactById.get(c.author_contact_id) || "You",
      }));
      return json({ comments: resolved });
    }

    if (action === "postComment") {
      if (!task_id || !String(commentBody || "").trim()) return json({ error: "task_id and body are required" }, 400);
      const task = await taskInScope(task_id);
      if (!task) return json({ error: "Not found" }, 404);

      const { data, error } = await supabase
        .from("pm_task_comments")
        .insert({ task_id, author_contact_id: contactId, body: String(commentBody).trim() })
        .select("id, task_id, body, created_at")
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      // Rolf is told in the app that the client replied, so the conversation on a recap carries on.
      try {
        const { data: who } = await supabase.from("contacts").select("full_name").eq("id", contactId).maybeSingle();
        const { data: full } = await supabase.from("pm_tasks").select("id, title, client_visible, contact_id, household_id").eq("id", task_id).maybeSingle();
        if (full) await notifyStaffOfClientReply(supabase, full as TaskRef, who?.full_name ?? "", String(commentBody).trim(), contactId);
      } catch (e) {
        console.error("[portal-pm-tasks] staff notification failed", e);
      }
      return json({ comment: data });
    }

    // Documents the client signs (the advisor disclosure and privacy consent). Only a person named as a signer on a document can see or sign it.
    if (action === "docList") return json({ documents: await clientPending(supabase, contactId) });
    if (action === "docSigned") return json({ documents: await clientSigned(supabase, contactId) });
    if (action === "reportList") return json({ reports: await clientReports(supabase, contactId) });
    if (action === "reportDownload") { const r = await clientReportDownload(supabase, contactId, String(body.report_id ?? "")); return json(r, "error" in r ? 404 : 200); }
    if (action === "docDownload") { const r = await clientDownload(supabase, contactId, String(body.document_id ?? "")); return json(r, "error" in r ? 404 : 200); }
    if (action === "docGet") { const r = await clientGet(supabase, contactId, String(body.document_id ?? "")); return json(r, "error" in r ? 404 : 200); }
    if (action === "docSign") {
      const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
      const r = await clientSign(supabase, contactId, String(body.document_id ?? ""), body.signature, ip, req.headers.get("user-agent"), (id) => finalizeDoc(supabase, id));
      return json(r, "error" in r ? 400 : 200);
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    console.error("portal-pm-tasks error:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
