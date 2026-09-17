import { useEffect, useState } from "react";
import { Textarea } from "@/shared/components/ui/textarea";
import { Input } from "@/shared/components/ui/input";
import { Button } from "@/shared/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { Switch } from "@/shared/components/ui/switch";
import { Loader2, Send, Plus, Eye, EyeOff, X } from "lucide-react";
import { toast } from "sonner";
import { getTaskAgent } from "@/shared/lib/agents";
import type { PmTask, PmTaskCollaborator, PmTaskComment } from "@/shared/lib/agents";
import { StaffAssigneePicker } from "./StaffAssigneePicker";
import { ProfessionalPicker } from "./ProfessionalPicker";
import { HouseholdMemberPicker } from "./HouseholdMemberPicker";
import { supabase } from "@/shared/integrations/supabase/client";
import { cn } from "@/shared/lib/utils";

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  done: "Done",
};

interface Props {
  task: PmTask;
  onChanged: (task: PmTask) => void;
}

export function TaskDetailPanel({ task, onChanged }: Props) {
  const [description, setDescription] = useState(task.description || "");
  const [comments, setComments] = useState<PmTaskComment[]>([]);
  const [authorNames, setAuthorNames] = useState<Record<string, string>>({});
  const [commentBody, setCommentBody] = useState("");
  const [loadingComments, setLoadingComments] = useState(true);
  const [sending, setSending] = useState(false);
  const [subtasks, setSubtasks] = useState<PmTask[]>([]);
  const [loadingSubtasks, setLoadingSubtasks] = useState(true);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [collaborators, setCollaborators] = useState<PmTaskCollaborator[]>([]);
  const [loadingTaggedPros, setLoadingTaggedPros] = useState(true);
  const taggedPros = collaborators.filter((c) => c.professional_id);
  const taggedContacts = collaborators.filter((c) => c.contact_id);

  useEffect(() => {
    setDescription(task.description || "");
  }, [task.id]);

  useEffect(() => {
    let cancelled = false;
    setLoadingSubtasks(true);
    getTaskAgent()
      .listTasks({ parent_task_id: task.id })
      .then((data) => {
        if (!cancelled) setSubtasks(data);
      })
      .finally(() => !cancelled && setLoadingSubtasks(false));
    return () => {
      cancelled = true;
    };
  }, [task.id]);

  useEffect(() => {
    let cancelled = false;
    setLoadingTaggedPros(true);
    getTaskAgent()
      .listTaskCollaborators(task.id)
      .then((data) => {
        if (!cancelled) setCollaborators(data);
      })
      .finally(() => !cancelled && setLoadingTaggedPros(false));
    return () => {
      cancelled = true;
    };
  }, [task.id]);

  useEffect(() => {
    let cancelled = false;
    setLoadingComments(true);
    getTaskAgent()
      .getTaskComments(task.id)
      .then(async (data) => {
        if (cancelled) return;
        setComments(data);
        const ids = Array.from(new Set(data.map((c) => c.author_id)));
        if (ids.length) {
          const { data: profiles } = await supabase.from("profiles").select("user_id, full_name, email").in("user_id", ids);
          if (!cancelled) {
            const map: Record<string, string> = {};
            for (const p of profiles || []) map[p.user_id] = p.full_name || p.email || p.user_id.slice(0, 8);
            setAuthorNames(map);
          }
        }
      })
      .finally(() => !cancelled && setLoadingComments(false));
    return () => {
      cancelled = true;
    };
  }, [task.id]);

  const saveDescription = async () => {
    if (description === (task.description || "")) return;
    try {
      const updated = await getTaskAgent().updateTask(task.id, { description });
      onChanged(updated);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the description.");
    }
  };

  const setStatus = async (status: string) => {
    try {
      const updated = await getTaskAgent().updateTask(task.id, { status });
      onChanged(updated);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update status.");
    }
  };

  const setDueDate = async (due_date: string) => {
    try {
      const updated = await getTaskAgent().updateTask(task.id, { due_date: due_date || null });
      onChanged(updated);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the due date.");
    }
  };

  const setAssignee = async (assignee_id: string | null) => {
    try {
      const updated = await getTaskAgent().updateTask(task.id, { assignee_id });
      onChanged(updated);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the assignee.");
    }
  };

  const setClientVisible = async (client_visible: boolean) => {
    try {
      const updated = await getTaskAgent().updateTask(task.id, { client_visible });
      onChanged(updated);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update visibility.");
    }
  };

  const toggleSubtask = async (sub: PmTask) => {
    try {
      const updated = await getTaskAgent().updateTask(sub.id, { status: sub.status === "done" ? "open" : "done" });
      setSubtasks((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update this subtask.");
    }
  };

  const addSubtask = async () => {
    if (!newSubtaskTitle.trim()) return;
    setAddingSubtask(true);
    try {
      const created = await getTaskAgent().createTask({
        title: newSubtaskTitle.trim(),
        parent_task_id: task.id,
        project_id: task.project_id ?? undefined,
        contact_id: task.contact_id ?? undefined,
        household_id: task.household_id ?? undefined,
        corporation_id: task.corporation_id ?? undefined,
      });
      setSubtasks((prev) => [...prev, created]);
      setNewSubtaskTitle("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add this subtask.");
    } finally {
      setAddingSubtask(false);
    }
  };

  const tagProfessional = async (professionalId: string) => {
    try {
      const created = await getTaskAgent().tagProfessional(task.id, professionalId);
      setCollaborators((prev) => [...prev, created]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not tag this professional.");
    }
  };

  const untagProfessional = async (professionalId: string) => {
    try {
      await getTaskAgent().untagProfessional(task.id, professionalId);
      setCollaborators((prev) => prev.filter((c) => c.professional_id !== professionalId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove this professional.");
    }
  };

  const tagContact = async (contactId: string) => {
    try {
      const created = await getTaskAgent().tagContact(task.id, contactId);
      setCollaborators((prev) => [...prev, created]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not tag this household member.");
    }
  };

  const untagContact = async (contactId: string) => {
    try {
      await getTaskAgent().untagContact(task.id, contactId);
      setCollaborators((prev) => prev.filter((c) => c.contact_id !== contactId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove this household member.");
    }
  };

  const postComment = async () => {
    if (!commentBody.trim()) return;
    setSending(true);
    try {
      const comment = await getTaskAgent().postTaskComment(task.id, commentBody.trim());
      setComments((prev) => [...prev, comment]);
      setCommentBody("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not post this comment.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4 border-t border-border pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={task.status} onValueChange={setStatus}>
          <SelectTrigger className="h-8 w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          className="h-8 w-[160px]"
          value={task.due_date || ""}
          onChange={(e) => setDueDate(e.target.value)}
        />
        <StaffAssigneePicker
          value={task.assignee_id}
          onChange={setAssignee}
          householdId={task.household_id}
          familyId={task.family_id}
        />
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          {task.client_visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          Client Visible
          <Switch checked={task.client_visible} onCheckedChange={setClientVisible} />
        </label>
      </div>

      <div className="space-y-1.5">
        <Textarea
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={saveDescription}
          placeholder="Notes…"
        />
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subtasks</h4>
        {loadingSubtasks ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : subtasks.length > 0 ? (
          <div className="space-y-1">
            {subtasks.map((sub) => (
              <label
                key={sub.id}
                className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted/50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={sub.status === "done"}
                  onChange={() => toggleSubtask(sub)}
                  className="h-3.5 w-3.5"
                />
                <span className={cn(sub.status === "done" && "text-muted-foreground line-through")}>{sub.title}</span>
              </label>
            ))}
          </div>
        ) : null}
        <div className="flex gap-2">
          <Input
            value={newSubtaskTitle}
            onChange={(e) => setNewSubtaskTitle(e.target.value)}
            placeholder="Add a subtask…"
            className="h-8 flex-1"
            onKeyDown={(e) => e.key === "Enter" && addSubtask()}
          />
          <Button size="sm" variant="outline" onClick={addSubtask} disabled={addingSubtask || !newSubtaskTitle.trim()}>
            {addingSubtask ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tagged Professionals</h4>
        {loadingTaggedPros ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : taggedPros.length > 0 ? (
          <div className="space-y-1">
            {taggedPros.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between rounded-md px-1.5 py-1 text-sm hover:bg-muted/50"
              >
                <span>
                  {c.professionals?.full_name}
                  {c.professionals?.firm ? ` · ${c.professionals.firm}` : ""}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={() => untagProfessional(c.professional_id)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        ) : null}
        <ProfessionalPicker excludeIds={taggedPros.map((c) => c.professional_id!)} onSelect={tagProfessional} />
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tagged Household Members</h4>
        {loadingTaggedPros ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : taggedContacts.length > 0 ? (
          <div className="space-y-1">
            {taggedContacts.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between rounded-md px-1.5 py-1 text-sm hover:bg-muted/50"
              >
                <span>
                  {c.contacts?.first_name} {c.contacts?.last_name || ""}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={() => untagContact(c.contact_id!)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        ) : null}
        <HouseholdMemberPicker
          householdId={task.household_id}
          familyId={task.family_id}
          excludeIds={[...taggedContacts.map((c) => c.contact_id!), ...(task.contact_id ? [task.contact_id] : [])]}
          onSelect={tagContact}
        />
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Comments</h4>
        {loadingComments ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No comments yet.</p>
        ) : (
          <div className="space-y-2">
            {comments.map((c) => (
              <div key={c.id} className="rounded-md bg-muted/50 p-2 text-sm">
                <div className="mb-0.5 text-xs font-medium text-muted-foreground">
                  {authorNames[c.author_id] || "Staff"} · {new Date(c.created_at).toLocaleString()}
                </div>
                <div className="whitespace-pre-wrap">{c.body}</div>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Textarea
            rows={2}
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            placeholder="Add a comment…"
            className="flex-1"
          />
          <Button size="icon" onClick={postComment} disabled={sending || !commentBody.trim()}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
