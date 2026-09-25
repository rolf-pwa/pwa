import { useEffect, useState } from "react";
import { Compass } from "lucide-react";
import { supabase } from "@/shared/integrations/supabase/client";
import { Badge } from "@/shared/components/ui/badge";
import { CollapsibleCard } from "@/shared/components/CollapsibleCard";
import { CATALYST_LABELS, type Catalyst } from "../lib/derive";
import { hubLabel, summarizeAnswers } from "../lib/diagnostic-summary";

export interface GeorgiaDiagnosticLead {
  id: string;
  first_name: string;
  catalyst: string;
  chosen_pathway: string;
  submitted_at: string;
  answers: Record<string, unknown> | null;
  risk_scores_calculated: {
    tax_drag_risk?: number;
    structure_safety?: number;
    noise_strain?: number;
    readiness_score?: number;
  } | null;
  diagnostic_payload: {
    emotional_state?: string | null;
    relational_state?: string | null;
    timeline_urgency?: string | null;
    primary_friction?: string | null;
  } | null;
  unstructured_stress_quote: string | null;
  freeform_extraction: { threat_detected?: boolean } | null;
  validation_text: string | null;
}

const Row = ({ label, value }: { label: string; value: string | null }) =>
  value ? (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{label}</p>
      <p className="text-sm text-foreground">{value}</p>
    </div>
  ) : null;

/** Presentational view of one Georgia diagnostic, for staff. */
export function GeorgiaDiagnosticView({ lead }: { lead: GeorgiaDiagnosticLead }) {
  const { rows, other } = summarizeAnswers(lead.catalyst, lead.answers);
  const hub = lead.diagnostic_payload;
  const risk = lead.risk_scores_calculated;

  return (
    <div className="space-y-4 text-sm">
      <p className="text-xs text-muted-foreground">
        Self-reported by the client before engagement. Staff-only — never shown to the client in this form.
      </p>

      {lead.unstructured_stress_quote && (
        <div className="rounded-md border border-border bg-muted/30 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">In their words</p>
          <p className="mt-1 whitespace-pre-wrap italic text-foreground">{lead.unstructured_stress_quote}</p>
          {lead.freeform_extraction?.threat_detected && (
            <Badge variant="outline" className="mt-2 border-destructive/50 text-[10px] text-destructive">
              Flagged by safety screening
            </Badge>
          )}
        </div>
      )}

      {hub && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Row label="Feeling" value={hubLabel("emotional_state", hub.emotional_state)} />
          <Row label="Hardest part" value={hubLabel("primary_friction", hub.primary_friction)} />
          <Row label="Who knows" value={hubLabel("relational_state", hub.relational_state)} />
          <Row label="Timeline" value={hubLabel("timeline_urgency", hub.timeline_urgency)} />
        </div>
      )}

      {rows.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Answers</p>
          {rows.map((r) => (
            <div key={r.key}>
              <p className="text-xs text-muted-foreground">{r.question}</p>
              <p className="text-foreground">{r.value}</p>
            </div>
          ))}
        </div>
      )}

      {other.length > 0 && (
        <div className="space-y-0.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Other answers (earlier version of the diagnostic)
          </p>
          {other.map((o) => (
            <p key={o.key} className="text-foreground">
              <span className="text-muted-foreground">{o.key}: </span>
              {o.value}
            </p>
          ))}
        </div>
      )}

      {risk && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Gauges (0–100)</p>
          <p className="text-foreground">
            Tax drag {risk.tax_drag_risk} · Structure safety {risk.structure_safety} · Noise strain {risk.noise_strain} ·
            Readiness {risk.readiness_score}
          </p>
        </div>
      )}

      {lead.validation_text && (
        <p className="border-l-2 border-accent pl-3 text-xs italic text-muted-foreground">
          Acknowledgment shown to them: {lead.validation_text}
        </p>
      )}
    </div>
  );
}

/**
 * The household's Georgia diagnostic, found by matching its members' emails to
 * a Georgia lead (so it works for existing contacts too, not only households
 * created from the lead). Renders nothing when there is none.
 */
export function GeorgiaDiagnosticCard({ householdId }: { householdId: string }) {
  const [lead, setLead] = useState<GeorgiaDiagnosticLead | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: members } = await supabase.from("contacts").select("email").eq("household_id", householdId);
      const emails = (members ?? []).map((m) => m.email).filter((e): e is string => !!e);
      if (emails.length === 0) return;
      const filter = emails.map((e) => `email.ilike."${e.replace(/"/g, "")}"`).join(",");
      const { data } = await supabase
        .from("georgia2_leads")
        .select(
          "id, first_name, catalyst, chosen_pathway, submitted_at, answers, risk_scores_calculated, diagnostic_payload, unstructured_stress_quote, freeform_extraction, validation_text",
        )
        .or(filter)
        .order("submitted_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled && data) setLead(data as unknown as GeorgiaDiagnosticLead);
    })();
    return () => {
      cancelled = true;
    };
  }, [householdId]);

  if (!lead) return null;
  const transition = CATALYST_LABELS[lead.catalyst as Catalyst] ?? lead.catalyst.replace(/_/g, " ");
  return (
    <CollapsibleCard
      icon={Compass}
      title="Georgia diagnostic"
      subtitle={`${transition} · ${new Date(lead.submitted_at).toLocaleDateString("en-CA")}`}
      defaultCollapsed
    >
      <GeorgiaDiagnosticView lead={lead} />
    </CollapsibleCard>
  );
}
