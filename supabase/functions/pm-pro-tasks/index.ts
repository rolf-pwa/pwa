// Pro Portal task view, backed by pm_tasks/pm_task_comments/pm_task_collaborators
// instead of Asana. The sole authorization gate for every task-scoped action
// is an explicit pm_task_collaborators row tagging this professional — set
// either by staff (TaskDetailPanel's "Tagged Professionals" picker) or by the
// pro themselves (self-tagged when they create a task here). scope_type/
// scope_id only ever narrow which of a pro's own tagged tasks are shown for a
// given page — they can never widen access to another pro's tasks.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateProSession } from "../_shared/pro-portal-auth.ts";

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
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-pro-session, x-region",
  };
}

const TASK_FIELDS =
  "id, parent_task_id, title, description, status, due_date, completed_at, household_id, contact_id, family_id, project_id, created_at, updated_at";

type ScopeType = "family" | "household" | "contact" | "portfolio";
type Context = { label: string; path: string } | null;

// Resolve a display label + Pro Portal link for a scope, preferring the
// household (what a pro actually navigates by) even when the engagement
// itself is contact- or family-scoped. Ported verbatim from
// pro-portal-tasks/index.ts — same resolution semantics, no Asana involved.
async function resolveContext(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  scopeType: "family" | "household" | "contact",
  scopeId: string,
): Promise<Context> {
  if (scopeType === "contact") {
    const { data: c } = await supabase
      .from("contacts")
      .select("first_name, last_name, full_name, household_id, family_id")
      .eq("id", scopeId)
      .maybeSingle();
    if (!c) return null;
    if (c.household_id) return resolveContext(supabase, "household", c.household_id);
    if (c.family_id) return resolveContext(supabase, "family", c.family_id);
    const name = c.full_name || `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Contact";
    return { label: name, path: `/pro-portal/contact/${scopeId}` };
  }
  if (scopeType === "household") {
    const { data: hh } = await supabase.from("households").select("label").eq("id", scopeId).maybeSingle();
    if (!hh) return null;
    return { label: hh.label || "Household", path: `/pro-portal/household/${scopeId}` };
  }
  if (scopeType === "family") {
    const { data: fam } = await supabase.from("families").select("name").eq("id", scopeId).maybeSingle();
    if (!fam) return null;
    return { label: fam.name || "Family", path: `/pro-portal/family/${scopeId}` };
  }
  return null;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const session = await validateProSession(supabase, req.headers.get("x-pro-session"));
    if (!session) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const { action, task_id } = body;

    // Verifies a task_id is actually tagged to this professional before
    // letting a request read/write anything scoped to it — never trust a
    // pro-supplied task id blindly.
    const taskTaggedForPro = async (id: string) => {
      const { data: tag } = await supabase
        .from("pm_task_collaborators")
        .select("id")
        .eq("task_id", id)
        .eq("professional_id", session.professional_id)
        .maybeSingle();
      if (!tag) return null;
      const { data: task } = await supabase.from("pm_tasks").select(TASK_FIELDS).eq("id", id).maybeSingle();
      return task;
    };

    if (action === "list") {
      const scopeType = body.scope_type as ScopeType | undefined;
      const scopeId = body.scope_id as string | undefined;

      const { data: taggedRows, error: tagErr } = await supabase
        .from("pm_task_collaborators")
        .select("task_id")
        .eq("professional_id", session.professional_id);
      if (tagErr) return json({ error: tagErr.message }, 500);
      // deno-lint-ignore no-explicit-any
      const taggedIds = (taggedRows || []).map((r: any) => r.task_id);
      if (taggedIds.length === 0) return json({ tasks: [] });

      const { data: allTasks, error: taskErr } = await supabase
        .from("pm_tasks")
        .select(TASK_FIELDS)
        .in("id", taggedIds)
        .is("parent_task_id", null)
        .order("due_date", { ascending: true, nullsFirst: false });
      if (taskErr) return json({ error: taskErr.message }, 500);
      // deno-lint-ignore no-explicit-any
      let tasks: any[] = allTasks || [];

      if (scopeType === "portfolio") {
        const { data: engagements } = await supabase
          .from("professional_engagements")
          .select("scope_type, scope_id")
          .eq("professional_id", session.professional_id)
          .eq("status", "active");

        const contextMap = new Map<string, Context>();
        const setIfAbsent = (key: string, ctx: Context) => {
          if (!contextMap.has(key)) contextMap.set(key, ctx);
        };

        for (const e of engagements || []) {
          const ctx = await resolveContext(supabase, e.scope_type, e.scope_id);
          setIfAbsent(`${e.scope_type}:${e.scope_id}`, ctx);
          if (e.scope_type === "family") {
            const { data: hhs } = await supabase.from("households").select("id").eq("family_id", e.scope_id);
            // deno-lint-ignore no-explicit-any
            for (const hh of hhs || []) setIfAbsent(`household:${(hh as any).id}`, ctx);
            const { data: directContacts } = await supabase
              .from("contacts").select("id").eq("family_id", e.scope_id).is("household_id", null);
            // deno-lint-ignore no-explicit-any
            for (const c of directContacts || []) setIfAbsent(`contact:${(c as any).id}`, ctx);
          }
          if (e.scope_type === "household") {
            const { data: members } = await supabase.from("contacts").select("id").eq("household_id", e.scope_id);
            // deno-lint-ignore no-explicit-any
            for (const c of members || []) setIfAbsent(`contact:${(c as any).id}`, ctx);
          }
        }

        tasks = tasks.map((t) => {
          const key = t.family_id
            ? `family:${t.family_id}`
            : t.household_id
              ? `household:${t.household_id}`
              : t.contact_id
                ? `contact:${t.contact_id}`
                : null;
          return { ...t, context: key ? contextMap.get(key) ?? null : null };
        });
      } else if (scopeType === "household" && scopeId) {
        tasks = tasks.filter((t) => t.household_id === scopeId);
      } else if (scopeType === "contact" && scopeId) {
        tasks = tasks.filter((t) => t.contact_id === scopeId);
      } else if (scopeType === "family" && scopeId) {
        // Aggregate, not a bare family_id match: a family-engaged pro should
        // see tasks tagged to them anywhere under that family (household- or
        // contact-scoped), not just tasks created directly at family level.
        const { data: hhs } = await supabase.from("households").select("id").eq("family_id", scopeId);
        // deno-lint-ignore no-explicit-any
        const hhIds = new Set((hhs || []).map((h: any) => h.id));
        const { data: directContacts } = await supabase
          .from("contacts").select("id").eq("family_id", scopeId).is("household_id", null);
        // deno-lint-ignore no-explicit-any
        const directContactIds = new Set((directContacts || []).map((c: any) => c.id));
        tasks = tasks.filter(
          (t) =>
            t.family_id === scopeId ||
            (t.household_id && hhIds.has(t.household_id)) ||
            (t.contact_id && directContactIds.has(t.contact_id)),
        );
      }

      return json({ tasks });
    }

    if (action === "comments") {
      if (!task_id) return json({ error: "task_id is required" }, 400);
      const task = await taskTaggedForPro(task_id);
      if (!task) return json({ error: "Not found" }, 404);

      const { data: comments, error } = await supabase
        .from("pm_task_comments")
        .select("id, task_id, author_id, author_contact_id, author_professional_id, body, created_at")
        .eq("task_id", task_id)
        .order("created_at", { ascending: true });
      if (error) return json({ error: error.message }, 500);

      // deno-lint-ignore no-explicit-any
      const rows = comments || [];
      const staffIds = [...new Set(rows.filter((c) => c.author_id).map((c) => c.author_id))];
      const clientIds = [...new Set(rows.filter((c) => c.author_contact_id).map((c) => c.author_contact_id))];
      const proIds = [...new Set(rows.filter((c) => c.author_professional_id).map((c) => c.author_professional_id))];
      const [{ data: staff }, { data: clients }, { data: pros }] = await Promise.all([
        staffIds.length ? supabase.from("profiles").select("user_id, full_name").in("user_id", staffIds) : Promise.resolve({ data: [] }),
        clientIds.length ? supabase.from("contacts").select("id, first_name, last_name").in("id", clientIds) : Promise.resolve({ data: [] }),
        proIds.length ? supabase.from("professionals").select("id, full_name").in("id", proIds) : Promise.resolve({ data: [] }),
      ]);
      // deno-lint-ignore no-explicit-any
      const staffById = new Map((staff || []).map((s: any) => [s.user_id, s.full_name]));
      // deno-lint-ignore no-explicit-any
      const contactById = new Map((clients || []).map((c: any) => [c.id, `${c.first_name} ${c.last_name || ""}`.trim()]));
      // deno-lint-ignore no-explicit-any
      const proById = new Map((pros || []).map((p: any) => [p.id, p.full_name]));

      const resolved = rows.map((c) => {
        const author_type = c.author_id ? "staff" : c.author_contact_id ? "client" : "pro";
        const author_name =
          author_type === "staff"
            ? staffById.get(c.author_id) || "ProsperWise"
            : author_type === "client"
              ? contactById.get(c.author_contact_id) || "Client"
              : proById.get(c.author_professional_id) || session.professional.full_name;
        return { id: c.id, task_id: c.task_id, body: c.body, created_at: c.created_at, author_type, author_name };
      });
      return json({ comments: resolved });
    }

    if (action === "postComment") {
      const commentBody = body.body as string;
      if (!task_id || !String(commentBody || "").trim()) return json({ error: "task_id and body are required" }, 400);
      const task = await taskTaggedForPro(task_id);
      if (!task) return json({ error: "Not found" }, 404);

      const { data, error } = await supabase
        .from("pm_task_comments")
        .insert({ task_id, author_professional_id: session.professional_id, body: String(commentBody).trim() })
        .select("id, task_id, body, created_at")
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);

      try {
        const trimmedBody = String(commentBody).trim();
        await supabase.from("staff_notifications").insert({
          source_type: "task_comment",
          title: `${session.professional.full_name} commented on "${task.title}"`,
          body: trimmedBody.length > 100 ? trimmedBody.slice(0, 100) + "…" : trimmedBody,
          contact_id: task.contact_id || null,
          link: task.contact_id
            ? `/contacts/${task.contact_id}`
            : task.household_id
              ? `/households/${task.household_id}`
              : task.family_id
                ? `/families/${task.family_id}`
                : task.project_id
                  ? `/projects/${task.project_id}`
                  : null,
        });
      } catch {
        /* noop — notification failure should never block the comment itself */
      }

      return json({ comment: { ...data, author_type: "pro", author_name: session.professional.full_name } });
    }

    if (action === "complete") {
      const completed = body.completed !== false;
      if (!task_id) return json({ error: "task_id is required" }, 400);
      const task = await taskTaggedForPro(task_id);
      if (!task) return json({ error: "Not found" }, 404);

      const { error } = await supabase
        .from("pm_tasks")
        .update({ status: completed ? "done" : "open", completed_at: completed ? new Date().toISOString() : null })
        .eq("id", task_id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === "create") {
      const scopeType = body.scope_type as "family" | "household" | "contact";
      const scopeId = body.scope_id as string;
      const title = ((body.title as string) || "").trim();
      const notes = ((body.notes as string) || "").trim();
      if (!scopeType || !scopeId || !title) return json({ error: "scope + title required" }, 400);

      let household_id: string | null = null;
      let contact_id: string | null = null;
      let family_id: string | null = null;

      if (scopeType === "contact") {
        contact_id = scopeId;
        const { data: c } = await supabase.from("contacts").select("household_id, family_id").eq("id", scopeId).maybeSingle();
        household_id = c?.household_id || null;
        family_id = c?.family_id || null;
      } else if (scopeType === "household") {
        household_id = scopeId;
        const { data: hh } = await supabase.from("households").select("family_id").eq("id", scopeId).maybeSingle();
        family_id = hh?.family_id || null;
      } else if (scopeType === "family") {
        family_id = scopeId;
      }

      const { data: task, error } = await supabase
        .from("pm_tasks")
        .insert({
          title,
          description: notes || null,
          household_id,
          contact_id,
          family_id,
          // Internal by default — staff must explicitly opt a pro-created
          // task into client visibility via the existing toggle.
          client_visible: false,
          created_by: session.professional_id,
        })
        .select(TASK_FIELDS)
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);

      const { error: tagErr } = await supabase
        .from("pm_task_collaborators")
        .insert({ task_id: task.id, professional_id: session.professional_id, tagged_by: null });
      if (tagErr) return json({ error: tagErr.message }, 500);

      try {
        await supabase.from("staff_notifications").insert({
          source_type: "pro_request",
          title: `New pro request: ${title}`,
          body: `${session.professional.full_name} opened a task via the Pro Portal.`,
          contact_id: contact_id || null,
          link: contact_id
            ? `/contacts/${contact_id}`
            : household_id
              ? `/households/${household_id}`
              : family_id
                ? `/families/${family_id}`
                : null,
        });
      } catch {
        /* noop — notification failure should never block task creation */
      }

      return json({ ok: true, task });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    console.error("pm-pro-tasks error:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
