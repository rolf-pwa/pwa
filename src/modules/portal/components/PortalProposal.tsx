import { useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { itemsOwnedBy, type ClientProposal } from "../../../../supabase/functions/_shared/portfolio-review-client";

const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }));
// ProsperWise brand: Navy, Amber (bronze), Sand, Cloud (see the --pw-* variables in index.css).
const B = { navy: "hsl(var(--pw-navy))", amber: "hsl(var(--pw-amber))", sand: "hsl(var(--pw-sand))", cloud: "hsl(var(--pw-cloud))" };
const tint = (c: string, a: number) => `${c.slice(0, -1)} / ${a})`;

/**
 * What I propose, for the client to review: the switches and the death benefit resets, each with a tick. The whole rebalancing is authorized
 * once every item is ticked ("Authorize"), or the client asks to talk it through first. Highlighted. In a staff preview the controls cannot be used.
 */
export function PortalProposal({ proposal: p, statement, onAuthorize, onTalk, title = "What I propose", showResetHeadline = true, viewerId = null, authorizedIds = [] }: { proposal: ClientProposal; statement: string; onAuthorize?: (ids: string[]) => Promise<void>; onTalk?: () => Promise<void>; title?: string; showResetHeadline?: boolean; viewerId?: string | null; authorizedIds?: string[] }) {
  // Each person authorizes the changes to the accounts they own. Anyone else's changes are shown, but are theirs to authorize from their own portal.
  const mineIds = new Set(viewerId ? itemsOwnedBy(p, viewerId).map((i) => i.id) : [...p.switches, ...p.resets].map((i) => i.id));
  const done = new Set(authorizedIds);
  const all = [...p.switches, ...p.resets].filter((i) => mineIds.has(i.id) && !done.has(i.id));
  const othersOpen = [...p.switches, ...p.resets].filter((i) => !mineIds.has(i.id) && !done.has(i.id));
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const interactive = Boolean(onAuthorize);
  const allTicked = all.length > 0 && all.every((i) => checked.has(i.id));
  const toggle = (id: string) => setChecked((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const run = async (fn?: () => Promise<void>) => { if (!fn) return; setBusy(true); try { await fn(); } finally { setBusy(false); } };

  const Tick = ({ id, label }: { id: string; label: string }) => {
    if (done.has(id)) return <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-bold text-white" style={{ background: B.navy }} title="Authorized">✓</span>;
    if (!mineIds.has(id)) return <input type="checkbox" aria-label={`Not yours to authorize: ${label}`} disabled className="mt-0.5 h-5 w-5 shrink-0 cursor-not-allowed opacity-40" />;
    return <input type="checkbox" aria-label={`Acknowledge ${label}`} checked={checked.has(id)} disabled={!interactive || busy} onChange={() => toggle(id)} className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-[hsl(var(--pw-navy))] disabled:cursor-not-allowed" />;
  };
  /** A line saying whose it is when it is not the signed-in person's, or that it is done. */
  const Whose = ({ id, owner }: { id: string; owner: string | null }) => done.has(id)
    ? <p className="text-[11px] font-medium" style={{ color: B.navy }}>Authorized</p>
    : !mineIds.has(id) ? <p className="text-[11px] italic text-muted-foreground">{owner ? owner.split(" ")[0] : "The account holder"} authorizes this one from their own portal.</p> : null;

  return (
    <section className="space-y-4 rounded-xl border-2 p-4 sm:p-5" style={{ borderColor: B.amber, background: tint(B.sand, 0.4) }} data-testid="proposal">
      <div>
        <h4 className="font-serif text-lg font-semibold text-foreground">{title}</h4>
        <p className="mt-0.5 text-sm text-muted-foreground">Tick each change you have reviewed, then authorize them, or ask to talk it through first. Nothing is done until I have confirmed the amounts with you.</p>
      </div>

      {p.switches.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Switches inside your accounts</p>
          <ul className="space-y-2.5">
            {p.switches.map((r) => (
              <li key={r.id} className="flex items-start gap-3 rounded-lg bg-card/80 p-3">
                <Tick id={r.id} label={r.label} />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex items-baseline justify-between gap-3"><span className="font-medium text-foreground">{r.label}{r.owner ? <span className="font-normal text-muted-foreground"> · {r.owner.split(" ")[0]}</span> : null}</span><span className="shrink-0 font-serif text-base font-semibold" style={{ color: B.navy }}>about {money(r.amount)}</span></div>
                  <p className="text-xs text-muted-foreground">{r.direction === "to_income" ? "From equity funds into income funds" : "From income funds into equity funds"}{r.toModel ? ", to bring this account back to my model portfolio" : ""}{r.taxable ? " · taxable account: a switch can create a gain, and I will review that with you first" : ""}</p>
                  <Whose id={r.id} owner={r.owner} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {p.resets.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Death benefit guarantee resets</p>
          {showResetHeadline && <div className="rounded-lg p-3 text-center" style={{ background: tint(B.cloud, 0.6) }}>
            <p className="text-xs" style={{ color: B.navy }}>Your death benefit guarantee after this year's reset</p>
            <p className="font-serif text-2xl font-semibold" style={{ color: B.navy }}>{money(p.totalAfter)}</p>
            <p className="text-xs" style={{ color: B.navy }}>up {money(p.totalLift)} from {money(p.totalNow)} today. A reset costs nothing and does not change your fees.</p>
          </div>}
          <ul className="space-y-2.5">
            {p.resets.map((r) => (
              <li key={r.id} className="flex items-start gap-3 rounded-lg bg-card/80 p-3">
                <Tick id={r.id} label={`reset ${r.label}`} />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex items-baseline justify-between gap-3"><span className="font-medium text-foreground">Reset {r.label}{r.owner ? <span className="font-normal text-muted-foreground"> · {r.owner.split(" ")[0]}</span> : null}</span><span className="shrink-0 font-serif text-base font-semibold" style={{ color: B.navy }}>{money(r.newGuarantee)}</span></div>
                  <p className="text-xs text-muted-foreground">Guarantee today {money(r.currentGuarantee)} · up {money(r.lift)}</p>
                  <Whose id={r.id} owner={r.owner} />
                </div>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground">These are estimates from your latest values: a reset locks in your value on the day it is done.</p>
        </div>
      )}

      {all.length === 0 && (
        <div className="rounded-lg p-3 text-sm" style={{ background: tint(B.cloud, 0.6), color: B.navy }}>
          {othersOpen.length > 0 ? "You have authorized your changes. The other account holder authorizes theirs from their own portal." : "Everything has been authorized."}
        </div>
      )}
      {all.length > 0 && (
      <div className="space-y-3 border-t pt-3" style={{ borderColor: tint(B.amber, 0.4) }}>
        <p className="text-[11px] leading-snug text-muted-foreground">{statement}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!interactive || busy || !allTicked} onClick={() => run(() => onAuthorize!(all.map((i) => i.id)))}>Authorize</Button>
          <Button variant="outline" disabled={!interactive || busy} onClick={() => run(onTalk)}>Talk it through</Button>
          {interactive && !allTicked && <button type="button" className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground" onClick={() => setChecked(new Set(all.map((i) => i.id)))}>Tick all</button>}
        </div>
        {interactive && !allTicked && <p className="text-[11px] text-muted-foreground">Tick every change to authorize. Not sure about one? Choose Talk it through.</p>}
        {!interactive && <p className="text-[11px] italic text-muted-foreground">Preview: the client can tick items and use these buttons.</p>}
      </div>
      )}
    </section>
  );
}
