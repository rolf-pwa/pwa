// pm-ai-teammate-run — runs one AI Teammate draft for a pm_tasks row.
//
// Single-shot only: one Vertex call per invocation, no multi-turn/agentic
// loop. The output always lands as a new internal subtask + a comment on
// the parent task for staff to review -- nothing is ever auto-approved or
// made client-visible. See the plan doc for the full design rationale.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateVertexContent, parseServiceAccountKey } from "../_shared/vertex-ai.ts";

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

const AI_TEAMMATE_LABEL: Record<string, string> = {
  pm_teammate: "PM Teammate",
};

const PM_TEAMMATE_TOOL_SCHEMA = {
  functionDeclarations: [
    {
      name: "draft_task_output",
      description: "Produce a first-pass draft for the given PM task, to be reviewed by staff before any further action.",
      parameters: {
        type: "OBJECT",
        properties: {
          summary: { type: "STRING", description: "One or two sentences summarizing what you drafted, for a comment on the original task." },
          subtask_title: { type: "STRING", description: "A short title for the new subtask that will hold your draft." },
          subtask_body: { type: "STRING", description: "The actual draft content (research notes, a plan, first-pass copy, etc.), as plain text." },
          assumptions: { type: "STRING", description: "What you assumed given incomplete information, if anything. Omit if none." },
          open_questions: { type: "STRING", description: "What's still missing or unclear that staff should resolve. Omit if none." },
        },
        required: ["summary", "subtask_title", "subtask_body"],
      },
    },
  ],
};

function taskLink(task: { contact_id: string | null; household_id: string | null; family_id: string | null; project_id: string | null }) {
  return task.contact_id
    ? `/contacts/${task.contact_id}`
    : task.household_id
      ? `/households/${task.household_id}`
      : task.family_id
        ? `/families/${task.family_id}`
        : task.project_id
          ? `/projects/${task.project_id}`
          : null;
}

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
    const taskId = String(body?.task_id || "");
    if (!taskId) return json({ ok: false, error: "task_id is required" }, 400);

    const { data: task, error: taskErr } = await db
      .from("pm_tasks")
      .select(
        "id, project_id, parent_task_id, title, description, status, due_date, assigned_agent_key, household_id, contact_id, corporation_id, family_id, client_visible",
      )
      .eq("id", taskId)
      .maybeSingle();
    if (taskErr) return json({ ok: false, error: taskErr.message }, 500);
    if (!task) return json({ ok: false, error: "Task not found" }, 404);
    if (!task.assigned_agent_key) {
      return json({ ok: false, error: "This task is not assigned to an AI Teammate" }, 400);
    }
    const agentKey = task.assigned_agent_key;
    const agentLabel = AI_TEAMMATE_LABEL[agentKey] || agentKey;

    const [projectRes, subtasksRes, commentsRes, contactRes, householdRes, familyRes] = await Promise.all([
      task.project_id ? db.from("pm_projects").select("name").eq("id", task.project_id).maybeSingle() : Promise.resolve({ data: null }),
      db.from("pm_tasks").select("title, status").eq("parent_task_id", taskId).order("created_at", { ascending: true }),
      db
        .from("pm_task_comments")
        .select("body, author_id, author_contact_id, author_professional_id, author_agent_key, created_at")
        .eq("task_id", taskId)
        .order("created_at", { ascending: false })
        .limit(10),
      task.contact_id ? db.from("contacts").select("first_name, last_name").eq("id", task.contact_id).maybeSingle() : Promise.resolve({ data: null }),
      task.household_id ? db.from("households").select("label").eq("id", task.household_id).maybeSingle() : Promise.resolve({ data: null }),
      task.family_id ? db.from("families").select("name").eq("id", task.family_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);

    const { data: run, error: runErr } = await db
      .from("pm_ai_teammate_runs")
      .insert({ task_id: taskId, agent_key: agentKey, status: "running", requested_by: userId })
      .select("*")
      .maybeSingle();
    if (runErr || !run) return json({ ok: false, error: runErr?.message || "Failed to start run" }, 500);

    const markError = async (message: string) => {
      await db.from("pm_ai_teammate_runs").update({ status: "error", error_message: message, completed_at: new Date().toISOString() }).eq("id", run.id);
    };

    try {
      const contact = (contactRes as { data: { first_name: string; last_name: string | null } | null }).data;
      const household = (householdRes as { data: { label: string } | null }).data;
      const family = (familyRes as { data: { name: string } | null }).data;
      const project = (projectRes as { data: { name: string } | null }).data;
      const subtasks = (subtasksRes.data as { title: string; status: string }[]) || [];
      const comments = ((commentsRes.data as { body: string; author_id: string | null; author_contact_id: string | null; author_professional_id: string | null; author_agent_key: string | null; created_at: string }[]) || []).reverse();

      const lines: string[] = [];
      lines.push(`Task: ${task.title}`);
      if (task.description) lines.push(`Description: ${task.description}`);
      lines.push(`Status: ${task.status}${task.due_date ? `, due ${task.due_date}` : ""}`);
      if (project) lines.push(`Project: ${project.name}`);
      if (contact) lines.push(`Contact: ${contact.first_name} ${contact.last_name || ""}`.trim());
      if (household) lines.push(`Household: ${household.label}`);
      if (family) lines.push(`Family: ${family.name}`);
      if (subtasks.length) {
        lines.push("Existing subtasks:");
        for (const s of subtasks) lines.push(`  - [${s.status}] ${s.title}`);
      }
      if (comments.length) {
        lines.push("Recent comments (oldest first):");
        for (const c of comments) {
          const who = c.author_agent_key ? AI_TEAMMATE_LABEL[c.author_agent_key] || c.author_agent_key : c.author_contact_id ? "Client" : c.author_professional_id ? "Professional" : "Staff";
          lines.push(`  - ${who}: ${c.body}`);
        }
      }
      const facts = lines.join("\n");

      const prompt = `You are the "${agentLabel}" AI Teammate on ProsperWise's internal project-management system. Staff assigned you the task below and asked you to produce a first-pass draft they can review, edit, and approve -- you never take final action yourself.

Rules:
- Never invent facts about the client or firm not present below.
- If information is missing, say so plainly in "open_questions" rather than guessing silently.
- Keep the draft focused and directly useful for finishing this specific task.
Call draft_task_output with your draft.

Task context:
${facts}`;

      const sa = await parseServiceAccountKey(Deno.env.get("GCP_SERVICE_ACCOUNT_KEY"));
      const result = await generateVertexContent(
        sa,
        "gemini-2.5-flash",
        [{ role: "user", parts: [{ text: prompt }] }],
        { temperature: 0.4, maxOutputTokens: 4096 },
        { tools: [PM_TEAMMATE_TOOL_SCHEMA], toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["draft_task_output"] } } },
      );

      // deno-lint-ignore no-explicit-any
      const parts = result.candidates?.[0]?.content?.parts || [];
      // deno-lint-ignore no-explicit-any
      const fnCall = parts.find((p: any) => p.functionCall)?.functionCall;
      if (!fnCall?.args?.subtask_title || !fnCall?.args?.subtask_body || !fnCall?.args?.summary) {
        throw new Error("The AI Teammate did not return a usable draft.");
      }
      const args = fnCall.args as { summary: string; subtask_title: string; subtask_body: string; assumptions?: string; open_questions?: string };

      let subtaskBody = args.subtask_body;
      if (args.assumptions) subtaskBody += `\n\nAssumptions: ${args.assumptions}`;
      if (args.open_questions) subtaskBody += `\n\nOpen questions: ${args.open_questions}`;

      const { data: subtask, error: subtaskErr } = await db
        .from("pm_tasks")
        .insert({
          parent_task_id: taskId,
          project_id: task.project_id,
          household_id: task.household_id,
          contact_id: task.contact_id,
          corporation_id: task.corporation_id,
          family_id: task.family_id,
          title: args.subtask_title,
          description: subtaskBody,
          status: "open",
          client_visible: false,
          created_by: userId,
        })
        .select("*")
        .maybeSingle();
      if (subtaskErr || !subtask) throw new Error(subtaskErr?.message || "Failed to create draft subtask");

      const { data: comment, error: commentErr } = await db
        .from("pm_task_comments")
        .insert({
          task_id: taskId,
          author_agent_key: agentKey,
          body: `${args.summary}\n\nSee the new subtask "${args.subtask_title}" for the full draft.`,
        })
        .select("*")
        .maybeSingle();
      if (commentErr || !comment) throw new Error(commentErr?.message || "Failed to post draft comment");

      await db
        .from("pm_ai_teammate_runs")
        .update({
          status: "complete",
          result_subtask_id: subtask.id,
          result_comment_id: comment.id,
          completed_at: new Date().toISOString(),
        })
        .eq("id", run.id);

      try {
        await db.from("staff_notifications").insert({
          source_type: "ai_teammate_draft",
          title: `${agentLabel} drafted "${args.subtask_title}"`,
          body: args.summary.length > 200 ? args.summary.slice(0, 200) + "…" : args.summary,
          contact_id: task.contact_id || null,
          link: taskLink(task),
        });
      } catch {
        /* noop — notification failure should never fail the run */
      }

      return json({ ok: true, run: { ...run, status: "complete", result_subtask_id: subtask.id, result_comment_id: comment.id }, subtask, comment });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await markError(message);
      return json({ ok: false, error: message }, 500);
    }
  } catch (e) {
    console.error("pm-ai-teammate-run error:", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
