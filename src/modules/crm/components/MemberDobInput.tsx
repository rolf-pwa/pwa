import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/shared/integrations/supabase/client";

/** True for a plausible birth date: YYYY-MM-DD, after 1900 and not in the future. Empty clears the date. */
export function isValidDob(v: string, today = new Date().toISOString().slice(0, 10)): boolean {
  return v === "" || (/^\d{4}-\d{2}-\d{2}$/.test(v) && v >= "1900-01-01" && v <= today);
}

/** A date of birth that is edited in place: no need to open the contact. Saves when the field loses focus or Enter is pressed. */
export function MemberDobInput({ contactId, value, onSaved }: { contactId: string; value: string | null; onSaved?: (v: string | null) => void }) {
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(value ?? ""), [value]);

  const save = async () => {
    if (draft === (value ?? "")) return;
    if (!isValidDob(draft)) { toast.error("Enter a valid date of birth"); setDraft(value ?? ""); return; }
    setSaving(true);
    const { error } = await supabase.from("contacts").update({ date_of_birth: draft || null } as any).eq("id", contactId);
    setSaving(false);
    if (error) { toast.error("Couldn't save the date of birth"); setDraft(value ?? ""); return; }
    toast.success("Date of birth saved");
    onSaved?.(draft || null);
  };

  return (
    <input
      type="date"
      aria-label="Date of birth"
      value={draft}
      disabled={saving}
      min="1900-01-01"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className="h-8 rounded-md border border-transparent bg-transparent px-2 text-sm text-foreground/80 hover:border-input focus:border-input focus:bg-background focus:outline-none"
    />
  );
}
