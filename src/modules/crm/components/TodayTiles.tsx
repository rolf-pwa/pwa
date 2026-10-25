import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CircleAlert, ExternalLink, Inbox, Mail, MessageSquare, UserRound, Users } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/shared/components/ui/sheet";
import { supabase } from "@/shared/integrations/supabase/client";
import { cn } from "@/shared/lib/utils";
import { TILE_LABEL, TILE_ORDER, buildTiles, loadSeen, newKeys, saveSeen, type LiveToday, type TileId, type TodayItem } from "../lib/today";
import type { BriefingSections } from "../../../../supabase/functions/_shared/briefing-facts";

const ICON: Record<TileId, typeof Mail> = { texts: MessageSquare, replies: Mail, ia: Inbox, firm: CircleAlert, requests: Users };
const EMPTY: Record<TileId, string> = { texts: "Nothing unread on the business line.", replies: "No new mail from people.", ia: "No notices.", firm: "Nothing is waiting on you.", requests: "No client request is waiting on you." };
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
          {link}{fresh && <span className="ml-2 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">New</span>}
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
 * The row of buttons at the top of Today: calls and texts, mail to reply to, iA and Adobe Sign, what Georgia is waiting on, and client requests. Each shows how many
 * are open and a dot when something is new since the panel was last opened; a click opens the list beside the page, each item opening the person it concerns.
 */
export function TodayTiles({ sections, live, onDone }: { sections: BriefingSections | null; live: LiveToday | null; onDone: (key: string) => void }) {
  const tiles = useMemo(() => buildTiles(sections, live), [sections, live]);
  const [openTile, setOpenTile] = useState<TileId | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [seenTick, setSeenTick] = useState(0);

  // First visit in this browser: what is there now counts as seen, so the dots mean something from the next change on.
  useEffect(() => {
    for (const id of TILE_ORDER) if (loadSeen(id) === null && (id === "texts" || id === "requests" ? live !== null : sections !== null)) saveSeen(id, tiles[id].map((i) => i.key));
  }, [tiles, live, sections]);

  const open = (id: TileId) => { setFresh(new Set(newKeys(tiles[id], loadSeen(id)))); setOpenTile(id); };
  const close = () => { if (openTile) { saveSeen(openTile, tiles[openTile].map((i) => i.key)); setSeenTick((n) => n + 1); } setOpenTile(null); };
  const items = openTile ? tiles[openTile] : [];

  return (
    <>
      <div className="flex flex-wrap gap-2" role="toolbar" aria-label="What needs you" data-testid="today-tiles" data-tick={seenTick}>
        {TILE_ORDER.map((id) => {
          const Icon = ICON[id], count = tiles[id].length, nw = newKeys(tiles[id], loadSeen(id)).length;
          return (
            <button key={id} type="button" onClick={() => open(id)} data-testid={`tile-${id}`} className={cn("relative inline-flex items-center gap-2 rounded-lg border bg-card px-3.5 py-2 text-sm font-medium transition-colors hover:border-accent hover:bg-accent/5", count === 0 && "text-muted-foreground")}>
              <Icon className="h-4 w-4 text-accent" />{TILE_LABEL[id]}
              <span className={cn("min-w-5 rounded-full px-1.5 text-center font-mono text-[11px] font-semibold", count > 0 ? "bg-accent/15 text-accent" : "bg-muted text-muted-foreground")} data-testid={`count-${id}`}>{count}</span>
              {nw > 0 && <span className="absolute -right-1 -top-1 flex h-3 w-3"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" /><span className="relative inline-flex h-3 w-3 rounded-full bg-accent" data-testid={`new-${id}`} title={`${nw} new`} /></span>}
            </button>
          );
        })}
      </div>
      <Sheet open={openTile !== null} onOpenChange={(o) => { if (!o) close(); }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md" data-testid="today-panel">
          <SheetHeader>
            <SheetTitle>{openTile ? TILE_LABEL[openTile] : ""}</SheetTitle>
            <SheetDescription>{openTile === "texts" ? <>Unread on the business line. <Link to="/inbox" className="text-accent hover:underline" data-testid="open-full-inbox">Open the full inbox</Link></> : openTile === "requests" ? <>Waiting on your reply. <Link to="/ask-georgia" className="text-accent hover:underline">Open Ask Georgia</Link></> : "Click one to open it; the person it is about opens in their own page."}</SheetDescription>
          </SheetHeader>
          <ul className="mt-4 space-y-2">
            {items.map((it) => <ItemRow key={it.key} item={it} fresh={fresh.has(it.key)} onDone={onDone} />)}
            {items.length === 0 && openTile && <p className="text-sm text-muted-foreground">{EMPTY[openTile]}</p>}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}
