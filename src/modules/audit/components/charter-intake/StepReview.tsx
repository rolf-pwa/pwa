import { Loader2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import type { HouseholdCharter, StorehouseReserves } from "../../hooks/useCharterIntake";

const formatCurrency = (val: number) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);

const STOREHOUSE_LABELS: { key: keyof StorehouseReserves; label: string }[] = [
  { key: "liquidity", label: "Liquidity Reserve" },
  { key: "strategic", label: "Strategic Reserve" },
  { key: "philanthropic", label: "Philanthropic Trust" },
  { key: "legacy", label: "Legacy Trust" },
];

interface Props {
  charter: HouseholdCharter;
  completing: boolean;
  onComplete: () => void;
}

export function StepReview({ charter, completing, onComplete }: Props) {
  return (
    <Card>
      <CardContent className="space-y-6 p-6">
        <div className="space-y-1.5">
          <h2 className="font-serif text-lg font-semibold text-foreground">Review &amp; Complete</h2>
          <p className="text-sm text-muted-foreground">
            Confirm the Foundational Bedrock below before marking it complete. You can come back and edit
            any of this later.
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Family Vision</h3>
          {charter.vision_text?.trim() ? (
            <p className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-sm">
              {charter.vision_text}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground italic">Not yet written.</p>
          )}
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Core Values</h3>
          <div className="space-y-2">
            {charter.core_values.map((v) => (
              <div key={v.key} className="rounded-md border border-border bg-muted/30 p-3">
                <p className="text-sm font-medium">{v.title}</p>
                {v.description.trim() && <p className="mt-1 text-sm text-muted-foreground">{v.description}</p>}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            System Grounding Principles
          </h3>
          <div className="space-y-2">
            {charter.grounding_principles.map((p) => (
              <div key={p.key} className="rounded-md border border-border bg-muted/30 p-3">
                <p className="text-sm font-medium">{p.title}</p>
                {p.description.trim() && <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Treasury &amp; Capital Structure
          </h3>
          {charter.treasury_snapshot ? (
            <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-xs text-muted-foreground">AUM</p>
                  <p className="font-medium">{formatCurrency(charter.treasury_snapshot.aum)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Net Worth</p>
                  <p className="font-medium">{formatCurrency(charter.treasury_snapshot.net_worth)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Vineyard</p>
                  <p className="font-medium">{formatCurrency(charter.treasury_snapshot.vineyard_total)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Holding Tank</p>
                  <p className="font-medium">{formatCurrency(charter.treasury_snapshot.holding_tank_total)}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 border-t border-border pt-2">
                {STOREHOUSE_LABELS.map(({ key, label }) => (
                  <div key={key}>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="font-medium">
                      {formatCurrency(charter.treasury_snapshot!.storehouse_reserves[key])}
                      {charter.treasury_snapshot!.storehouse_funded_pct[key] !== null && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({Math.round(charter.treasury_snapshot!.storehouse_funded_pct[key]!)}% funded)
                        </span>
                      )}
                    </p>
                  </div>
                ))}
              </div>
              {charter.vineyard_replenishment_policy?.trim() && (
                <p className="whitespace-pre-wrap border-t border-border pt-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Vineyard policy: </span>
                  {charter.vineyard_replenishment_policy}
                </p>
              )}
              {charter.river_boundary_note?.trim() && (
                <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">River boundary: </span>
                  {charter.river_boundary_note}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              Not yet computed — visit the Treasury &amp; Capital Structure step.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Meeting Transcripts
          </h3>
          {charter.meeting_transcripts.length > 0 ? (
            <p className="rounded-md border border-border bg-muted/30 p-3 text-sm">
              {charter.meeting_transcripts.length} transcript{charter.meeting_transcripts.length === 1 ? "" : "s"}{" "}
              synced — most recent{" "}
              {new Date(
                Math.max(...charter.meeting_transcripts.map((t) => new Date(t.added_at).getTime())),
              ).toLocaleDateString()}
              .
            </p>
          ) : (
            <p className="text-sm text-muted-foreground italic">No meeting transcripts added yet.</p>
          )}
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Fiduciary Guidance
          </h3>
          <div className="space-y-2">
            {[
              ["Discretionary Trust Guidelines", charter.discretionary_trust_guidelines],
              ["POA & Incapacity Protocol", charter.poa_incapacity_protocol],
              ["Shareholder Voting & Succession Philosophy", charter.shareholder_voting_philosophy],
            ].map(([label, text]) => (
              <div key={label} className="rounded-md border border-border bg-muted/30 p-3">
                <p className="text-xs font-medium text-muted-foreground">{label}</p>
                {text?.trim() ? (
                  <p className="mt-1 whitespace-pre-wrap text-sm">{text}</p>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground italic">Not yet drafted.</p>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Boundary &amp; Capital Protocols
          </h3>
          <div className="space-y-2">
            {[
              ["The Sovereignty Boundary Protocol", charter.boundary_protocol_note],
              ["Capital Request Framework", charter.capital_request_framework_note],
              ["Matrimonial & Asset Ring-Fencing", charter.matrimonial_ringfencing_note],
            ].map(([label, text]) => (
              <div key={label} className="rounded-md border border-border bg-muted/30 p-3">
                <p className="text-xs font-medium text-muted-foreground">{label}</p>
                {text?.trim() ? (
                  <p className="mt-1 whitespace-pre-wrap text-sm">{text}</p>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground italic">Not yet drafted.</p>
                )}
              </div>
            ))}
          </div>
        </div>

        {charter.status === "complete" ? (
          <p className="text-sm font-medium text-emerald-600">
            Marked complete{charter.completed_at ? ` on ${new Date(charter.completed_at).toLocaleDateString()}` : ""}.
          </p>
        ) : (
          <Button
            disabled={completing}
            title={!charter.vision_text?.trim() ? "Family Vision is still empty — you can complete anyway." : undefined}
            onClick={onComplete}
          >
            {completing && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Mark Bedrock Complete
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
