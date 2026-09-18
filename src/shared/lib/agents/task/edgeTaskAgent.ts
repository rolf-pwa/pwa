/**
 * Task agent adapter. UI never calls the edge function directly — it goes
 * through `getTaskAgent()` so the runtime can move (edge, Cloud Run) without
 * touching components.
 */
import { supabase } from "@/shared/integrations/supabase/client";
import type { ITaskAgentProvider, PmAiTeammateRun, PmProject, PmTask, PmTaskCollaborator, PmTaskComment, PmTaskFilter } from "../types";

async function invoke<T>(body: Record<string, unknown>, fn = "pm-service"): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    let details = error.message;
    try {
      const ctx = (error as unknown as { context?: Response }).context;
      if (ctx && typeof ctx.text === "function") {
        const text = await ctx.text();
        const parsed = JSON.parse(text);
        details = parsed?.error || text || details;
      }
    } catch {
      /* keep original message */
    }
    throw new Error(details);
  }
  const res = data as { ok: boolean; error?: string } & Record<string, unknown>;
  if (!res?.ok) throw new Error(res?.error || "The PM service could not complete this request.");
  return res as T;
}

export const edgeTaskAgent: ITaskAgentProvider = {
  id: "edge-task-agent",

  async listProjects(): Promise<PmProject[]> {
    const data = await invoke<{ projects: PmProject[] }>({ action: "listProjects" });
    return data.projects;
  },

  async createProject(input): Promise<PmProject> {
    const data = await invoke<{ project: PmProject }>({ action: "createProject", ...input });
    return data.project;
  },

  async updateProject(id, updates): Promise<PmProject> {
    const data = await invoke<{ project: PmProject }>({ action: "updateProject", id, ...updates });
    return data.project;
  },

  async listTasks(filter?: PmTaskFilter): Promise<PmTask[]> {
    const data = await invoke<{ tasks: PmTask[] }>({ action: "listTasks", ...filter });
    return data.tasks;
  },

  async createTask(input): Promise<PmTask> {
    const data = await invoke<{ task: PmTask }>({ action: "createTask", ...input });
    return data.task;
  },

  async updateTask(id, updates): Promise<PmTask> {
    const data = await invoke<{ task: PmTask }>({ action: "updateTask", id, ...updates });
    return data.task;
  },

  async getTaskComments(taskId): Promise<PmTaskComment[]> {
    const data = await invoke<{ comments: PmTaskComment[] }>({ action: "getTaskComments", task_id: taskId });
    return data.comments;
  },

  async postTaskComment(taskId, body): Promise<PmTaskComment> {
    const data = await invoke<{ comment: PmTaskComment }>({ action: "postTaskComment", task_id: taskId, body });
    return data.comment;
  },

  async listTaskCollaborators(taskId): Promise<PmTaskCollaborator[]> {
    const data = await invoke<{ collaborators: PmTaskCollaborator[] }>({ action: "listTaskCollaborators", task_id: taskId });
    return data.collaborators;
  },

  async tagProfessional(taskId, professionalId): Promise<PmTaskCollaborator> {
    const data = await invoke<{ collaborator: PmTaskCollaborator }>({
      action: "tagProfessional",
      task_id: taskId,
      professional_id: professionalId,
    });
    return data.collaborator;
  },

  async untagProfessional(taskId, professionalId): Promise<void> {
    await invoke<{ ok: boolean }>({ action: "untagProfessional", task_id: taskId, professional_id: professionalId });
  },

  async tagContact(taskId, contactId): Promise<PmTaskCollaborator> {
    const data = await invoke<{ collaborator: PmTaskCollaborator }>({
      action: "tagContact",
      task_id: taskId,
      contact_id: contactId,
    });
    return data.collaborator;
  },

  async untagContact(taskId, contactId): Promise<void> {
    await invoke<{ ok: boolean }>({ action: "untagContact", task_id: taskId, contact_id: contactId });
  },

  async runAiTeammate(taskId): Promise<{ run: PmAiTeammateRun; subtask: PmTask; comment: PmTaskComment }> {
    const data = await invoke<{ run: PmAiTeammateRun; subtask: PmTask; comment: PmTaskComment }>(
      { task_id: taskId },
      "pm-ai-teammate-run",
    );
    return data;
  },

  async listOpenTasksForCapacity(): Promise<PmTask[]> {
    const data = await invoke<{ tasks: PmTask[] }>({ action: "listOpenTasksForCapacity" });
    return data.tasks;
  },
};
