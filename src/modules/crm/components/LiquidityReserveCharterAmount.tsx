import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/shared/integrations/supabase/client";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";

const toInput = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? "" : String(v));

/**
 * The Liquidity Reserve the Charter sets for this household. In the VFO portal, "Available to draw this year" is this amount less the withdrawals so
 * far this year (never more than the income funds held). Without it nothing is shown there. It is separate from a Liquidity storehouse's target on
 * purpose: setting a storehouse target would stop the income funds being counted as the Liquidity Reserve.
 */
export function LiquidityReserveCharterAmount({ householdId, value, onSaved }: { householdId: string; value: number | string | null | undefined; onSaved?: (v: number | null) => void }) {
  const [text, setText] = useState(toInput(value));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setText(toInput(value)); }, [value]);

  const parsed = text.trim() === "" ? null : Number(text.replace(/[$,\s]/g, ""));
  const invalid = parsed !== null && (!Number.isFinite(parsed) || parsed < 0);
  const unchanged = (parsed ?? null) === (value === null || value === undefined || value === "" ? null : Number(value));

  const save = async () => {
    if (invalid) { toast.error("Enter an amount of zero or more, or leave it empty."); return; }
    setSaving(true);
    const { error } = await supabase.from("households").update({ liquidity_reserve_amount: parsed } as never).eq("id", householdId);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(parsed === null ? "Cleared" : "Saved");
    onSaved?.(parsed);
  };

  return (
    <Card data-testid="liquidity-charter-card">
      <CardHeader><CardTitle className="text-base">Liquidity Reserve from the Charter</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">
          The amount the Charter sets for the Liquidity Reserve. The family's VFO page shows "Available to draw this year" as this amount less the withdrawals so far this year, never more than the income funds held. Leave it empty and nothing is shown.
        </p>
        <div className="flex items-center gap-2">
          <Input className="w-48" inputMode="decimal" placeholder="e.g. 150000" value={text} onChange={(e) => setText(e.target.value)} aria-label="Liquidity Reserve from the Charter" data-testid="liquidity-charter-input" />
          <Button size="sm" onClick={save} disabled={saving || invalid || unchanged} data-testid="liquidity-charter-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
        </div>
        {invalid && <p className="text-xs text-destructive">Enter an amount of zero or more.</p>}
      </CardContent>
    </Card>
  );
}
