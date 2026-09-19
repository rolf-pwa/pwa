import { useState } from "react";
import { Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import type { NextGenMilestone, Perspective4Draft } from "../../hooks/useCharterIntake";
import { FieldWithSuggestion } from "./StepFiduciaryGuidance";

const STATUS_LABEL: Record<NextGenMilestone["status"], string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  complete: "Complete",
};

interface Props {
  identityTransitionNote: string | null;
  milestones: NextGenMilestone[];
  draft: Perspective4Draft | null;
  drafting: boolean;
  saving: boolean;
  onDraft: () => void;
  onSave: (identityTransitionNote: string, milestones: NextGenMilestone[]) => void;
}

export function StepIdentityTransitionNextGen({
  identityTransitionNote,
  milestones,
  draft,
  drafting,
  saving,
  onDraft,
  onSave,
}: Props) {
  const [note, setNote] = useState(identityTransitionNote ?? "");
  const [rows, setRows] = useState<NextGenMilestone[]>(milestones);

  const addRow = () =>
    setRows((prev) => [
      ...prev,
      { id: crypto.randomUUID(), member_name: "", milestone_title: "", status: "not_started", target_date: null, notes: null },
    ]);
  const updateRow = (id: string, patch: Partial<NextGenMilestone>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id: string) => setRows((prev) => prev.filter((r) => r.id !== id));

  const completedCount = rows.filter((r) => r.status === "complete").length;
  const completionPct = rows.length > 0 ? Math.round((completedCount / rows.length) * 100) : 0;

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="space-y-1.5">
          <h2 className="font-serif text-lg font-semibold text-foreground">Identity Transition &amp; Next-Gen Milestones</h2>
          <p className="text-sm text-muted-foreground">
            The psychological and governance shift from operator to Chairman of the family balance sheet,
            and a staff-maintained checklist of financial-literacy and apprenticeship milestones for rising
            generations. This CRM has no birthdate data, so age-based triggers (e.g. observer seats at 21)
            aren't automated — staff track applicability directly.
          </p>
        </div>

        <Button variant="outline" size="sm" disabled={drafting} onClick={onDraft}>
          {drafting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
          Draft with AI
        </Button>

        <FieldWithSuggestion
          id="identity-transition"
          label="OpCo-to-WealthCo Identity Transition"
          value={note}
          onChange={setNote}
          suggestion={draft?.identity_transition_note}
        />

        <div className="space-y-2 border-t border-border pt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Next-Gen Milestones
            </h3>
            {rows.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {completedCount} of {rows.length} complete ({completionPct}%)
              </p>
            )}
          </div>

          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No milestones added yet.</p>
          ) : (
            <div className="space-y-2">
              {rows.map((r) => (
                <div key={r.id} className="grid grid-cols-[1fr_1fr_auto_auto] items-end gap-2 rounded-md border border-border bg-muted/30 p-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Family Member</Label>
                    <Input value={r.member_name} onChange={(e) => updateRow(r.id, { member_name: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Milestone</Label>
                    <Input value={r.milestone_title} onChange={(e) => updateRow(r.id, { milestone_title: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Status</Label>
                    <Select value={r.status} onValueChange={(v) => updateRow(r.id, { status: v as NextGenMilestone["status"] })}>
                      <SelectTrigger className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(STATUS_LABEL) as NextGenMilestone["status"][]).map((s) => (
                          <SelectItem key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => removeRow(r.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Milestone
          </Button>
        </div>

        <Button disabled={saving} onClick={() => onSave(note, rows)}>
          Save and continue
        </Button>
      </CardContent>
    </Card>
  );
}
