import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import { supabase } from "@/shared/integrations/supabase/client";
import type { Perspective2Draft } from "../../hooks/useCharterIntake";

interface FiduciaryRow {
  contactName: string;
  role: string;
  name: string;
  firm: string | null;
}

export function FieldWithSuggestion({
  id,
  label,
  value,
  onChange,
  suggestion,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  suggestion?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {suggestion?.trim() && !value.trim() && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
          <p className="mb-2 whitespace-pre-wrap text-xs text-muted-foreground line-clamp-4">{suggestion}</p>
          <Button size="sm" variant="outline" onClick={() => onChange(suggestion)}>
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            Use this text
          </Button>
        </div>
      )}
      <Textarea id={id} rows={5} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

interface Props {
  householdId: string;
  discretionaryTrustGuidelines: string | null;
  poaIncapacityProtocol: string | null;
  shareholderVotingPhilosophy: string | null;
  draft: Perspective2Draft | null;
  drafting: boolean;
  saving: boolean;
  onDraft: () => void;
  onSave: (fields: {
    discretionary_trust_guidelines: string;
    poa_incapacity_protocol: string;
    shareholder_voting_philosophy: string;
  }) => void;
}

export function StepFiduciaryGuidance({
  householdId,
  discretionaryTrustGuidelines,
  poaIncapacityProtocol,
  shareholderVotingPhilosophy,
  draft,
  drafting,
  saving,
  onDraft,
  onSave,
}: Props) {
  const [fiduciaries, setFiduciaries] = useState<FiduciaryRow[]>([]);
  const [loadingFiduciaries, setLoadingFiduciaries] = useState(true);
  const [trustGuidelines, setTrustGuidelines] = useState(discretionaryTrustGuidelines ?? "");
  const [poaProtocol, setPoaProtocol] = useState(poaIncapacityProtocol ?? "");
  const [votingPhilosophy, setVotingPhilosophy] = useState(shareholderVotingPhilosophy ?? "");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from("contacts")
          .select(
            "id, first_name, last_name, lawyer_name, lawyer_firm, accountant_name, accountant_firm, executor_name, executor_firm, poa_name, poa_firm",
          )
          .eq("household_id", householdId);
        if (cancelled || !data) return;
        const rows: FiduciaryRow[] = [];
        for (const c of data) {
          const contactName = `${c.first_name} ${c.last_name || ""}`.trim();
          const roles: [string, string | null, string | null][] = [
            ["Lawyer", c.lawyer_name, c.lawyer_firm],
            ["Accountant", c.accountant_name, c.accountant_firm],
            ["Executor", c.executor_name, c.executor_firm],
            ["Power of Attorney", c.poa_name, c.poa_firm],
          ];
          for (const [role, name, firm] of roles) {
            if (name) rows.push({ contactName, role, name, firm });
          }
        }
        setFiduciaries(rows);
      } finally {
        if (!cancelled) setLoadingFiduciaries(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [householdId]);

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="space-y-1.5">
          <h2 className="font-serif text-lg font-semibold text-foreground">Fiduciary Guidance</h2>
          <p className="text-sm text-muted-foreground">
            Discretionary trust guidelines, the POA &amp; incapacity protocol, and shareholder voting &amp;
            succession philosophy — grounded in the household's own Bedrock and synced meeting transcripts.
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Fiduciary Contacts on File
          </h3>
          {loadingFiduciaries ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : fiduciaries.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">None on file for this household.</p>
          ) : (
            <div className="space-y-1">
              {fiduciaries.map((f, i) => (
                <p key={i} className="text-sm">
                  <span className="text-muted-foreground">
                    {f.contactName}&apos;s {f.role}:{" "}
                  </span>
                  <span className="font-medium">{f.name}</span>
                  {f.firm && <span className="text-muted-foreground"> ({f.firm})</span>}
                </p>
              ))}
            </div>
          )}
        </div>

        <Button variant="outline" size="sm" disabled={drafting} onClick={onDraft}>
          {drafting ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          )}
          Draft with AI
        </Button>

        <FieldWithSuggestion
          id="trust-guidelines"
          label="Discretionary Trust Guidelines"
          value={trustGuidelines}
          onChange={setTrustGuidelines}
          suggestion={draft?.discretionary_trust_guidelines}
        />
        <FieldWithSuggestion
          id="poa-protocol"
          label="POA & Incapacity Protocol"
          value={poaProtocol}
          onChange={setPoaProtocol}
          suggestion={draft?.poa_incapacity_protocol}
        />
        <FieldWithSuggestion
          id="voting-philosophy"
          label="Shareholder Voting & Succession Philosophy"
          value={votingPhilosophy}
          onChange={setVotingPhilosophy}
          suggestion={draft?.shareholder_voting_philosophy}
        />

        <Button
          disabled={saving}
          onClick={() =>
            onSave({
              discretionary_trust_guidelines: trustGuidelines,
              poa_incapacity_protocol: poaProtocol,
              shareholder_voting_philosophy: votingPhilosophy,
            })
          }
        >
          Save and continue
        </Button>
      </CardContent>
    </Card>
  );
}
