import { useEffect, useRef, useState } from "react";
import { CalendarCheck, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";

// The short calendar.app.google links set X-Frame-Options: SAMEORIGIN and
// can't be embedded — only the resolved calendar.google.com/.../schedules/...
// URL behind them is embeddable, so these are the resolved form.
const PERSONAL_SCHEDULE_URL =
  "https://calendar.google.com/calendar/appointments/schedules/AcZssZ2OCWM5PQ0LgBC9JN75R3JZyoOnN6npNH8j9nSQaRHfSB1gL18gtZ5qPULeSb0-dGZjvA5GC0Wb";
const CORPORATE_SCHEDULE_URL =
  "https://calendar.google.com/calendar/appointments/schedules/AcZssZ3knIG_inR-RLPoJ52B7LnnlIhEhQUfxIrWbWDpSUilkobnikFhtPoRV1QhotP6A1mBi-dVAGY5";

function isEmbeddable(url: string) {
  return /^https:\/\/calendar\.google\.com\/(calendar\/)?appointments\/schedules\//.test(url);
}

interface Props {
  fullName: string;
  email: string;
  serviceName: string | null;
  schedulingUrl: string | null;
  bookedAt: string | null;
  saving: boolean;
  onConfirm: () => void;
  /** Polls the CRM, which checks staff Google Calendars for this client's session. */
  onCheckBooking?: () => Promise<boolean>;
}

/** Final step — book the Survey Session with Rolf, the conversation that completes your Transition Survey. */
export const StepBookAudit = ({
  fullName,
  email,
  serviceName,
  schedulingUrl,
  bookedAt,
  saving,
  onConfirm,
  onCheckBooking,
}: Props) => {
  const isCorporate = (serviceName || "").toLowerCase().includes("corporate");
  // A CRM-pinned schedulingUrl (already embeddable) wins; otherwise the
  // calendar is picked automatically from what they paid for.
  const pinnedUrl = schedulingUrl && isEmbeddable(schedulingUrl) ? schedulingUrl : null;
  const embedUrl = pinnedUrl ?? (isCorporate ? CORPORATE_SCHEDULE_URL : PERSONAL_SCHEDULE_URL);

  const [iframeLoading, setIframeLoading] = useState(true);
  useEffect(() => {
    setIframeLoading(true);
  }, [embedUrl]);

  const qs = `?${new URLSearchParams({
    ...(fullName ? { name: fullName } : {}),
    ...(email ? { email } : {}),
    gv: "true",
  }).toString()}`;
  const embedSrc = `${embedUrl}${qs}`;

  // Silent background auto-advance: we poll the CRM, which checks the staff
  // Google Calendars for this client's session, and jump ahead the moment
  // it's found — the "Continue" button below is there for anyone who'd
  // rather not wait for it.
  const checkRef = useRef(onCheckBooking);
  checkRef.current = onCheckBooking;
  const canCheck = Boolean(onCheckBooking);

  useEffect(() => {
    if (!canCheck || bookedAt) return;
    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      await checkRef.current?.();
      if (cancelled) return;
      timer = window.setTimeout(poll, 15000);
    };

    void poll();
    const onFocus = () => void poll();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [canCheck, bookedAt]);

  return (
    <Card>
      <CardContent className="space-y-5 p-6">
        <div className="space-y-1.5">
          <h2 className="font-serif text-lg font-semibold text-foreground">Book your Survey Session</h2>
          <p className="text-sm text-muted-foreground">
            This is the last step. Pick a time below to sit down with Rolf. The session runs about 90
            minutes, and everything you have shared is already in front of him, so there is nothing more to prepare.
          </p>
        </div>

        <div className="relative overflow-hidden rounded-lg border border-border">
          {iframeLoading && (
            <div className="flex h-[600px] items-center justify-center bg-muted/20">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          <iframe
            key={embedUrl}
            src={embedSrc}
            title="Book your Survey session"
            className={iframeLoading ? "hidden" : "block w-full"}
            style={{ height: 600, border: 0 }}
            onLoad={() => setIframeLoading(false)}
          />
        </div>

        <a
          href={embedSrc}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Having trouble? Open in a new tab
          <ExternalLink className="h-3 w-3" />
        </a>

        <Button className="w-full" onClick={onConfirm} disabled={saving}>
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CalendarCheck className="h-4 w-4" />
          )}
          I've booked my session
        </Button>
      </CardContent>
    </Card>
  );
};
