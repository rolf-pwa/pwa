import { useEffect, useState } from "react";
import { supabase } from "@/shared/integrations/supabase/client";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { ChevronsUpDown, X } from "lucide-react";

export type EntityKind = "household" | "contact" | "family" | "corporation";

interface Hit {
  id: string;
  label: string;
}

interface Props {
  kind: EntityKind;
  value: Hit | null;
  onChange: (value: Hit | null) => void;
  placeholder?: string;
}

const KIND_LABEL: Record<EntityKind, string> = {
  household: "a household",
  contact: "a contact",
  family: "a family",
  corporation: "a corporation",
};

async function search(kind: EntityKind, q: string): Promise<Hit[]> {
  if (kind === "contact") {
    const { data } = await supabase
      .from("contacts")
      .select("id, first_name, last_name")
      .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
      .limit(8);
    return (data || []).map((c) => ({ id: c.id, label: `${c.first_name} ${c.last_name ?? ""}`.trim() }));
  }
  if (kind === "family") {
    const { data } = await supabase.from("families").select("id, name").ilike("name", `%${q}%`).limit(8);
    return (data || []).map((f) => ({ id: f.id, label: f.name }));
  }
  if (kind === "corporation") {
    const { data } = await supabase.from("corporations").select("id, name").ilike("name", `%${q}%`).limit(8);
    return (data || []).map((c) => ({ id: c.id, label: c.name }));
  }
  // household: no name column of its own -- label + family name, matching
  // Households.tsx's own display convention ("{family name} · {label}").
  const { data } = await supabase
    .from("households")
    .select("id, label, families(name)")
    .is("relationship_ended_at", null)
    .ilike("label", `%${q}%`)
    .limit(8);
  return (data || []).map((h: any) => ({ id: h.id, label: `${h.families?.name ?? "Household"} · ${h.label}` }));
}

export function EntityPicker({ kind, value, onChange, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (q.trim().length < 2) {
        setHits([]);
        return;
      }
      setHits(await search(kind, q.trim()));
    }, 250);
    return () => clearTimeout(t);
  }, [q, kind]);

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-between font-normal">
            {value ? value.label : placeholder || `Search ${KIND_LABEL[kind]}…`}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-2" align="start">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${KIND_LABEL[kind]}…`}
            className="h-8 text-sm"
            autoFocus
          />
          <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
            {hits.length === 0 && q.trim().length >= 2 && (
              <p className="px-1 text-xs text-muted-foreground">No matches</p>
            )}
            {hits.map((h) => (
              <button
                key={h.id}
                onClick={() => {
                  onChange(h);
                  setOpen(false);
                  setQ("");
                }}
                className="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
              >
                {h.label}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {value && (
        <Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => onChange(null)} title="Clear">
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
