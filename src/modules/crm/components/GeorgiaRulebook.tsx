import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, Undo2, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { BUILT_IN_RULES, addRule, decideSuggestion, forgetRule, getRulebook, scanForRules, setGeorgiaSwitch, undoActivity, type Rulebook } from "@/modules/crm/lib/georgiaRules";

/** What Georgia follows every day, what she did on her own this week (with an undo where one is possible), and rules she suggests from your repeated answers. */
export function GeorgiaRulebook() {
  const [data, setData] = useState<Rulebook | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setData(await getRulebook()); } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't load the rulebook"); } }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); await load(); } catch (e) { toast.error(e instanceof Error ? e.message : "That didn't work"); } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-lg">Georgia's rulebook</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">The standing rules she follows every day without asking again, what she did on her own this week, and rules she suggests after you give the same answer more than once. She only adds a rule when you accept it.</p>
        {!data ? <Loader2 className="h-4 w-4 animate-spin" /> : (
          <>
            {(data.switches ?? []).length > 0 && (
              <div className="space-y-1.5">
                <p className="font-medium">What she does on her own</p>
                {data.switches.map((sw) => (
                  <label key={sw.key} className="flex items-start gap-2">
                    <input type="checkbox" className="mt-1" checked={sw.enabled} disabled={busy} aria-label={sw.label} onChange={(e) => void run(() => setGeorgiaSwitch(sw.key, e.target.checked), e.target.checked ? "Switched on" : "Switched off")} />
                    <span><span className="font-medium">{sw.label}</span><span className="block text-xs text-muted-foreground">{sw.detail}</span></span>
                  </label>
                ))}
              </div>
            )}

            {data.suggestions.length > 0 && (
              <div className="space-y-2 rounded-md border border-accent/40 p-3">
                <p className="font-medium">She suggests ({data.suggestions.length})</p>
                {data.suggestions.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1"><p>{s.rule}</p><p className="text-xs text-muted-foreground">{s.evidence} ({s.times} times)</p></div>
                    <Button size="sm" disabled={busy} onClick={() => void run(() => decideSuggestion(s.id, "accept"), "Added to her rules")}><Check className="mr-1 h-3.5 w-3.5" />Make it a rule</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => decideSuggestion(s.id, "dismiss"))}><X className="mr-1 h-3.5 w-3.5" />No</Button>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-1.5">
              <p className="font-medium">Her standing rules ({data.rules.length})</p>
              {data.rules.length === 0 && <p className="text-muted-foreground">None yet. Add one below, or tell her in the meeting.</p>}
              {data.rules.map((r) => (
                <div key={r.id} className="flex items-start gap-2 border-b border-border pb-1.5 last:border-0">
                  <p className="min-w-0 flex-1">{r.kind === "mute_sender" ? `Do not show mail from ${r.value}` : r.value}</p>
                  {r.source === "learned" && <Badge variant="outline" className="shrink-0 text-[10px]">learned</Badge>}
                  <button type="button" className="shrink-0 text-xs text-muted-foreground underline" disabled={busy} onClick={() => void run(() => forgetRule(r.id))}>Forget</button>
                </div>
              ))}
              <form className="flex gap-2 pt-1" onSubmit={(e) => { e.preventDefault(); const v = text.trim(); if (v) void run(async () => { await addRule(v); setText(""); }, "Added"); }}>
                <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a rule, for example: Ask me before closing any task about an insurance policy" aria-label="New rule" />
                <Button type="submit" size="sm" disabled={busy || text.trim().length < 5}>Add</Button>
              </form>
            </div>

            <details>
              <summary className="cursor-pointer font-medium">How she works on her own ({BUILT_IN_RULES.length})</summary>
              <ul className="mt-1.5 space-y-1.5 text-xs text-muted-foreground">{BUILT_IN_RULES.map((b) => <li key={b.area}><span className="font-medium text-foreground">{b.area}:</span> {b.text}</li>)}</ul>
            </details>

            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <p className="font-medium">What she did on her own this week</p>
                <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" disabled={busy} onClick={() => void run(async () => { const r = await scanForRules(); toast.message(r.added ? `${r.added} new suggestion${r.added === 1 ? "" : "s"}` : "No new patterns found"); })}>Look for patterns now</Button>
              </div>
              {data.activity.length === 0 && <p className="text-muted-foreground">Nothing yet.</p>}
              {data.activity.map((a) => (
                <div key={a.id} className="flex items-start gap-2 border-b border-border pb-1.5 last:border-0">
                  <div className="min-w-0 flex-1"><p className={a.undone ? "text-muted-foreground line-through" : ""}>{a.summary}</p><p className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(a.at), { addSuffix: true })}{a.undone ? " · undone" : ""}</p></div>
                  {a.canUndo && <Button size="sm" variant="outline" className="h-7 shrink-0 text-xs" disabled={busy} onClick={() => void run(() => undoActivity(a.id), "Put back")}><Undo2 className="mr-1 h-3 w-3" />Undo</Button>}
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
