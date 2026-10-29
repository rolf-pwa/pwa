import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/shared/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Resolves /governance-audit/household/:householdId into an actual audit
 * id, then redirects to /governance-audit/:id -- same pattern as
 * StabilizationMapResolver.tsx. Unlike the Transition Map, there's no
 * "no existing map yet" first-run distinction worth surfacing: every open
 * either lands on the most recent audit for this household, or generates
 * a brand new one on the spot.
 */
export default function GovernanceAuditResolver() {
  const { householdId } = useParams<{ householdId: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    const resolve = async () => {
      try {
        if (!householdId) throw new Error("Missing household");

        const { data: existing } = await supabase
          .from("governance_audits" as any)
          .select("id")
          .eq("household_id", householdId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!cancelled && (existing as any)?.id) {
          navigate(`/governance-audit/${(existing as any).id}`, { replace: true });
          return;
        }

        const { data: { session } } = await supabase.auth.getSession();
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/governance-audit-generate`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ household_id: householdId }),
        });
        const data = await res.json();
        if (!res.ok || !data.auditId) throw new Error(data.error || "Failed to generate audit");
        if (!cancelled) navigate(`/governance-audit/${data.auditId}`, { replace: true });
      } catch (e) {
        if (!cancelled) {
          toast.error(e instanceof Error ? e.message : "Failed to open the Governance Audit");
          navigate(-1);
        }
      }
    };

    resolve();
    return () => { cancelled = true; };
  }, [householdId, navigate]);

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Opening the Governance Audit…</p>
      </div>
    </div>
  );
}
