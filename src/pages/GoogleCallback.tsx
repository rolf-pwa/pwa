import { useEffect } from "react";
import { STAFF_HOME } from "@/shared/lib/staffHome";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useExchangeGoogleCode } from "@/shared/hooks/useGoogle";
import { toast } from "sonner";

const GoogleCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const exchangeCode = useExchangeGoogleCode();

  useEffect(() => {
    const code = searchParams.get("code");
    const error = searchParams.get("error");

    if (error) {
      toast.error("Google authorization was denied.");
      navigate(STAFF_HOME, { replace: true });
      return;
    }

    if (code && !exchangeCode.isPending && !exchangeCode.isSuccess) {
      exchangeCode.mutate(code, {
        onSuccess: () => {
          toast.success("Google Calendar & Gmail connected!");
          navigate(STAFF_HOME, { replace: true });
        },
        onError: (err) => {
          toast.error(`Connection failed: ${err.message}`);
          navigate(STAFF_HOME, { replace: true });
        },
      });
    }
  }, [searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="animate-pulse text-muted-foreground">
        Connecting Google account...
      </div>
    </div>
  );
};

export default GoogleCallback;
