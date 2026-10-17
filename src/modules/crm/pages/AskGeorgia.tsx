import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, MessageCircle } from "lucide-react";
import { AppLayout } from "@/shared/components/AppLayout";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { getSupportOverview, reviewSupportConversation, setAway, type Away, type SupportConversation } from "@/modules/crm/lib/reviewAgent";

const when = (iso: string) => new Date(iso).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function AwayCard({ away, onSaved }: { away: Away; onSaved: () => void }) {
  const [from, setFrom] = useState(away.away_from ?? "");
  const [until, setUntil] = useState(away.away_until ?? "");
  const [note, setNote] = useState(away.note ?? "");
  const [busy, setBusy] = useState(false);
  const save = async (a: Away) => {
    setBusy(true);
    try { await setAway(a); toast.success(a.away_until ? "Away dates saved" : "Away dates cleared"); onSaved(); } catch (e: any) { toast.error(e?.message ?? "Couldn't save"); } finally { setBusy(false); }
  };
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-lg">When you are away</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">Weekends are covered automatically. For holidays and time off, set the dates. Georgia tells clients you are out of the office and when you are back, and still alerts you at once for urgent matters.</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1"><span className="block text-xs text-muted-foreground">From</span><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></label>
          <label className="space-y-1"><span className="block text-xs text-muted-foreground">Last day away</span><Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="w-40" /></label>
          <label className="min-w-[14rem] flex-1 space-y-1"><span className="block text-xs text-muted-foreground">Anything clients should know (optional)</span><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="For urgent matters, Georgia will alert Rolf." /></label>
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={busy || !until} onClick={() => save({ away_from: from || null, away_until: until, note: note || null })}>Save</Button>
          {away.away_until && <Button size="sm" variant="outline" disabled={busy} onClick={() => { setFrom(""); setUntil(""); setNote(""); void save({ away_from: null, away_until: null, note: null }); }}>Clear</Button>}
        </div>
      </CardContent>
    </Card>
  );
}

function Conversation({ c, onReviewed }: { c: SupportConversation; onReviewed: () => void }) {
  const [open, setOpen] = useState(false);
  const waiting = !!c.flag && !c.reviewed_at;
  return (
    <div className="border-b border-border px-3 py-2.5 text-sm last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="font-medium text-left">{c.contact_name}</button>
        {waiting && <Badge variant={c.flag === "urgent" ? "destructive" : "default"}>{c.flag === "urgent" ? "Urgent" : "Needs you"}</Badge>}
        {c.flag && c.reviewed_at && <Badge variant="secondary">Reviewed</Badge>}
        {c.away_when_flagged && <span className="text-xs text-muted-foreground">while you were away</span>}
        <span className="ml-auto text-xs text-muted-foreground">{when(c.updated_at)}</span>
        <Link to={`/contacts/${c.contact_id}`} className="text-xs underline">Contact</Link>
        {waiting && <Button size="sm" variant="outline" onClick={async () => { try { await reviewSupportConversation(c.id); onReviewed(); } catch (e: any) { toast.error(e?.message ?? "Couldn't update"); } }}>Mark reviewed</Button>}
      </div>
      {c.flag_summary && <p className="mt-1 text-muted-foreground">{c.flag_summary}</p>}
      {open && (
        <div className="mt-2 space-y-1.5 rounded-md bg-muted/40 p-3">
          {c.messages.map((m, i) => <p key={i}><span className="font-medium">{m.role === "user" ? "Client" : "Georgia"}: </span>{m.content}</p>)}
        </div>
      )}
    </div>
  );
}

export default function AskGeorgia() {
  const [data, setData] = useState<{ away: Away; conversations: SupportConversation[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { try { setData(await getSupportOverview()); setError(null); } catch (e: any) { setError(e?.message ?? "Couldn't load"); } }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl space-y-6 py-6">
        <div className="flex items-center gap-2"><MessageCircle className="h-6 w-6 text-accent" /><h1 className="font-serif text-2xl font-semibold">Ask Georgia</h1></div>
        <p className="text-sm text-muted-foreground">Georgia's conversations with clients in the portal. She answers what she can, files requests and shows the booking page. Anything that needs you is flagged here and notifies you in the app. Nothing is sent by email.</p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!data && !error && <Loader2 className="h-5 w-5 animate-spin" />}
        {data && (
          <>
            <AwayCard away={data.away} onSaved={load} />
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-lg">Conversations</CardTitle></CardHeader>
              <CardContent className="p-0">
                {data.conversations.length === 0 ? <p className="px-4 pb-4 text-sm text-muted-foreground">No conversations yet.</p> : data.conversations.map((c) => <Conversation key={c.id} c={c} onReviewed={load} />)}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
