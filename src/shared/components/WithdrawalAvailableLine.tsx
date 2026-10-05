import { format, parseISO } from "date-fns";
import { cn } from "@/shared/lib/utils";
// The same rule the statement review uses (lesser of surplus and income funds), computed here from the
// account's own stored numbers so it can't go stale against a newer balance.
import { availableForWithdrawal } from "../../../supabase/functions/_shared/withdrawal-availability";

interface Props {
  bookValue?: number | null;
  currentValue?: number | null;
  incomeFundsValue?: number | null;
  /** Statement date (YYYY-MM-DD) the income funds figure was read from. */
  incomeFundsAsOf?: string | null;
  className?: string;
}

const cad = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "CAD" });

const LIMIT_TEXT = {
  income_funds: "limited by income funds",
  surplus: "limited by surplus",
  none: "surplus fully in income funds",
} as const;

/**
 * "Available to withdraw this year" for an account card. Renders nothing unless an approved V2 statement
 * review has recorded the account's income funds, so V1 accounts look exactly as before.
 */
export function WithdrawalAvailableLine({ bookValue, currentValue, incomeFundsValue, incomeFundsAsOf, className }: Props) {
  if (incomeFundsValue === null || incomeFundsValue === undefined) return null;
  const { surplus, available, limited_by } = availableForWithdrawal({
    book_value: bookValue, current_value: currentValue, income_funds_value: Number(incomeFundsValue),
  });
  if (available === null || surplus === null) return null;

  let asOf: string | null = null;
  try { asOf = incomeFundsAsOf ? format(parseISO(incomeFundsAsOf), "MMM d, yyyy") : null; } catch { asOf = null; }
  const limit = surplus <= 0 ? "no surplus this year" : limited_by ? LIMIT_TEXT[limited_by] : null;

  return (
    <div data-testid="withdrawal-available" className={cn("rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-muted-foreground">Available to withdraw this year</span>
        <span className="font-semibold tabular-nums">{cad(available)}</span>
      </div>
      <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
        Surplus {cad(surplus)} · income funds {cad(Number(incomeFundsValue))}{asOf ? ` as of ${asOf}` : ""}{limit ? ` · ${limit}` : ""}
      </p>
    </div>
  );
}
