import { signOut } from "@/shared/lib/auth";
import { Button } from "@/shared/components/ui/button";
import { ShieldX } from "lucide-react";

const AccessDenied = () => {
  return (
    <div className="flex min-h-screen items-center justify-center bg-primary">
      <div className="mx-4 w-full max-w-md space-y-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/20">
          <ShieldX className="h-8 w-8 text-destructive" />
        </div>
        <h1 className="text-2xl font-bold text-primary-foreground">
          No Account Found
        </h1>
        <p className="text-sm text-primary-foreground/60">
          Your email is not associated with a ProsperWise client account.
          Please contact your Family CFO if you believe this is an error.
        </p>
        <Button
          onClick={() => signOut()}
          variant="outline"
          className="border-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/10"
        >
          Sign Out & Try Again
        </Button>
      </div>
    </div>
  );
};

export default AccessDenied;
