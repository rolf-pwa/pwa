import { useState } from "react";
import { Card, CardContent } from "@/shared/components/ui/card";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatCurrency } from "@/modules/portal/lib/portalAum";

export interface TotalsItem { id: string; name: string; value: number }
export interface TotalsRow { label: string; total: number; items: TotalsItem[]; suffix?: string }

/** A sidebar card of category totals. Each row opens to its accounts and balances (name and amount only). */
export function PortalTotalsCard({ title, rows }: { title: string; rows: TotalsRow[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (label: string) => setOpen((prev) => { const n = new Set(prev); n.has(label) ? n.delete(label) : n.add(label); return n; });
  return (
    <Card>
      <CardContent className="p-0 divide-y divide-border">
        <div className="px-4 py-3">
          <h2 className="font-serif text-sm font-semibold text-foreground">{title}</h2>
        </div>
        {rows.map((r) => {
          const isOpen = open.has(r.label);
          const expandable = r.items.length > 0;
          return (
            <div key={r.label}>
              <button
                disabled={!expandable}
                onClick={() => toggle(r.label)}
                className={`flex w-full items-center justify-between px-4 py-3 text-left transition-colors ${expandable ? "hover:bg-muted/40" : "cursor-default"}`}
              >
                <span className="flex items-center gap-1.5 text-sm text-foreground">
                  {expandable ? (isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />) : <span className="w-4" />}
                  {r.label}
                  {r.suffix ? <span className="text-xs text-muted-foreground">{r.suffix}</span> : null}
                </span>
                <span className="font-serif text-sm font-semibold tabular-nums text-foreground">{formatCurrency(r.total)}</span>
              </button>
              {isOpen && (
                <div className="pb-2">
                  {r.items.map((it) => (
                    <div key={it.id} className="flex items-center justify-between pl-10 pr-4 py-1.5">
                      <span className="text-xs text-muted-foreground">{it.name}</span>
                      <span className="text-xs tabular-nums text-foreground">{formatCurrency(it.value)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
