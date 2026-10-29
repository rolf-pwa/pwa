import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { ScrollArea } from "@/shared/components/ui/scroll-area";
import { Shield } from "lucide-react";
import { supabase } from "@/shared/integrations/supabase/client";
import { format } from "date-fns";

interface AuditEntry {
  id: string;
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

export function AuditTrail({ contactId }: { contactId: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from("sovereignty_audit_trail" as any)
        .select("id, action_type, action_description, approved_at")
        .eq("contact_id", contactId)
        .order("approved_at", { ascending: false })
        .limit(50) as any;
      setEntries(data || []);
      setLoading(false);
    }
    fetch();
  }, [contactId]);

  if (loading || entries.length === 0) return null;

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
                  <p className="mt-1 text-sanctuary-green font-medium">
                    ✓ Approved by Family CFO
                  </p>
                </div>
              ))}
            </div>
          </ScrollArea>
      </CardContent>
    </Card>
  );
}
