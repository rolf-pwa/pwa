import { useState } from "react";
import { toast } from "sonner";
import { BellOff } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Textarea } from "@/shared/components/ui/textarea";
import { supabase } from "@/shared/integrations/supabase/client";

interface Props { contactId: string; firstName?: string | null; flagged: boolean; note: string | null; onChanged: (patch: { no_automated_email: boolean; no_automated_email_note: string | null }) => void }

/**
 * "Do not email": Georgia never emails this person (review invitations, reminders, balance notices, onboarding). Where she would have,
 * the matter comes to a person instead. The note says why, so it is clear on the record.
 */
export function NoAutomatedEmailControl({ contactId, firstName, flagged, note, onChanged }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note ?? "");
  const [saving, setSaving] = useState(false);

  const save = async (next: boolean, nextNote: string | null) => {
    setSaving(true);
    const patch = { no_automated_email: next, no_automated_email_note: nextNote, no_automated_email_at: next ? new Date().toISOString() : null };
    const { error } = await supabase.from("contacts").update(patch as any).eq("id", contactId);
    setSaving(false);
    if (error) { toast.error("Couldn't save that"); return; }
    onChanged({ no_automated_email: next, no_automated_email_note: nextNote });
    setEditing(false);
    toast.success(next ? "Georgia will not email them" : "Georgia may email them again");
  };

  if (flagged && !editing) {
    return (
      <div className="mt-2 flex flex-wrap items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/[0.06] px-3 py-2 text-xs" role="note">
        <BellOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">Do not email{firstName ? `: ${firstName}` : ""}</p>
          <p className="text-muted-foreground">{note || "Georgia does not email this person. A person follows up instead."}</p>
        </div>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => { setDraft(note ?? ""); setEditing(true); }}>Edit</Button>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={saving} onClick={() => save(false, null)}>Allow emails</Button>
      </div>
    );
  }
  if (editing) {
    return (
      <div className="mt-2 space-y-2 rounded-md border border-border p-3">
        <p className="text-xs font-medium">Georgia will not email {firstName || "this person"}. Add a note for the record.</p>
        <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder="e.g. Prefers a phone call. Rolf contacts them personally." className="text-sm" />
        <div className="flex gap-2">
          <Button size="sm" disabled={saving} onClick={() => save(true, draft.trim() || null)}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      </div>
    );
  }
  return (
    <button type="button" onClick={() => { setDraft(""); setEditing(true); }} className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
      <BellOff className="h-3 w-3" /> Mark as do not email
    </button>
  );
}
