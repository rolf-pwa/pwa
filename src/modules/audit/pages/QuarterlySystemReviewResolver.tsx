import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/shared/integrations/supabase/client";
import { toast } from "sonner";

// Opens this quarter's Quarterly Review for a household (or a contact's household), generating it if there
// isn't one yet. A new calendar quarter starts a fresh review; earlier quarters are kept.
const quarterLabel = (d: Date) => `${d.getUTCFullYear()} Q${Math.floor(d.getUTCMonth() / 3) + 1}`;

export default function QuarterlySystemReviewResolver() {
  const { contactId, householdId: householdParam } = useParams<{ contactId?: string; householdId?: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    const isFresh = (updatedAt?: string | null) => !!updatedAt && Date.now() - new Date(updatedAt).getTime() < 45_000;

    const resolve = async () => {
      try {
        let householdId = householdParam;
        if (!householdId && contactId) {
          const { data: c } = await supabase.from("contacts").select("household_id").eq("id", contactId).maybeSingle();
          householdId = c?.household_id ?? undefined;
          if (!householdId) throw new Error("This contact has no household, so a quarterly review can't be built.");
        }
        if (!householdId) throw new Error("Missing household");

        const { data: existing } = await supabase
          .from("quarterly_system_reviews")
          .select("id, generation_status, updated_at")
          .eq("household_id", householdId)
          .eq("period_label", quarterLabel(new Date()))
          .maybeSingle();

        const inFlight = existing?.id && ["generating", "pending"].includes(existing.generation_status) && isFresh(existing.updated_at);
        if (!cancelled && existing?.id && (inFlight || !["generating", "pending", "failed"].includes(existing.generation_status))) {
          navigate(`/quarterly-system-review/${existing.id}`, { replace: true });
          return;
        }

        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/quarterly-system-review-generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify(existing?.id ? { reviewId: existing.id } : { householdId }),
        });
        const data = await res.json();
        if (!res.ok || !data.reviewId) throw new Error(data.error || "Failed to create quarterly review");
        if (!cancelled) navigate(`/quarterly-system-review/${data.reviewId}`, { replace: true });
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "Failed to open quarterly review");
          navigate(-1);
        }
      }
    };

    resolve();
    return () => { cancelled = true; };
  }, [contactId, householdParam, navigate]);

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Building the Quarterly Review from live records…</p>
      </div>
    </div>
  );
}
