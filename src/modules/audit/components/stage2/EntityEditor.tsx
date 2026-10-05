import { useState } from "react";
import { Check, Crosshair, Pencil, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";
import { EDITABLE_FIELDS, parseFieldInput, type Correction, type ReviewItem } from "../../lib/stage2";

interface Props {
  kind: "investment" | "insurance";
  items: ReviewItem[];
  corrections: Correction[];
  selectedIndex: number | null;
  readOnly: boolean;
  onSelect: (index: number) => void;
  /** Called with the advisor's correction; `value === original` clears it. */
  onCorrect: (c: Correction) => void;
  onClear: (index: number, field: string) => void;
}

const fmt = (v: unknown, numeric: boolean) =>
  v === null || v === undefined || v === "" ? "—" : numeric && typeof v === "number" ? v.toLocaleString("en-CA", { style: "currency", currency: "CAD" }) : String(v);

/**
 * The extracted figures, one row per account/policy. Clicking a row locates
 * it on the source; the pencil is the 1-click override: type the right value,
 * press Enter. Corrections are held locally and recorded (with the original
 * AI value) only when the advisor approves.
 */
export function EntityEditor({ kind, items, corrections, selectedIndex, readOnly, onSelect, onCorrect, onClear }: Props) {
  const fields = EDITABLE_FIELDS[kind];
  const [editing, setEditing] = useState<{ index: number; field: string; text: string; error?: string } | null>(null);
  const corrected = (index: number, field: string) => corrections.find((c) => c.index === index && c.field === field);

  const commit = () => {
    if (!editing) return;
    const meta = fields.find((f) => f.key === editing.field)!;
    const value = parseFieldInput(editing.text, meta.numeric);
    if (value === undefined) { setEditing({ ...editing, error: "Enter a number" }); return; }
    onCorrect({ index: editing.index, field: editing.field, value });
    setEditing(null);
  };

  if (items.length === 0) return <p className="text-sm text-muted-foreground">Nothing was extracted from this document.</p>;
  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={index} className={cn("rounded border p-2", selectedIndex === index && "border-amber-500 bg-amber-50/50")}>
          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>{kind === "investment" ? "Account" : "Policy"} {index + 1}</span>
            <Button size="sm" variant="ghost" className="h-6 gap-1 px-2" onClick={() => onSelect(index)}>
              <Crosshair className="h-3 w-3" /> {item.source?.page_number ? `Locate · p.${item.source.page_number}` : "Locate"}
            </Button>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm md:grid-cols-3">
            {fields.map((f) => {
              const c = corrected(index, f.key);
              const isEditing = editing?.index === index && editing.field === f.key;
              return (
                <div key={f.key} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{f.label}</dt>
                  <dd className="flex items-center gap-1">
                    {isEditing ? (
                      <>
                        <Input autoFocus onFocus={(e) => e.currentTarget.select()} className="h-7" value={editing.text} aria-label={`${f.label} correction`} aria-invalid={!!editing.error}
                          onChange={(e) => setEditing({ ...editing, text: e.target.value, error: undefined })}
                          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(null); }} />
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={commit} aria-label="Save correction"><Check className="h-3 w-3" /></Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditing(null)} aria-label="Cancel"><X className="h-3 w-3" /></Button>
                      </>
                    ) : (
                      <>
                        <span className={cn("truncate", c && "font-medium text-amber-700")} title={c ? `AI read: ${fmt(item[f.key], f.numeric)}` : undefined}>
                          {fmt(c ? c.value : item[f.key], f.numeric)}
                        </span>
                        {!readOnly && (
                          <Button size="icon" variant="ghost" className="h-6 w-6" aria-label={`Correct ${f.label}`}
                            onClick={() => setEditing({ index, field: f.key, text: String((c ? c.value : item[f.key]) ?? "") })}><Pencil className="h-3 w-3" /></Button>
                        )}
                        {c && !readOnly && <Button size="sm" variant="link" className="h-6 px-1 text-xs" onClick={() => onClear(index, f.key)}>undo</Button>}
                      </>
                    )}
                  </dd>
                  {isEditing && editing.error && <p className="text-xs text-destructive" role="alert">{editing.error}</p>}
                </div>
              );
            })}
          </dl>
        </div>
      ))}
    </div>
  );
}
