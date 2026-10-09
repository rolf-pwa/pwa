import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/shared/integrations/supabase/client";
import { Button } from "@/shared/components/ui/button";
import { Textarea } from "@/shared/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  email?: string | null;
}

/** Edit the signature added to emails sent from a contact record (profiles.email_signature, plain text). */
export function EmailSignatureDialog({ open, onOpenChange, userId, email }: Props) {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    supabase.from("profiles").select("email_signature").eq("user_id", userId).maybeSingle().then(({ data, error }) => {
      if (cancelled) return;
      if (error) toast.error("Couldn't load your signature");
      setValue(data?.email_signature ?? "");
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, userId]);

  const save = async () => {
    setSaving(true);
    const signature = value.trim() || null;
    const { data, error } = await supabase.from("profiles").update({ email_signature: signature }).eq("user_id", userId).select("user_id");
    let failed = error;
    if (!error && (data?.length ?? 0) === 0) {
      // No profile row yet for this login: create it.
      ({ error: failed } = await supabase.from("profiles").insert({ user_id: userId, email: email ?? null, email_signature: signature }));
    }
    setSaving(false);
    if (failed) { toast.error("Couldn't save your signature"); return; }
    toast.success(signature ? "Signature saved" : "Signature removed");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-serif">Email signature</DialogTitle>
          <DialogDescription>
            Added to the end of emails you send from a contact record. Gmail doesn't add its own signature to these. Leave blank for none.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-4">
            <Textarea value={value} onChange={(e) => setValue(e.target.value)} rows={10} placeholder={"Thanks,\nYour name"} className="font-mono text-sm" />
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Preview</p>
              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <p className="text-muted-foreground">Hi Herman, the file is in your portal.</p>
                <p className="mt-3 whitespace-pre-wrap">{value.trim() || <span className="italic text-muted-foreground">No signature</span>}</p>
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || loading}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
