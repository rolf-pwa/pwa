import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import type { NamedItem } from "../../hooks/useCharterIntake";

interface Props {
  items: NamedItem[];
  defaults: NamedItem[];
  heading: string;
  guidanceCopy: string;
  saving: boolean;
  onSave: (items: NamedItem[]) => void;
}

/** Shared by Core Values and System Grounding Principles -- both are a
 *  fixed set of 4 {key, title, description} rows with identical editing
 *  needs, so one component covers both rather than duplicating it twice. */
export function NamedListStep({ items, defaults, heading, guidanceCopy, saving, onSave }: Props) {
  const [rows, setRows] = useState<NamedItem[]>(items.length > 0 ? items : defaults);

  const updateRow = (index: number, patch: Partial<NamedItem>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="space-y-1.5">
          <h2 className="font-serif text-lg font-semibold text-foreground">{heading}</h2>
          <p className="text-sm text-muted-foreground">{guidanceCopy}</p>
        </div>

        <div className="space-y-3">
          {rows.map((row, i) => (
            <div key={row.key} className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-center gap-2">
                <Label className="sr-only" htmlFor={`item-title-${row.key}`}>
                  Title
                </Label>
                <Input
                  id={`item-title-${row.key}`}
                  value={row.title}
                  onChange={(e) => updateRow(i, { title: e.target.value })}
                  className="font-medium"
                />
                {row.title !== defaults[i]?.title && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0"
                    title="Reset title to standard"
                    onClick={() => updateRow(i, { title: defaults[i]?.title ?? row.title })}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <Textarea
                rows={3}
                value={row.description}
                onChange={(e) => updateRow(i, { description: e.target.value })}
                placeholder="How this shows up for this family…"
              />
            </div>
          ))}
        </div>

        <Button disabled={saving} onClick={() => onSave(rows)}>
          Save and continue
        </Button>
      </CardContent>
    </Card>
  );
}
