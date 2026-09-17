import { useState, useEffect } from "react";
import { supabase } from "@/shared/integrations/supabase/client";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Badge } from "@/shared/components/ui/badge";
import { Merge, Loader2, ArrowRight } from "lucide-react";
import { toast } from "sonner";

interface ContactMergeProps {
  contactId: string;
  contactName: string;
  onMerged: () => void;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface ContactOption {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  household_id: string | null;
}

export function ContactMerge({ contactId, contactName, onMerged, trigger, open: controlledOpen, onOpenChange }: ContactMergeProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = controlledOpen ?? internalOpen;
  const setOpen = (value: boolean) => {
    setInternalOpen(value);
    onOpenChange?.(value);
  };
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [merging, setMerging] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    supabase
      .from("contacts")
      .select("id, full_name, email, phone, household_id")
      .neq("id", contactId)
      .order("full_name")
      .then(({ data }) => {
        setContacts(data || []);
        setLoading(false);
      });
  }, [open, contactId]);

  const selectedContact = contacts.find((c) => c.id === selectedId);

  const handleMerge = async () => {
    if (!selectedId) return;
    setMerging(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/merge-contacts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            primaryId: contactId,
            duplicateId: selectedId,
          }),
        }
      );
      const result = await res.json();
      if (result.error) {
        toast.error(result.error);
      } else {
        const transfers = result.transfers?.filter((t: string) => !t.includes("0 record")) || [];
        toast.success(
          `Merged "${selectedContact?.full_name}" into "${contactName}". ${result.fieldsMerged?.length || 0} fields updated, ${transfers.length} table(s) transferred.`
        );
        setOpen(false);
        setSelectedId("");
        onMerged();
      }
    } catch (err: any) {
      toast.error(err.message || "Merge failed");
    } finally {
      setMerging(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {(trigger || !isControlled) && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button variant="outline" size="sm" className="gap-1.5">
              <Merge className="h-4 w-4" />
              Merge
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Merge Duplicate Contact</DialogTitle>
          <DialogDescription>
            Select the duplicate contact to absorb into <strong>{contactName}</strong>.
            All accounts, relationships, and records will be transferred. Empty fields on the
            primary record will be filled from the duplicate.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Primary (keep)</label>
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <p className="text-sm font-medium">{contactName}</p>
              <p className="text-xs text-muted-foreground">This record will be kept</p>
            </div>
          </div>

          <div className="flex justify-center">
            <ArrowRight className="h-4 w-4 text-muted-foreground rotate-90" />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Duplicate (absorb &amp; delete)</label>
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select duplicate contact…" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {contacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="flex items-center gap-2">
                        {c.full_name}
                        {c.email && (
                          <Badge variant="outline" className="text-[10px] h-4 font-normal">
                            {c.email}
                          </Badge>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {selectedContact && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <p className="font-medium text-destructive">⚠ This action cannot be undone</p>
              <p className="text-muted-foreground mt-1">
                "{selectedContact.full_name}" will be permanently deleted after all records
                are transferred to "{contactName}".
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={merging}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleMerge}
            disabled={!selectedId || merging}
          >
            {merging && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Merge & Delete Duplicate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
