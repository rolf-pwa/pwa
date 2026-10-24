import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/shared/integrations/supabase/client";
import { isAllowedDomain } from "@/shared/lib/auth";
import { signInToPortalWithGoogle } from "@/shared/lib/portalGoogleSignIn";
import { Button } from "@/shared/components/ui/button";

// If nothing at all happens (no sign-in event, no session) after this long, send the person to the login page.
const NO_EVENT_MS = 20_000;

/**
 * Handles the OAuth callback at the root URL.
 * - @prosperwise.ca users → /briefing (Today)
 * - Other Google users → /portal (with contact lookup)
 * - No auth hash → /briefing (existing session) or /login
 * Opening the portal takes a few seconds (longer on a phone), so this waits for it instead of giving up: a slow load is not "no account".
 */
const AuthCallback = () => {
  const [destination, setDestination] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const handled = useRef(false);
  const emailRef = useRef<string | undefined>(undefined);
  const hasAuthHash = window.location.hash?.includes("access_token");

  const finish = useCallback(async (email: string | undefined) => {
    if (handled.current) return; // sign-in and token-refresh events arrive together: only one run
    handled.current = true;
    emailRef.current = email;
    setFailed(false);
    if (!email) { setDestination("/access-denied"); return; }
    if (isAllowedDomain(email)) { setDestination("/briefing"); return; }
    const result = await signInToPortalWithGoogle(email);
    if (result.ok) {
      sessionStorage.setItem("portal_google_auth", JSON.stringify(result.data));
      setDestination("/portal");
    } else if ("reason" in result && result.reason === "no_account") {
      setDestination("/access-denied");
    } else {
      handled.current = false; // let them try again
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let subscription: { unsubscribe: () => void } | undefined;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!hasAuthHash) {
        // No auth hash: an existing session goes on to the portal (clients) or the dashboard (staff); no session goes to the login page via the dashboard.
        if (session?.user?.email) await finish(session.user.email);
        else setDestination("/briefing");
        return;
      }
      if (session?.user?.email) { await finish(session.user.email); return; }
      subscription = supabase.auth.onAuthStateChange((event, s) => {
        if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && s?.user?.email) void finish(s.user.email);
      }).data.subscription;
      timer = setTimeout(() => { if (!handled.current) setDestination("/login"); }, NO_EVENT_MS);
    })();
    return () => { subscription?.unsubscribe(); if (timer) clearTimeout(timer); };
  }, [hasAuthHash, finish]);

  if (destination) return <Navigate to={destination} replace />;

  if (failed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-primary">
        <div className="mx-4 w-full max-w-md space-y-5 text-center">
          <h1 className="text-2xl font-bold text-primary-foreground">We couldn't open your portal just now</h1>
          <p className="text-sm text-primary-foreground/60">Your account is fine; the connection was slow or dropped. Please try again, or sign in with an email code instead.</p>
          <div className="flex flex-col gap-2">
            <Button onClick={() => void finish(emailRef.current)}>Try again</Button>
            <Button variant="outline" className="border-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/10" onClick={() => { window.location.href = "/login"; }}>Use an email code</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-primary">
      <div className="animate-pulse text-primary-foreground">Signing in...</div>
    </div>
  );
};

export default AuthCallback;
