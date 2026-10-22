import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Search } from "lucide-react";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { supabase } from "@/shared/integrations/supabase/client";
import { INSURANCE_STAGES, type InsuranceStage } from "@/shared/lib/insurancePipeline";

interface Item { household_id: string; stage: InsuranceStage; moved_at: string; label: string; members: number }

/** Every household on the insurance board, in a column for its stage. A household is added from the picker and moved with the menu on its card. */
export default function InsuranceBoard() {
  const [items, setItems] = useState<Item[]>([]);
  const [others, setOthers] = useState<{ id: string; label: string }[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [{ data: rows }, { data: hs }] = await Promise.all([
      (supabase.from("insurance_pipeline" as any) as any).select("household_id, stage, moved_at"),
      supabase.from("households").select("id, label").order("label"),
    ]);
    const ids = (rows ?? []).map((r: any) => r.household_id);
    const { data: members } = ids.length ? await supabase.from("contacts").select("household_id").in("household_id", ids) : { data: [] as { household_id: string }[] };
    const count = new Map<string, number>();
    for (const m of members ?? []) count.set(m.household_id!, (count.get(m.household_id!) ?? 0) + 1);
    const name = new Map((hs ?? []).map((h) => [h.id, h.label]));
    setItems((rows ?? []).map((r: any) => ({ ...r, label: name.get(r.household_id) ?? "Household", members: count.get(r.household_id) ?? 0 })));
    setOthers((hs ?? []).filter((h) => !ids.includes(h.id)));
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const move = async (household_id: string, stage: InsuranceStage) => {
    await (supabase.from("insurance_pipeline" as any) as any).upsert({ household_id, stage, moved_at: new Date().toISOString(), moved_by: "advisor" });
    void load();
  };
  const shown = useMemo(() => items.filter((i) => i.label.toLowerCase().includes(q.trim().toLowerCase())), [items, q]);

  if (loading) return <Loader2 className="h-5 w-5 animate-spin" />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-serif text-2xl font-semibold">Insurance clients</h1>
        <div className="relative ml-auto w-56"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-8" placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="rounded-md border bg-background px-2 py-2 text-sm" value="" aria-label="Add a household" onChange={(e) => e.target.value && void move(e.target.value, "new_lead")}>
          <option value="">+ Add a household</option>
          {others.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5" data-testid="insurance-board">
        {INSURANCE_STAGES.map((s) => {
          const col = shown.filter((i) => i.stage === s.key);
          return (
            <section key={s.key} className="rounded-lg bg-muted/40 p-2" aria-label={s.label}>
              <h2 className="px-1 pb-2 text-sm font-medium">{col.length} {s.label}</h2>
              <div className="space-y-2">
                {col.map((i) => (
                  <Card key={i.household_id}><CardContent className="space-y-2 p-3">
                    <Link to={`/insurance/${i.household_id}`} className="block font-medium hover:underline">{i.label}</Link>
                    <p className="text-xs text-muted-foreground">{i.members} member{i.members === 1 ? "" : "s"} · in stage since {new Date(i.moved_at).toLocaleDateString("en-CA")}</p>
                    <select className="w-full rounded border bg-background px-1.5 py-1 text-xs" aria-label={`Move ${i.label}`} value={i.stage} onChange={(e) => void move(i.household_id, e.target.value as InsuranceStage)}>
                      {INSURANCE_STAGES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                    </select>
                  </CardContent></Card>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
