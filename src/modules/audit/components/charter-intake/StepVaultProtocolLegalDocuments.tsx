import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, Trash2, XCircle } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import type { GovernanceSnapshot, LegalDocument } from "../../hooks/useCharterIntake";

interface Props {
  documents: LegalDocument[];
  governanceSnapshot: GovernanceSnapshot | null;
  governanceSnapshotComputedAt: string | null;
  syncing: boolean;
  recomputing: boolean;
  saving: boolean;
  onSync: () => void;
  onRecompute: () => void;
  onSave: (rows: LegalDocument[]) => void;
}

export function StepVaultProtocolLegalDocuments({
  documents,
  governanceSnapshot,
  governanceSnapshotComputedAt,
  syncing,
  recomputing,
  saving,
  onSync,
  onRecompute,
  onSave,
}: Props) {
  const [rows, setRows] = useState<LegalDocument[]>(documents);

  useEffect(() => {
    setRows(documents);
  }, [documents]);

  useEffect(() => {
    if (!governanceSnapshot && !recomputing) onRecompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = (id: string) => setRows((prev) => prev.filter((d) => d.id !== id));
  const readiness = governanceSnapshot?.vault_protocol_readiness;

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="space-y-1.5">
          <h2 className="font-serif text-lg font-semibold text-foreground">Vault Protocol &amp; Legal Documents</h2>
          <p className="text-sm text-muted-foreground">
            Wills, powers of attorney, and trust indentures (Vault "Estate") and shareholder agreements or
            corporate minute books (Vault "Business") — synced directly from this household's Vault, never
            hand-pasted.
          </p>
        </div>

        <Button variant="outline" size="sm" disabled={syncing} onClick={onSync}>
          {syncing ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          )}
          Sync from Vault
        </Button>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No legal documents synced yet.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((d) => (
              <div key={d.id} className="rounded-md border border-border bg-muted/30 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {d.source_category}
                      </span>
                      <p className="text-sm font-medium">{d.document_type}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">{d.title}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{d.summary}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => remove(d.id)}
                    title="Remove from this Charter"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <Button disabled={saving} onClick={() => onSave(rows)}>
          Save and continue
        </Button>

        <div className="space-y-2 border-t border-border pt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Vault Protocol Readiness
            </h3>
            <Button size="sm" variant="outline" disabled={recomputing} onClick={onRecompute}>
              {recomputing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              Recompute
            </Button>
          </div>
          {governanceSnapshotComputedAt && (
            <p className="text-xs text-muted-foreground">
              Last computed {new Date(governanceSnapshotComputedAt).toLocaleString("en-CA")}
            </p>
          )}
          {readiness ? (
            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground">{readiness.percent}% of tracked Vault categories populated</p>
              {readiness.missingCritical.map((m) => (
                <p key={m} className="flex items-center gap-1.5 text-amber-600">
                  <XCircle className="h-3.5 w-3.5" /> {m}
                </p>
              ))}
              {readiness.criticalSatisfied > 0 && readiness.missingCritical.length < readiness.criticalTotal && (
                <p className="flex items-center gap-1.5 text-emerald-600">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {readiness.criticalSatisfied} of {readiness.criticalTotal} categories populated
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">Not yet computed.</p>
          )}
          <p className="text-xs text-muted-foreground">
            This reflects whether each Vault category has at least one file — not whether documents are
            current or complete. Staff should confirm currency manually.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
