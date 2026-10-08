import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, ScanSearch } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/shared/integrations/supabase/client";
import { Button } from "@/shared/components/ui/button";
import { heldForReviewMessage, isHeldForReview } from "@/modules/crm/lib/vaultScanMessage";

/** Reads new investment statements, insurance policies and estate documents filed in the Vault. V2 households get the results in Glass-Box Review. */
export function VaultScanButton({ householdId, onDone }: { householdId: string; onDone?: () => void }) {
  const navigate = useNavigate();
  const [scanning, setScanning] = useState(false);

  const scan = async () => {
    setScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke("vault-statement-scan", {
        body: { householdId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (isHeldForReview(data)) {
        // V2 household: nothing was written; the extractions wait for approval in Glass-Box Review.
        toast.success(heldForReviewMessage(data.v2HeldForReview), {
          duration: 15000,
          action: { label: "Review now", onClick: () => navigate("/glass-box-review") },
        });
        if (data.errors?.length) {
          console.error("vault-statement-scan file errors:", data.errors);
          toast.warning(`${data.errors.length} file(s) couldn't be parsed: ${data.errors.slice(0, 3).join("; ")}`);
        }
        onDone?.();
        return;
      }
      const parts: string[] = [];
      if (data.investmentFilesParsed) {
        const bits = [];
        if (data.investmentAccountsMatched) bits.push(`${data.investmentAccountsMatched} account${data.investmentAccountsMatched === 1 ? "" : "s"} updated`);
        if (data.investmentHoldingTankUpdated) bits.push(`${data.investmentHoldingTankUpdated} Holding Tank entr${data.investmentHoldingTankUpdated === 1 ? "y" : "ies"} updated`);
        if (data.investmentAccountsUnmatched) bits.push(`${data.investmentAccountsUnmatched} new → Holding Tank`);
        parts.push(bits.length ? bits.join(", ") : "no changes");
      }
      if (data.insuranceFilesParsed) {
        parts.push(
          `${data.insurancePoliciesMatched} polic${data.insurancePoliciesMatched === 1 ? "y" : "ies"} updated` +
            (data.insurancePoliciesCreated ? `, ${data.insurancePoliciesCreated} new` : ""),
        );
      }
      if (!data.investmentsFolderFound && !data.insuranceFolderFound) {
        toast.error("Couldn't find the Investment Statements or Insurance Vault folders for this household.");
      } else if (parts.length === 0) {
        toast.info("Scanned the Vault — no statement or policy files found to parse.");
      } else {
        toast.success(`Vault scan complete: ${parts.join("; ")}.`);
      }
      if (data.errors?.length) {
        console.error("vault-statement-scan file errors:", data.errors);
        toast.warning(`${data.errors.length} file(s) couldn't be parsed: ${data.errors.slice(0, 3).join("; ")}${data.errors.length > 3 ? ` (+${data.errors.length - 3} more, see console)` : ""}`, { duration: 15000 });
      }
      onDone?.();
    } catch (e: any) {
      toast.error(`Vault scan failed: ${e.message || "Unknown error"}`);
    } finally {
      setScanning(false);
    }
  };

  return (
    <Button variant="outline" size="sm" disabled={scanning} onClick={scan} title="Parse new investment statements, insurance policies and estate documents filed in the Vault">
      {scanning ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <ScanSearch className="h-3.5 w-3.5 mr-1.5" />}
      Scan Vault for Updates
    </Button>
  );
}
