import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarClock, CircleAlert, ExternalLink, ListTodo, Mail, Sparkles, UserRound, Users } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/shared/components/ui/sheet";
import { supabase } from "@/shared/integrations/supabase/client";
import { cn } from "@/shared/lib/utils";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import { TILE_LABEL, TILE_ORDER, buildTiles, loadSeen, newKeys, saveSeen, watched, type LiveToday, type TileId, type TodayGroup, type TodayItem } from "../lib/today";
import type { BriefingSections } from "../../../../supabase/functions/_shared/briefing-facts";

const ICON: Record<TileId, typeof Mail> = { messages: Mail, requests: Users, firm: CircleAlert, calendar: CalendarClock, tasks: ListTodo };
const EMPTY: Record<TileId, string> = { messages: "Nothing is waiting: no texts, no mail from people, no notices.", requests: "No client request is waiting on you.", firm: "Nothing is waiting on you.", calendar: "Nothing on the calendar.", tasks: "Nothing is overdue or due today." };
const HINT: Record<TileId, string> = { messages: "Texts and calls, mail from people, and iA and Adobe Sign notices.", requests: "Clients waiting on your reply.", firm: "What Georgia has handed to you.", calendar: "Today and the week ahead, as the calendar is now.", tasks: "Your tasks that are overdue or due today, and what is coming this week." };
const FIVE_MINUTES = 5 * 60 * 1000;

/** The live part of Today: unread texts and open client requests as they change, and new mail every five minutes. */
export function useTodayLive(enabled: boolean) {
  const [live, setLive] = useState<LiveToday | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reload = useCallback(async () => {
    try { const { data, error } = await supabase.functions.invoke("daily-briefing-generate", { body: { action: "ea_today_live" } }); if (!error && data?.ok) setLive(data as LiveToday); } catch { /* keep what is shown */ }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    void reload();
    const poll = setInterval(() => void reload(), FIVE_MINUTES);
    const soon = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => void reload(), 1500); };
    const channel = supabase.channel("today-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "quo_messages" }, soon)
      .on("postgres_changes", { event: "*", schema: "public", table: "quo_calls" }, soon)
      .on("postgres_changes", { event: "*", schema: "public", table: "portal_requests" }, soon)
      .on("postgres_changes", { event: "*", schema: "public", table: "portal_request_messages" }, soon)
      .subscribe();
    return () => { clearInterval(poll); if (timer.current) clearTimeout(timer.current); supabase.removeChannel(channel); };
  }, [enabled, reload]);
  return { live, reload };
}

function ItemRow({ item, fresh, onDone }: { item: TodayItem; fresh: boolean; onDone: (key: string) => void }) {
  const link = item.href ? (item.href.startsWith("http")
    ? <a href={item.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">{item.title}<ExternalLink className="h-3 w-3" /></a>
    : <Link to={item.href} className="font-medium text-accent hover:underline">{item.title}</Link>) : <span className="font-medium">{item.title}</span>;
  return (
    <li className={cn("rounded-md border p-3 text-sm", fresh && "border-accent/60 bg-accent/5")} data-testid="today-item" data-new={fresh ? "true" : "false"}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {link}{item.badge && <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">{item.badge}</span>}{fresh && <span className="ml-2 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">New</span>}
          {item.sub && <p className="mt-0.5 text-xs text-muted-foreground">{item.sub}</p>}
          {item.contactId && item.href && item.href.startsWith("http") && (
            <Link to={`/contacts/${item.contactId}`} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" data-testid="open-contact"><UserRound className="h-3 w-3" />Open {item.contactName ?? "the contact"}</Link>
          )}
        </div>
        {item.doneKey && <button type="button" aria-label="Mark done" title="Mark done" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border text-muted-foreground hover:border-accent hover:text-accent" onClick={() => onDone(item.doneKey!)}>✓</button>}
      </div>
    </li>
  );
}

/**
 * The tabs across the top of Today, in the CRM's style: Briefing first (the page itself), then Messages, Client requests, Georgia is waiting, Calendar and Tasks. Each shows how
 * many are open and a dot when something is new since it was last looked at; a tab other than Briefing opens its list in a side panel over the page, each item opening the person
 * it concerns, and closing the panel returns to Briefing. The open tab is in the address (?tab=messages) so a link can open Today straight at it.
 */
type TabId = "briefing" | TileId;
const isTile = (t: string | null): t is TileId => !!t && (TILE_ORDER as string[]).includes(t);

export function TodayTabs({ sections, live, onDone, briefing, aside }: { sections: BriefingSections | null; live: LiveToday | null; onDone: (key: string) => void; briefing: React.ReactNode; aside?: React.ReactNode }) {
  const tiles = useMemo(() => buildTiles(sections, live), [sections, live]);
  const phone = useIsMobile();
  const [params, setParams] = useSearchParams();
  const asked = params.get("tab");
  const tab: TabId = isTile(asked) ? asked : "briefing";
  const [opened, setOpened] = useState<{ id: TileId; seen: string[] | null } | null>(null);
  const [tick, setTick] = useState(0);

  // First visit in this browser: what is there now counts as seen, so the dots mean something from the next change on.
  useEffect(() => {
    for (const id of TILE_ORDER) if (loadSeen(id) === null && (id === "messages" || id === "requests" || id === "tasks" ? live !== null : sections !== null)) saveSeen(id, watched(tiles[id]).map((i) => i.key));
  }, [tiles, live, sections]);

  // What had been seen when this tab was opened (so the new items stay marked while you read them), then everything shown counts as seen.
  useEffect(() => { setOpened(isTile(tab) ? (opened && opened.id === tab ? opened : { id: tab, seen: loadSeen(tab) }) : null); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const ready = isTile(tab) && (tab === "messages" || tab === "requests" || tab === "tasks" ? live !== null : sections !== null);
  useEffect(() => { if (isTile(tab) && ready) { saveSeen(tab, watched(tiles[tab]).map((i) => i.key)); setTick((n) => n + 1); } }, [tab, tiles, ready]);

  const fresh = useMemo(() => (opened && isTile(tab) && opened.id === tab ? new Set(newKeys(watched(tiles[tab]), opened.seen)) : new Set<string>()), [opened, tab, tiles]);
  const select = (next: string) => setParams((p) => { const q = new URLSearchParams(p); if (next === "briefing") q.delete("tab"); else q.set("tab", next); return q; }, { replace: true });

  const section = (g: TodayGroup, titled: boolean) => {
    const list = <ul className="space-y-2">{g.items.map((it) => <ItemRow key={it.key} item={it} fresh={fresh.has(it.key)} onDone={onDone} />)}</ul>;
    if (g.items.length === 0 && !g.link) return null;
    return (
      <section key={g.id} className="space-y-2" data-testid={`group-${g.id}`}>
        {titled && <div className="flex items-baseline justify-between gap-3"><h3 className="text-sm font-semibold">{g.label} <span className="font-normal text-muted-foreground">{g.items.length}</span></h3>{g.link && <Link to={g.link.to} className="text-xs text-accent hover:underline" data-testid={g.link.testId}>{g.link.label}</Link>}</div>}
        {!titled && g.link && <p className="text-xs"><Link to={g.link.to} className="text-accent hover:underline" data-testid={g.link.testId}>{g.link.label}</Link></p>}
        {g.collapsed ? <details><summary className="cursor-pointer text-xs text-muted-foreground">Show {g.items.length}</summary><div className="mt-2">{list}</div></details> : list}
      </section>
    );
  };

  return (
    <Tabs value={tab} onValueChange={select} className="space-y-4">
      <TabsList className={cn("h-auto justify-start gap-1", phone ? "w-full flex-nowrap overflow-x-auto" : "flex-wrap")} data-testid="today-tiles" data-tick={tick}>
        <TabsTrigger value="briefing" data-testid="tile-briefing" className="gap-2"><Sparkles className="h-4 w-4 text-accent" />Briefing</TabsTrigger>
        {TILE_ORDER.map((id) => {
          const Icon = ICON[id], count = tiles[id].count, nw = id === tab ? 0 : newKeys(watched(tiles[id]), loadSeen(id)).length;
          return (
            <TabsTrigger key={id} value={id} data-testid={`tile-${id}`} className="relative gap-2">
              <Icon className="h-4 w-4 text-accent" />{TILE_LABEL[id]}
              <span className={cn("min-w-5 rounded-full px-1.5 text-center font-mono text-[11px] font-semibold", count > 0 ? "bg-accent/15 text-accent" : "bg-muted text-muted-foreground")} data-testid={`count-${id}`}>{count}</span>
              {nw > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" /><span className="relative inline-flex h-3 w-3 rounded-full bg-accent" data-testid={`new-${id}`} title={`${nw} new`} /></span>}
            </TabsTrigger>
          );
        })}
      </TabsList>
      {/* The page is always the Briefing and the chat; a tab other than Briefing opens its list in a panel beside them. */}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="min-w-0" data-testid="today-briefing">{briefing}</div>
        {aside && !phone && <div className="xl:sticky xl:top-4">{aside}</div>}
      </div>
      {/* Not modal: the tabs stay clickable while it is open, so you can move from one list to the next; a click anywhere else on the page, or Escape, closes it. */}
      <Sheet modal={false} open={isTile(tab)} onOpenChange={(o) => { if (!o) select("briefing"); }}>
        <SheetContent side={phone ? "bottom" : "right"} className={cn("overflow-y-auto", phone ? "max-h-[85dvh] rounded-t-2xl pb-[calc(1rem+env(safe-area-inset-bottom))]" : "w-full sm:max-w-md")} data-testid="today-panel" onInteractOutside={(e) => { if ((e.target as HTMLElement | null)?.closest?.('[data-testid="today-tiles"]')) e.preventDefault(); }}>
          {isTile(tab) && (
            <>
              <SheetHeader>
                <SheetTitle>{TILE_LABEL[tab]}</SheetTitle>
                <SheetDescription>{HINT[tab]} Click one to open it; the person it is about opens in their own page.</SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-5">
                {tiles[tab].groups.map((g) => section(g, tiles[tab].groups.length > 1))}
                {tiles[tab].groups.reduce((n, g) => n + g.items.length, 0) === 0 && <p className="text-sm text-muted-foreground">{EMPTY[tab]}</p>}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </Tabs>
  );
}
