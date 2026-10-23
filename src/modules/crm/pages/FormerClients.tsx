import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AppLayout } from "@/shared/components/AppLayout";
import { CrmTabs } from "@/modules/crm/components/CrmTabs";
import { Badge } from "@/shared/components/ui/badge";
import { supabase } from "@/shared/integrations/supabase/client";
import { keepUntilLabel, retentionOver, RETENTION_YEARS } from "@/shared/lib/retention";

interface Row { id: string; label: string; ended: string; reason: string | null; members: string[] }

/**
 * Former clients: households whose advisory relationship has ended. They leave the main CRM lists, but staff can still open them here. Their records are kept for 7
 * years after the relationship ended, and the database will not let them be permanently deleted until then.
 */
const FormerClients = () => {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    void (async () => {
      const { data: hh } = await supabase.from("households").select("id, label, relationship_ended_at, relationship_end_reason").not("relationship_ended_at", "is", null).order("relationship_ended_at", { ascending: false });
      const ids = (hh ?? []).map((h) => h.id);
      const { data: people } = ids.length ? await supabase.from("contacts").select("household_id, first_name, last_name").in("household_id", ids) : { data: [] as { household_id: string | null; first_name: string; last_name: string }[] };
      setRows((hh ?? []).map((h) => ({ id: h.id, label: h.label, ended: h.relationship_ended_at as string, reason: h.relationship_end_reason ?? null, members: (people ?? []).filter((p) => p.household_id === h.id).map((p) => `${p.first_name} ${p.last_name}`.trim()) })));
    })();
  }, []);

  return (
    <AppLayout>
      <div className="space-y-4">
        <CrmTabs />
        <div>
          <h1 className="font-serif text-2xl font-semibold">Former clients</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Households whose advisory relationship has ended. Their records are kept for {RETENTION_YEARS} years after the relationship ended and cannot be permanently deleted before then. Open one to see its records, or to reopen the relationship.</p>
        </div>
        {rows === null ? <Loader2 className="h-5 w-5 animate-spin" /> : rows.length === 0 ? <p className="text-sm text-muted-foreground">No former clients.</p> : (
          <div className="rounded-lg border" data-testid="former-clients">
            {rows.map((r) => (
              <Link key={r.id} to={`/households/${r.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-3 py-2.5 text-sm last:border-0 hover:bg-muted/50">
                <span className="min-w-[10rem] font-medium">{r.label}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.members.join(", ") || "No members"}</span>
                <span className="text-xs text-muted-foreground">ended {new Date(r.ended).toLocaleDateString("en-CA", { month: "short", year: "numeric" })}{r.reason ? `, ${r.reason}` : ""}</span>
                {retentionOver(r.ended) ? <Badge variant="secondary" className="text-[10px]">7 years over: review</Badge> : <span className="text-xs text-muted-foreground">kept until {keepUntilLabel(r.ended)}</span>}
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default FormerClients;
