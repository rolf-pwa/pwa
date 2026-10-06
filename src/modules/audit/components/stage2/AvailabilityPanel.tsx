import { AlertTriangle } from "lucide-react";
import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/lib/utils";
// Same pure function the backend uses (Stage 2 and stage2-review), so the figures here can't drift from what is stored.
import { computeAvailability, type Availability, type FundLine, type WithdrawalLine } from "../../../../../supabase/functions/_shared/withdrawal-availability";
import { type ReviewItem } from "../../lib/stage2";

const cad = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("en-CA", { style: "currency", currency: "CAD" });

const LIMIT_LABEL: Record<NonNullable<Availability["limited_by"]>, string> = {
  income_funds: "Limited by income funds",
  surplus: "Limited by surplus",
  none: "Surplus is fully in income funds",
};

function Line({ label, value, strong, hint }: { label: string; value: string; strong?: boolean; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <dt className={cn("text-sm", strong ? "font-medium" : "text-muted-foreground")}>
        {label}
        {hint ? <span className="block text-xs font-normal text-muted-foreground">{hint}</span> : null}
      </dt>
      <dd className={cn("tabular-nums", strong ? "text-lg font-semibold" : "text-sm")}>{value}</dd>
    </div>
  );
}

/**
 * "Available for withdrawal this year" for each investment account: the lesser of the surplus
 * (growth not yet withdrawn) and the income funds on hand, with the reason shown and an
 * Unconfirmed flag when the listed funds don't add up to the statement value.
 */
export function AvailabilityPanel({ items }: { items: ReviewItem[] }) {
  const rows = items.map((item) => ({
    item,
    av: computeAvailability({
      book_value: item.book_value as number | null | undefined,
      current_value: item.current_value as number | null | undefined,
      funds: (item.funds as FundLine[] | null | undefined) ?? null,
      income_withdrawals: (item.income_withdrawals as WithdrawalLine[] | null | undefined) ?? null,
    }),
  }));
  if (rows.every((r) => r.av.surplus === null && r.av.funds.length === 0)) return null;

  return (
    <div className="space-y-3" aria-label="Available for withdrawal this year">
      {rows.map(({ item, av }, i) => (
        <section key={i} className="rounded border p-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h4 className="truncate font-sans text-sm font-medium">
              {String(item.account_name ?? `Account ${i + 1}`)}
              {item.account_number ? <span className="text-muted-foreground"> · #{String(item.account_number)}</span> : null}
            </h4>
            {av.status !== "confirmed" && (
              <Badge variant="outline" className="shrink-0 border-amber-300 bg-amber-50 text-amber-800">
                {av.status === "unconfirmed" ? "Unconfirmed" : "Not enough data"}
              </Badge>
            )}
          </div>

          <dl className="divide-y">
            <Line label="Surplus" hint="Growth not yet withdrawn (current value − opening balance)" value={cad(av.surplus)} />
            <Line label="Income funds on hand" hint="Where withdrawals are drawn from" value={cad(av.income_funds)} />
            <Line
              label="Withdrawn from income funds (this period)"
              hint="Counted in Harvest to date on the Sovereignty Review"
              value={av.income_withdrawals_ytd === null ? "Not read from statement" : cad(av.income_withdrawals_ytd)}
            />
            <div className="pt-1">
              <Line label="Available for withdrawal this year" strong value={cad(av.available)} />
              {av.limited_by && av.available !== null && (
                <p className="text-right text-xs text-muted-foreground">{LIMIT_LABEL[av.limited_by]}</p>
              )}
            </div>
          </dl>

          {av.notes.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {av.notes.map((n, k) => (
                <li key={k} className="flex gap-1.5">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" aria-hidden />
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          )}

          {av.funds.length > 0 && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-muted-foreground">Funds counted ({av.funds.length})</summary>
              <table className="mt-1 w-full">
                <tbody>
                  {av.funds.map((f, k) => (
                    <tr key={k} className={cn("border-t", f.is_income && "font-medium")}>
                      <td className="py-0.5 pr-2">{f.name}</td>
                      <td className="pr-2 text-muted-foreground">{f.category}{f.is_income ? " · income" : ""}</td>
                      <td className="text-right tabular-nums">{cad(f.value)}</td>
                    </tr>
                  ))}
                  <tr className="border-t font-medium">
                    <td className="py-0.5" colSpan={2}>Total of listed funds</td>
                    <td className="text-right tabular-nums">{cad(av.funds_total)}</td>
                  </tr>
                </tbody>
              </table>
            </details>
          )}
        </section>
      ))}
    </div>
  );
}
