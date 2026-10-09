interface Snapshot {
  snapshot_date: string;
  boy_value: number | null;
  current_value: number | null;
  current_harvest: number | null;
  ytd_value: number | null;
  ror_ytd: number | null;
  ror_6m: number | null;
  ror_1y: number | null;
  ror_3y: number | null;
  ror_5y: number | null;
  ror_since_inception: number | null;
}

const fmtCurrency = (n: number) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const fmtDate = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
};

export function PortalAccountSnapshot({ snapshot }: { snapshot: Snapshot | null | undefined }) {
  if (!snapshot) return null;
  const boy = snapshot.boy_value != null ? Number(snapshot.boy_value) : null;
  const cur = snapshot.current_value != null ? Number(snapshot.current_value) : null;
  const harvest = snapshot.current_harvest != null ? Number(snapshot.current_harvest) : null;
  // YTD change as a share of the start-of-year value. (ytd_value holds the current value in dollars, not a percentage.)
  const pct = harvest != null && boy != null && boy > 0 ? (harvest / boy) * 100 : null;
  const pos = (harvest ?? 0) >= 0;
  const rors = [
    ["YTD", snapshot.ror_ytd],
    ["6 Mo", snapshot.ror_6m],
    ["1 Yr", snapshot.ror_1y],
    ["3 Yr", snapshot.ror_3y],
    ["5 Yr", snapshot.ror_5y],
    ["Inception", snapshot.ror_since_inception],
  ] as const;
  const hasRor = rors.some(([, v]) => v != null);

  return (
    <div className="mt-2 space-y-2">
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Beginning of Year</div>
          <div className="font-semibold tabular-nums">{boy != null ? fmtCurrency(boy) : "—"}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Current Market</div>
          <div className="font-semibold tabular-nums">{cur != null ? fmtCurrency(cur) : "—"}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">YTD Change</div>
          <div className={`font-semibold tabular-nums ${pos ? "text-green-600" : "text-destructive"}`}>
            {harvest != null ? `${pos ? "+" : ""}${fmtCurrency(harvest)}` : "—"}
            {pct != null && (
              <span className="ml-1 text-[10px] font-normal">({pos ? "+" : ""}{pct.toFixed(2)}%)</span>
            )}
          </div>
        </div>
      </div>

      {hasRor && (
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">Historical Rate of Return</div>
          <table className="w-full text-[10px] tabular-nums">
            <thead>
              <tr className="text-muted-foreground border-b border-border/50">
                {rors.map(([label]) => (
                  <th key={label} className="text-right py-0.5 px-1 font-medium whitespace-nowrap">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {rors.map(([label, v]) => {
                  const num = v == null ? null : Number(v);
                  return (
                    <td key={label} className={`text-right py-0.5 px-1 ${num == null ? "text-muted-foreground" : num >= 0 ? "text-green-600" : "text-destructive"}`}>
                      {num == null ? "—" : `${num >= 0 ? "+" : ""}${num.toFixed(2)}%`}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="text-[9px] text-muted-foreground">Snapshot as of {fmtDate(snapshot.snapshot_date)}</div>
    </div>
  );
}
