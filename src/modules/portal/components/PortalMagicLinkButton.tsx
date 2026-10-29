import { useState } from "react";
import { supabase } from "@/shared/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { Button } from "@/shared/components/ui/button";
import { Link2, Check, Loader2, Eye } from "lucide-react";
import { toast } from "sonner";

interface Props {
  contactId: string;
}

export async function getOrCreateToken(contactId: string, userId: string): Promise<string> {
  // Check for an existing valid token that has NOT been used yet.
  // Magic-link tokens are single_use — reusing a consumed token yields "Invalid link".
  const { data: existing } = await supabase
    .from("portal_tokens" as any)
    .select("token, expires_at, used_at")
    .eq("contact_id", contactId)
    .eq("revoked", false)
    .is("used_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing && new Date((existing as any).expires_at) > new Date()) {
    return (existing as any).token;
  }

  const { data, error } = await supabase
    .from("portal_tokens" as any)
    .insert({ contact_id: contactId, created_by: userId } as any)
    .select("token")
    .single();

  if (error) throw error;
  return (data as any).token;
}

async function resolvePortalPath(contactId: string): Promise<"portal" | "vfo"> {
  const { data: contact } = await supabase
    .from("contacts")
    .select("family_id, households:household_id(family_id)")
    .eq("id", contactId)
    .maybeSingle();
  const familyId = (contact as any)?.family_id || (contact as any)?.households?.family_id;
  if (!familyId) return "portal";
  const { data: family } = await supabase
    .from("families")
    .select("vfo_enabled")
    .eq("id", familyId)
    .maybeSingle();
  return (family as any)?.vfo_enabled ? "vfo" : "portal";
}

export function PortalMagicLinkButton({ contactId }: Props) {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [viewLoading, setViewLoading] = useState(false);

  const generateLink = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [token, base] = await Promise.all([
        getOrCreateToken(contactId, user.id),
        resolvePortalPath(contactId),
      ]);
      const url = `${window.location.origin}/${base}/${token}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(`${base === "vfo" ? "VFO" : "Portal"} link copied to clipboard, valid for 7 days.`);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      toast.error("Failed to generate portal link.");
    } finally {
      setLoading(false);
    }
  };

  const viewPortal = async () => {
    if (!user) return;
    setViewLoading(true);
    // Open window synchronously to avoid popup blocker
    const newWindow = window.open("about:blank", "_blank");
    try {
      const [token, base] = await Promise.all([
        getOrCreateToken(contactId, user.id),
        resolvePortalPath(contactId),
      ]);
      if (newWindow) {
        newWindow.location.href = `/${base}/${token}`;
      } else {
        // Fallback: navigate in current tab
        window.location.href = `/${base}/${token}`;
      }
    } catch {
      if (newWindow) newWindow.close();
      toast.error("Failed to open portal.");
    } finally {
      setViewLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={viewPortal}
        disabled={viewLoading}
        className="inline-flex items-center gap-1.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground hover:underline transition-colors disabled:opacity-50"
      >
        {viewLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
        View Portal
      </button>
      <button
        type="button"
        onClick={generateLink}
        disabled={loading}
        className="inline-flex items-center gap-1.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground hover:underline transition-colors disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-500" />
        ) : (
          <Link2 className="h-3.5 w-3.5" />
        )}
        {copied ? "Link Copied" : "Copy Portal Link"}
      </button>
    </div>
  );
}
