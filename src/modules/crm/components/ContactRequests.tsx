import { useState, useEffect } from "react";
import { supabase } from "@/shared/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { ClipboardList, MessageCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Link } from "react-router-dom";

interface Props {
  contactId: string;
}

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  submitted: { label: "New", variant: "destructive" },
  in_progress: { label: "In Progress", variant: "default" },
  resolved: { label: "Resolved", variant: "secondary" },
};

const TYPE_LABELS: Record<string, string> = {
  banking_withdrawal: "Banking & Withdrawals",
  personal_info: "Personal Info",
  document_request: "Document Request",
  general_inquiry: "General Inquiry",
};

export function ContactRequests({ contactId }: Props) {
  const [requests, setRequests] = useState<any[]>([]);

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from("portal_requests")
        .select("*, messages:portal_request_messages(id, sender_type)")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false });
      setRequests(data || []);
    };
    fetch();
  }, [contactId]);

  if (requests.length === 0) return null;

  const open = requests.filter((r) => r.status !== "resolved");
  const resolved = requests.filter((r) => r.status === "resolved");

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
          Client Requests
          {open.length > 0 && (
            <Badge variant="destructive" className="text-[10px] ml-auto">
              {open.length} open
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {open.map((req) => {
          const sc = STATUS_CONFIG[req.status] || STATUS_CONFIG.submitted;
          const clientMsgs = (req.messages || []).filter((m: any) => m.sender_type === "client");
          return (
            <Link
              key={req.id}
              to="/ask-georgia"
              className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm transition-colors hover:bg-muted"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium text-xs">{TYPE_LABELS[req.request_type] || req.request_type}</p>
                <p className="text-[10px] text-muted-foreground line-clamp-1">{req.request_description}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                {clientMsgs.length > 0 && (
                  <Badge variant="outline" className="text-[9px]">
                    <MessageCircle className="h-2.5 w-2.5 mr-0.5" />
                    {clientMsgs.length}
                  </Badge>
                )}
                <Badge variant={sc.variant} className="text-[9px]">{sc.label}</Badge>
              </div>
            </Link>
          );
        })}
        {resolved.length > 0 && (
          <p className="text-[10px] text-muted-foreground pt-1">
            + {resolved.length} resolved
          </p>
        )}
      </CardContent>
    </Card>
  );
}
