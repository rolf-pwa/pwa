import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/shared/components/ui/input";
import { getTaskAgent } from "@/shared/lib/agents";
import type { PmTask } from "@/shared/lib/agents";

/** A task's title: click it to rename; Enter or leaving the box saves, Escape puts it back. */
export function EditableTaskTitle({ task, onSaved }: { task: PmTask; onSaved: (t: PmTask) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(task.title);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setValue(task.title); setEditing(false); }, [task.id, task.title]);
  const save = async () => {
    const next = value.trim();
    if (!next || next === task.title) { setValue(task.title); setEditing(false); return; }
    setSaving(true);
    try {
      const updated = await getTaskAgent().updateTask(task.id, { title: next });
      onSaved({ ...task, ...updated, title: next });
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not rename the task.");
      setValue(task.title);
      setEditing(false);
    } finally { setSaving(false); }
  };
  if (editing) {
    return (
      <Input autoFocus value={value} disabled={saving} aria-label="Task title" data-testid="task-title-input" className="h-9 text-lg font-semibold"
        onChange={(e) => setValue(e.target.value)} onBlur={() => void save()}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } if (e.key === "Escape") { setValue(task.title); setEditing(false); } }} />
    );
  }
  return (
    <button type="button" onClick={() => setEditing(true)} title="Click to rename" data-testid="task-title" className="group flex w-full items-start gap-2 rounded text-left hover:bg-muted/50">
      <h2 className="text-lg font-semibold">{task.title}</h2>
      <Pencil className="mt-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}
