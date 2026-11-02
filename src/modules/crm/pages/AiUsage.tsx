import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { AppLayout } from "@/shared/components/AppLayout";
import { PageBreadcrumbs } from "@/shared/components/PageBreadcrumbs";
import { supabase } from "@/shared/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { costCad, totalsBy, type Total, type UsageGroup } from "@/modules/crm/lib/aiUsage";

interface Row extends UsageGroup { day: string }

const cad = (n: number) => `$${n.toFixed(2)}`;
const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}k` : String(n));

function Table({ title, rows, total, first }: { title: string; rows: Total[]; total: number; first: string }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr><th className="py-1 font-normal">{first}</th><th className="text-right font-normal">Calls</th><th className="text-right font-normal">Input</th><th className="text-right font-normal">Cached</th><th className="text-right font-normal">Output and thinking</th><th className="text-right font-normal">Est. cost</th><th className="text-right font-normal">Share</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-border">
                <td className="py-1.5">{r.key}</td>
                <td className="text-right tabular-nums">{r.calls.toLocaleString("en-CA")}</td>
                <td className="text-right tabular-nums">{tokens(r.input)}</td>
                <td className="text-right tabular-nums">{tokens(r.cached)}</td>
                <td className="text-right tabular-nums">{tokens(r.output)}</td>
                <td className="text-right tabular-nums font-medium">{cad(r.cost)}</td>
                <td className="text-right tabular-nums text-muted-foreground">{total > 0 ? `${Math.round((r.cost / total) * 100)}%` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export default function AiUsage() {
  const [days, setDays] = useState("30");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    (async () => {
      const { data, error: err } = await supabase.rpc("ai_usage_summary" as never, { days: Number(days) } as never);
      if (err) setError(err.message); else setError(null);
      setRows(((data ?? []) as unknown as Row[]).map((r) => ({ ...r, calls: Number(r.calls), prompt_tokens: Number(r.prompt_tokens), cached_tokens: Number(r.cached_tokens), output_tokens: Number(r.output_tokens), thinking_tokens: Number(r.thinking_tokens) })));
      setLoading(false);
    })();
  }, [days]);

  const total = useMemo(() => rows.reduce((t, r) => t + costCad(r), 0), [rows]);
  const calls = useMemo(() => rows.reduce((t, r) => t + r.calls, 0), [rows]);
  const byLabel = useMemo(() => totalsBy(rows, (r) => r.label), [rows]);
  const byModel = useMemo(() => totalsBy(rows, (r) => r.model), [rows]);
  const byDay = useMemo(() => totalsBy(rows, (r) => r.day).sort((a, b) => b.key.localeCompare(a.key)), [rows]);

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageBreadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "AI usage" }]} />
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl">AI usage</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              What each Gemini call used, by the file that made it. Token counts only: no prompt or answer is kept. Costs are estimates in CAD from Google's rates; the Google invoice is the figure that counts. Logging began on the day this page shipped, so earlier spend is not here.
            </p>
          </div>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading</div>}
        {!loading && !error && rows.length === 0 && <p className="text-sm text-muted-foreground">Nothing logged yet. Calls appear here as the AI features run.</p>}
        {rows.length > 0 && (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <Card><CardHeader><CardTitle>Estimated cost</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold">{cad(total)}</div><p className="text-sm text-muted-foreground">CAD, last {days} days</p></CardContent></Card>
              <Card><CardHeader><CardTitle>Calls</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold">{calls.toLocaleString("en-CA")}</div><p className="text-sm text-muted-foreground">{cad(calls ? total / calls : 0)} a call on average</p></CardContent></Card>
              <Card><CardHeader><CardTitle>Per day</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold">{cad(byDay.length ? total / byDay.length : 0)}</div><p className="text-sm text-muted-foreground">over {byDay.length} day{byDay.length === 1 ? "" : "s"} with calls</p></CardContent></Card>
            </div>
            <Table title="By feature" rows={byLabel} total={total} first="File that made the call" />
            <Table title="By model" rows={byModel} total={total} first="Model" />
            <Table title="By day" rows={byDay} total={total} first="Day" />
          </>
        )}
      </div>
    </AppLayout>
  );
}
