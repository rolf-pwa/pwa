import { BellRing, BellOff, Loader2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { useToast } from "@/shared/hooks/use-toast";
import type { usePortalPwa } from "../hooks/usePortalPwa";
import { pushNeedsInstall } from "../lib/pwa";

/** "Notify me on this device" — renders nothing unless the household has the V2 engine on. */
export function PortalPushToggle({ pwa }: { pwa: ReturnType<typeof usePortalPwa> }) {
  const { enabled, state, busy, subscribe, unsubscribe } = pwa;
  const { toast } = useToast();
  if (!enabled || state === "unsupported") return null;

  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  if (pushNeedsInstall(navigator.userAgent, !!standalone)) {
    return <p className="text-xs text-muted-foreground">To get notifications on iPhone, tap Share → Add to Home Screen, then open ProsperWise from there.</p>;
  }
  if (state === "blocked") return <p className="text-xs text-muted-foreground">Notifications are blocked for this site in your browser settings.</p>;

  const on = state === "on";
  return (
    <Button
      variant="outline" className="w-full justify-start border-accent/30 text-accent hover:bg-accent/10" disabled={busy}
      onClick={async () => {
        try { await (on ? unsubscribe() : subscribe()); }
        catch (e) { toast({ title: "Couldn't update notifications", description: e instanceof Error ? e.message : "Please try again.", variant: "destructive" }); }
      }}
    >
      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : on ? <BellOff className="mr-2 h-4 w-4" /> : <BellRing className="mr-2 h-4 w-4" />}
      {on ? "Turn off notifications" : "Notify me on this device"}
    </Button>
  );
}
