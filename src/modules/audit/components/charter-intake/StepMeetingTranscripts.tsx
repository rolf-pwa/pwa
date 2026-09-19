import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import type { MeetingTranscript } from "../../hooks/useCharterIntake";

interface Props {
  transcripts: MeetingTranscript[];
  syncing: boolean;
  saving: boolean;
  onSync: () => void;
  onSave: (rows: MeetingTranscript[]) => void;
}

export function StepMeetingTranscripts({ transcripts, syncing, saving, onSync, onSave }: Props) {
  const [rows, setRows] = useState<MeetingTranscript[]>(transcripts);

  useEffect(() => {
    setRows(transcripts);
  }, [transcripts]);

  const remove = (id: string) => setRows((prev) => prev.filter((t) => t.id !== id));

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="space-y-1.5">
          <h2 className="font-serif text-lg font-semibold text-foreground">Meeting Transcripts</h2>
          <p className="text-sm text-muted-foreground">
            Pulled directly from this household's Advisor Files → Meeting Notes folder in Drive — Gemini
            meeting transcripts, Stabilization Session summaries, or advisor notes filed there. Nothing is
            pasted in manually; drop a file in that folder, then sync.
          </p>
        </div>

        <Button variant="outline" size="sm" disabled={syncing} onClick={onSync}>
          {syncing ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          )}
          Sync from Drive
        </Button>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No meeting transcripts synced yet.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((t) => (
              <div key={t.id} className="rounded-md border border-border bg-muted/30 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{t.title}</p>
                    <p className="text-xs text-muted-foreground">
                      Synced {new Date(t.added_at).toLocaleDateString()}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{t.content_text}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => remove(t.id)}
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
      </CardContent>
    </Card>
  );
}
