import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/shared/integrations/supabase/client";

export const WEBSITE_URL = "https://www.prosperwise.ca/sovereignty-operating-system";

/**
 * The page behind an onboarding invitation link (app.prosperwise.ca/welcome/:token). It tells the server the link was opened, which
 * starts Georgia's onboarding, and sends the visitor straight on to the website. It runs in a real browser, so a mail scanner that only
 * fetches the address does not count as a click. Whatever happens, the visitor always ends up on the website.
 */
export default function Welcome() {
  const { token } = useParams<{ token: string }>();

  useEffect(() => {
    let done = false;
    const go = () => { if (!done) { done = true; window.location.replace(WEBSITE_URL); } };
    const timer = window.setTimeout(go, 5000); // never strand them if the server is slow
    (async () => {
      try { await supabase.functions.invoke("intake-portal", { body: { action: "invite_click", token } }); } catch { /* the website is the point */ }
      window.clearTimeout(timer);
      go();
    })();
    return () => window.clearTimeout(timer);
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <meta name="robots" content="noindex" />
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Taking you to ProsperWise…
      </div>
    </div>
  );
}
