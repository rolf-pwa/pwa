import { useEffect, useState } from "react";
import { Anchor, Castle, Grape, Loader2, Lock, RefreshCw, Sword, Wheat } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Progress } from "@/shared/components/ui/progress";
import { Textarea } from "@/shared/components/ui/textarea";
import { Label } from "@/shared/components/ui/label";
import { CollapsibleCard } from "@/shared/components/CollapsibleCard";
import type { HouseholdCharter, StorehouseReserves } from "../../hooks/useCharterIntake";

const formatCurrency = (val: number) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);

const STOREHOUSE_CONFIG: { key: keyof StorehouseReserves; name: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "liquidity", name: "Liquidity Reserve", icon: Castle },
  { key: "strategic", name: "Strategic Reserve", icon: Sword },
  { key: "philanthropic", name: "Philanthropic Trust", icon: Wheat },
  { key: "legacy", name: "Legacy Trust", icon: Lock },
];

interface Props {
  charter: HouseholdCharter;
  recomputing: boolean;
  saving: boolean;
  onRecompute: () => void;
  onSave: (vineyardText: string, riverText: string) => void;
}

export function StepTreasuryCapital({ charter, recomputing, saving, onRecompute, onSave }: Props) {
  const [vineyardText, setVineyardText] = useState(charter.vineyard_replenishment_policy ?? "");
  const [riverText, setRiverText] = useState(charter.river_boundary_note ?? "");
  const snapshot = charter.treasury_snapshot;

  useEffect(() => {
    if (!snapshot && !recomputing) onRecompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-lg font-semibold text-foreground">Treasury &amp; Capital Structure</h2>
          <p className="text-sm text-muted-foreground">
            How capital is partitioned, replenished, and compounded — pulled live from this household's
            Sovereignty Survey.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button size="sm" variant="outline" onClick={onRecompute} disabled={recomputing}>
            {recomputing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
            Recompute Now
          </Button>
          {charter.treasury_snapshot_computed_at && (
            <span className="text-xs text-muted-foreground">
              Last computed {new Date(charter.treasury_snapshot_computed_at).toLocaleString("en-CA")}
            </span>
          )}
        </div>
      </div>

      {!snapshot ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <CollapsibleCard
            icon={Anchor}
            iconBgClassName="bg-amber-500/10"
            iconColorClassName="text-amber-600"
            title="Holding Tank"
            subtitle="Initial influx &amp; catchment — 90-day stabilization"
            headerRight={<p className="text-xl font-bold text-amber-600">{formatCurrency(snapshot.holding_tank_total)}</p>}
          >
            {snapshot.holding_tank_rows.length > 0 ? (
              <div className="space-y-2">
                {snapshot.holding_tank_rows.map((row) => (
                  <div key={row.id} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
                    <span>
                      {row.account_name} <span className="text-xs text-muted-foreground">· added {row.days_since_added}d ago</span>
                    </span>
                    <span className="font-medium">{formatCurrency(row.current_value)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No assets currently in the Holding Tank.</p>
            )}
          </CollapsibleCard>

          <CollapsibleCard
            icon={Grape}
            iconBgClassName="bg-primary/10"
            iconColorClassName="text-primary"
            title="The Vineyard"
            subtitle="Compounding engine"
            headerRight={<p className="text-xl font-bold text-primary">{formatCurrency(snapshot.vineyard_total)}</p>}
          >
            <div className="space-y-2">
              <Label htmlFor="vineyard-replenishment">Vineyard Replenishment Policy</Label>
              <p className="text-xs text-muted-foreground">
                Disciplined rules for harvesting Vineyard gains back into the Storehouses (e.g. planned
                rebalancing intervals) — capital never flows out on impulse.
              </p>
              <Textarea
                id="vineyard-replenishment"
                rows={4}
                value={vineyardText}
                onChange={(e) => setVineyardText(e.target.value)}
              />
            </div>
          </CollapsibleCard>

          <CollapsibleCard
            icon={Castle}
            iconBgClassName="bg-accent/10"
            iconColorClassName="text-accent"
            title="The Storehouses"
            subtitle="Strategic Asset Allocation"
            defaultCollapsed={false}
            headerRight={
              <p className="text-xl font-bold text-accent">
                {formatCurrency(
                  snapshot.storehouse_reserves.liquidity +
                    snapshot.storehouse_reserves.strategic +
                    snapshot.storehouse_reserves.philanthropic +
                    snapshot.storehouse_reserves.legacy,
                )}
              </p>
            }
          >
            {STOREHOUSE_CONFIG.map(({ key, name, icon: Icon }) => {
              const total = snapshot.storehouse_reserves[key];
              const target = snapshot.storehouse_targets[key];
              const pct = snapshot.storehouse_funded_pct[key];
              return (
                <div key={key} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-accent" />
                      <h4 className="text-sm font-medium text-foreground">{name}</h4>
                    </div>
                    <span className="text-sm font-semibold text-foreground">{formatCurrency(total)}</span>
                  </div>
                  {pct !== null && (
                    <div className="space-y-1">
                      <Progress value={pct} className="h-1.5 bg-muted [&>div]:bg-accent" />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{Math.round(pct)}% funded</span>
                        <span>Target: {formatCurrency(target)}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </CollapsibleCard>

          <div className="rounded-lg border border-border p-4 space-y-2">
            <Label htmlFor="river-boundary">The River Boundary Rule</Label>
            <p className="text-xs text-muted-foreground">
              The external market/macro environment is never modeled as an internal funding stream. An
              external windfall (e.g. an unsolicited buyout offer) routes into the Holding Tank for the
              90-day stabilization cycle — never straight to personal accounts or speculation.
            </p>
            <Textarea id="river-boundary" rows={3} value={riverText} onChange={(e) => setRiverText(e.target.value)} />
          </div>

          <div className="rounded-lg bg-muted/30 p-4">
            <p className="text-xs text-muted-foreground">Net Worth</p>
            <p className="text-2xl font-bold text-foreground">{formatCurrency(snapshot.net_worth)}</p>
          </div>

          <Button disabled={saving} onClick={() => onSave(vineyardText, riverText)}>
            Save and continue
          </Button>
        </>
      )}
    </div>
  );
}
