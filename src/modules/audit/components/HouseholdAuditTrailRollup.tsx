import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { ScrollArea } from "@/shared/components/ui/scroll-area";
import { Shield, Loader2 } from "lucide-react";
import { supabase } from "@/shared/integrations/supabase/client";
import { format } from "date-fns";

interface Member { id: string; first_name: string; last_name: string | null }

interface AuditEntry {
  id: string;
  contact_id: string;
  action_type: string;
  action_description: string;
  approved_at: string;
}

const ACTION_LABELS: Record<string, string> = {
  vineyard_update: "Vineyard Update",
  storehouse_update: "Storehouse Update",
  draft_email: "Email Draft",
  draft_task: "Task Draft",
};

// Every audit entry attaches to whichever member the AI action was taken
// for — this rolls every household member's entries into one timeline so
// staff working at the household level see the full governance picture
// without clicking into each person.
export function HouseholdAuditTrailRollup({ members }: { members: Member[] }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const memberIds = members.map((m) => m.id);
    if (memberIds.length === 0) { setLoading(false); return; }
    (async () => {
      const { data } = await supabase
        .from("sovereignty_audit_trail" as any)
        .select("id, contact_id, action_type, action_description, approved_at")
        .in("contact_id", memberIds)
        .order("approved_at", { ascending: false })
        .limit(50) as any;
      setEntries(data || []);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members.map((m) => m.id).join(",")]);

  if (loading || entries.length === 0) return null;

  const nameFor = (contactId: string) => {
    const m = members.find((x) => x.id === contactId);
    return m ? `${m.first_name} ${m.last_name || ""}`.trim() : "Member";
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Shield className="h-4 w-4 text-sanctuary-bronze" />
          Sovereignty Audit Trail
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[200px]">
          <div className="space-y-2">
            {entries.map((entry) => (
              <div key={entry.id} className="rounded-md border p-2.5 text-xs">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="text-[10px]">
                    {ACTION_LABELS[entry.action_type] || entry.action_type}
                  </Badge>
                  <span className="text-muted-foreground ml-auto">
                    {format(new Date(entry.approved_at), "MMM d, yyyy h:mm a")}
                  </span>
                </div>
                <p className="text-muted-foreground">{entry.action_description}</p>
                <div className="mt-1 flex items-center justify-between">
                  <p className="text-sanctuary-green font-medium">✓ Approved by Family CFO</p>
                  <p className="text-muted-foreground">{nameFor(entry.contact_id)}</p>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
