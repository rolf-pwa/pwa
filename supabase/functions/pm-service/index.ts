// pm-service — staff-only CRUD for the in-house PM system (projects, tasks,
// comments). Phase 1: no external API, no portal/client access yet.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://prosperwise-portal.web.app",
  "https://prosperwise.lovable.app",
  "https://app.prosperwise.ca",
  "https://id-preview--339dfc8f-3e82-4b05-8a36-a9f66fc58449.lovable.app",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowed =
    ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".lovable.app") || origin.endsWith(".lovableproject.com")
      ? origin
      : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

async function requireStaff(req: Request): Promise<{ userId: string; error?: undefined } | { error: string }> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return { error: "Missing authorization header" };
  const supabaseUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await supabaseUser.auth.getUser();
  if (error || !data?.user) return { error: "Not authenticated" };
  if (!data.user.email?.endsWith("@prosperwise.ca")) return { error: "Not authorized" };
  return { userId: data.user.id };
}

const PROJECT_FIELDS =
  "id, name, description, status, household_id, contact_id, corporation_id, family_id, created_by, created_at, updated_at";
const TASK_FIELDS =
  "id, project_id, parent_task_id, title, description, status, due_date, assignee_id, assigned_agent_key, household_id, contact_id, corporation_id, family_id, completed_at, client_visible, created_by, created_at, updated_at";

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  try {
    const auth = await requireStaff(req);
    if (auth.error) return json({ ok: false, error: auth.error }, 401);
    const userId = auth.userId;

    const db = admin();
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    if (action === "listProjects") {
      const { data, error } = await db
        .from("pm_projects")
        .select(PROJECT_FIELDS)
        .order("created_at", { ascending: false });
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, projects: data });
    }

    if (action === "createProject") {
      const { name, description, status, household_id, contact_id, corporation_id, family_id } = body;
      if (!String(name || "").trim()) return json({ ok: false, error: "Project name is required" }, 400);
      const linkCount = [household_id, contact_id, corporation_id, family_id].filter(Boolean).length;
      if (linkCount > 1) {
        return json({ ok: false, error: "A project can link to at most one household, contact, corporation, or family" }, 400);
      }
      const { data, error } = await db
        .from("pm_projects")
        .insert({
          name: String(name).trim(),
          description: description || null,
          status: status || "active",
          household_id: household_id || null,
          contact_id: contact_id || null,
          corporation_id: corporation_id || null,
          family_id: family_id || null,
          created_by: userId,
        })
        .select(PROJECT_FIELDS)
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, project: data });
    }

    if (action === "updateProject") {
      const { id, ...updates } = body;
      if (!id) return json({ ok: false, error: "id is required" }, 400);
      const patch: Record<string, unknown> = {};
      for (const key of ["name", "description", "status", "household_id", "contact_id", "corporation_id", "family_id"]) {
        if (key in updates) patch[key] = updates[key];
      }
      const { data, error } = await db.from("pm_projects").update(patch).eq("id", id).select(PROJECT_FIELDS).maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, project: data });
    }

    if (action === "listOpenTasksForCapacity") {
      const { data, error } = await db
        .from("pm_tasks")
        .select(TASK_FIELDS)
        .neq("status", "done")
        .order("due_date", { ascending: true, nullsFirst: false });
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, tasks: data });
    }

    if (action === "listTasks") {
      const { project_id, assignee_id, household_id, contact_id, corporation_id, family_id, status, parent_task_id, professional_id } = body;
      let taggedTaskIds: string[] | null = null;
      if (professional_id) {
        const { data: tagged, error: tagErr } = await db
          .from("pm_task_collaborators")
          .select("task_id")
          .eq("professional_id", professional_id);
        if (tagErr) return json({ ok: false, error: tagErr.message }, 500);
        taggedTaskIds = (tagged || []).map((r: { task_id: string }) => r.task_id);
        if (taggedTaskIds.length === 0) return json({ ok: true, tasks: [] });
      }
      let q = db.from("pm_tasks").select(TASK_FIELDS).order("due_date", { ascending: true, nullsFirst: false });
      if (taggedTaskIds) q = q.in("id", taggedTaskIds);
      if (project_id) q = q.eq("project_id", project_id);
      if (assignee_id) q = q.eq("assignee_id", assignee_id === "me" ? userId : assignee_id);
      if (household_id) q = q.eq("household_id", household_id);
      if (contact_id) q = q.eq("contact_id", contact_id);
      if (corporation_id) q = q.eq("corporation_id", corporation_id);
      if (family_id) q = q.eq("family_id", family_id);
      if (status) q = q.eq("status", status);
      if (parent_task_id) q = q.eq("parent_task_id", parent_task_id);
      const { data, error } = await q;
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, tasks: data });
    }

    if (action === "createTask") {
      const { title, description, project_id, parent_task_id, due_date, assignee_id, household_id, contact_id, corporation_id, family_id, client_visible } = body;
      if (!String(title || "").trim()) return json({ ok: false, error: "Task title is required" }, 400);

      let resolvedHouseholdId = household_id || null;
      let resolvedFamilyId = family_id || null;
      if (contact_id && (!resolvedHouseholdId || !resolvedFamilyId)) {
        const { data: contact } = await db.from("contacts").select("household_id, family_id").eq("id", contact_id).maybeSingle();
        if (!resolvedHouseholdId) resolvedHouseholdId = contact?.household_id || null;
        if (!resolvedFamilyId) resolvedFamilyId = contact?.family_id || null;
      }
      if (!resolvedFamilyId && resolvedHouseholdId) {
        const { data: household } = await db.from("households").select("family_id").eq("id", resolvedHouseholdId).maybeSingle();
        resolvedFamilyId = household?.family_id || null;
      }

      const { data, error } = await db
        .from("pm_tasks")
        .insert({
          title: String(title).trim(),
          description: description || null,
          project_id: project_id || null,
          parent_task_id: parent_task_id || null,
          due_date: due_date || null,
          assignee_id: assignee_id || null,
          household_id: resolvedHouseholdId,
          contact_id: contact_id || null,
          corporation_id: corporation_id || null,
          family_id: resolvedFamilyId,
          ...(typeof client_visible === "boolean" ? { client_visible } : {}),
          created_by: userId,
        })
        .select(TASK_FIELDS)
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, task: data });
    }

    if (action === "updateTask") {
      const { id, ...updates } = body;
      if (!id) return json({ ok: false, error: "id is required" }, 400);
      const patch: Record<string, unknown> = {};
      for (const key of ["title", "description", "status", "due_date", "assignee_id", "assigned_agent_key", "client_visible", "family_id"]) {
        if (key in updates) patch[key] = updates[key];
      }
      if (patch.status === "done") patch.completed_at = new Date().toISOString();
      else if ("status" in patch) patch.completed_at = null;
      // A task's owner is either a human (assignee_id) or an AI Teammate
      // (assigned_agent_key) -- never both. Enforced here, not a DB CHECK,
      // matching this table family's established "exactly one of X/Y"
      // convention (see pm_task_comments' author columns).
      if ("assigned_agent_key" in patch && patch.assigned_agent_key) patch.assignee_id = null;
      if ("assignee_id" in patch && patch.assignee_id) patch.assigned_agent_key = null;
      const { data, error } = await db.from("pm_tasks").update(patch).eq("id", id).select(TASK_FIELDS).maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, task: data });
    }

    if (action === "getTaskComments") {
      const { task_id } = body;
      if (!task_id) return json({ ok: false, error: "task_id is required" }, 400);
      const { data, error } = await db
        .from("pm_task_comments")
        .select("id, task_id, author_id, author_agent_key, body, created_at")
        .eq("task_id", task_id)
        .order("created_at", { ascending: true });
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, comments: data });
    }

    if (action === "postTaskComment") {
      const { task_id, body: text } = body;
      if (!task_id || !String(text || "").trim()) return json({ ok: false, error: "task_id and body are required" }, 400);
      const { data, error } = await db
        .from("pm_task_comments")
        .insert({ task_id, author_id: userId, body: String(text).trim() })
        .select("id, task_id, author_id, author_agent_key, body, created_at")
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, comment: data });
    }

    const COLLABORATOR_FIELDS =
      "id, task_id, professional_id, contact_id, tagged_by, created_at, professionals(id, full_name, firm, professional_type), contacts(id, first_name, last_name)";

    if (action === "listTaskCollaborators") {
      const { task_id } = body;
      if (!task_id) return json({ ok: false, error: "task_id is required" }, 400);
      const { data, error } = await db
        .from("pm_task_collaborators")
        .select(COLLABORATOR_FIELDS)
        .eq("task_id", task_id)
        .order("created_at", { ascending: true });
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, collaborators: data });
    }

    if (action === "tagProfessional") {
      const { task_id, professional_id } = body;
      if (!task_id || !professional_id) return json({ ok: false, error: "task_id and professional_id are required" }, 400);
      const { error: insertErr } = await db
        .from("pm_task_collaborators")
        .insert({ task_id, professional_id, tagged_by: userId });
      // Idempotent: a double-click / already-tagged row is not an error.
      if (insertErr && insertErr.code !== "23505") return json({ ok: false, error: insertErr.message }, 500);
      const { data, error } = await db
        .from("pm_task_collaborators")
        .select(COLLABORATOR_FIELDS)
        .eq("task_id", task_id)
        .eq("professional_id", professional_id)
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, collaborator: data });
    }

    if (action === "untagProfessional") {
      const { task_id, professional_id } = body;
      if (!task_id || !professional_id) return json({ ok: false, error: "task_id and professional_id are required" }, 400);
      const { error } = await db
        .from("pm_task_collaborators")
        .delete()
        .eq("task_id", task_id)
        .eq("professional_id", professional_id);
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === "tagContact") {
      const { task_id, contact_id } = body;
      if (!task_id || !contact_id) return json({ ok: false, error: "task_id and contact_id are required" }, 400);
      const { error: insertErr } = await db
        .from("pm_task_collaborators")
        .insert({ task_id, contact_id, tagged_by: userId });
      // Idempotent: a double-click / already-tagged row is not an error.
      if (insertErr && insertErr.code !== "23505") return json({ ok: false, error: insertErr.message }, 500);
      const { data, error } = await db
        .from("pm_task_collaborators")
        .select(COLLABORATOR_FIELDS)
        .eq("task_id", task_id)
        .eq("contact_id", contact_id)
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, collaborator: data });
    }

    if (action === "untagContact") {
      const { task_id, contact_id } = body;
      if (!task_id || !contact_id) return json({ ok: false, error: "task_id and contact_id are required" }, 400);
      const { error } = await db
        .from("pm_task_collaborators")
        .delete()
        .eq("task_id", task_id)
        .eq("contact_id", contact_id);
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true });
    }

    return json({ ok: false, error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    console.error("pm-service error:", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
