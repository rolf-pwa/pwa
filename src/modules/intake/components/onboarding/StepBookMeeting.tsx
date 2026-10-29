import { useEffect, useState } from "react";
import { CalendarCheck, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";

// The short calendar.app.google link sets X-Frame-Options: SAMEORIGIN and
// can't be embedded directly. Its resolved calendar.google.com URL redirects
// again (only when a gv=true param is present) to the real embeddable form —
// same /calendar/appointments/schedules/... shape StepBookAudit.tsx already
// uses for the two payment-track schedules. Using that final URL directly
// skips relying on the iframe to follow the redirect itself.
const MEETING_LINK = "https://calendar.app.google/JCrhok5xgunLQ9qF6";
const MEETING_EMBED_URL =
  "https://calendar.google.com/calendar/appointments/schedules/AcZssZ0WBGCqb7mvBweQ5lRt8tPk-KcTZf8ZHRT1xMHvInYtpgkXXB5BMALt7gA1R3r7E_3v5WvmDk4Z";

interface Props {
  fullName: string;
  email: string;
  saving: boolean;
  onConfirm: () => void;
}

/** Legacy-upgrade Step 4 (last step) — book the transition survey via the
 *  firm's Google Calendar link, then confirm to finish onboarding. */
export const StepBookMeeting = ({ fullName, email, saving, onConfirm }: Props) => {
  const [iframeLoading, setIframeLoading] = useState(true);

  useEffect(() => {
    setIframeLoading(true);
  }, []);

  const qs = `?${new URLSearchParams({
    ...(fullName ? { name: fullName } : {}),
    ...(email ? { email } : {}),
    gv: "true",
  }).toString()}`;
  const embedSrc = `${MEETING_EMBED_URL}${qs}`;

  return (
    <Card>
      <CardContent className="space-y-5 p-6">
        <div className="space-y-1.5">
          <h2 className="font-serif text-lg font-semibold text-foreground">Book your meeting</h2>
          <p className="text-sm text-muted-foreground">
            Last step, pick a time for your Transition Survey below. Once you've booked,
            confirm it here.
          </p>
        </div>

        <div className="relative overflow-hidden rounded-lg border border-border">
          {iframeLoading && (
            <div className="flex h-[600px] items-center justify-center bg-muted/20">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          <iframe
            src={embedSrc}
            title="Book your meeting"
            className={iframeLoading ? "hidden" : "block w-full"}
            style={{ height: 600, border: 0 }}
            onLoad={() => setIframeLoading(false)}
          />
        </div>

        <a
          href={MEETING_LINK}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Having trouble? Open in a new tab
          <ExternalLink className="h-3 w-3" />
        </a>

        <Button className="w-full" onClick={onConfirm} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck className="h-4 w-4" />}
          I've booked my meeting
        </Button>
      </CardContent>
    </Card>
  );
};
