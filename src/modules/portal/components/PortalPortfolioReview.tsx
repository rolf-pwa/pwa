import type { ReactNode } from "react";
import { Card, CardContent } from "@/shared/components/ui/card";
import type { ClientView, MixStatus } from "../../../../supabase/functions/_shared/portfolio-review-client";

const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }));
const short = (n: number) => (Math.abs(n) >= 1000 ? `$${Math.round(n / 100) / 10}k` : money(n));
const signed = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n >= 0 ? "+" : "-"}${money(Math.abs(n))}`);
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n.toFixed(1)}%`);
const day = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" }) : "");
const month = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { timeZone: "UTC", month: "short" });

// ProsperWise brand: Navy, Amber (bronze), Sand, Mist, Ash, Cloud (see the --pw-* variables in index.css).
const B = { navy: "hsl(var(--pw-navy))", amber: "hsl(var(--pw-amber))", sand: "hsl(var(--pw-sand))", mist: "hsl(var(--pw-mist))", ash: "hsl(var(--pw-ash))", cloud: "hsl(var(--pw-cloud))" };
const tint = (c: string, a: number) => `${c.slice(0, -1)} / ${a})`;
const MIX_CHIP: Record<MixStatus, { text: string; good: boolean }> = {
  inside: { text: "Inside your range", good: true },
  below: { text: "More growth-oriented than your profile", good: false },
  above: { text: "More conservative than your profile", good: false },
  unknown: { text: "", good: true },
};
const Chip = ({ good, children }: { good: boolean; children: ReactNode }) => (
  <span className="inline-block rounded-full px-2.5 py-1 text-xs font-medium" style={good ? { background: B.cloud, color: B.navy } : { background: tint(B.amber, 0.18), color: "hsl(26 40% 30%)" }}>{children}</span>
);
const DONUT = [B.navy, B.amber, B.mist, B.sand];
const FUND_COLORS = [B.navy, B.amber, B.mist, B.sand, B.ash, B.cloud];
// Funds outside the model are hatched, so they stand out from the solid model colours.
const OTHER_BG = `repeating-linear-gradient(45deg, ${B.amber} 0 4px, ${tint(B.amber, 0.35)} 4px 8px)`;

const Section = ({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) => (
  <section className="space-y-3 border-t border-border pt-5">
    <div><h4 className="font-serif text-base font-semibold text-foreground">{title}</h4>{lead && <p className="mt-0.5 text-sm text-muted-foreground">{lead}</p>}</div>
    {children}
  </section>
);

/** The value line: a small filled area, drawn with plain SVG (no chart library), with the first and last months labelled. */
function ValueLine({ points }: { points: { date: string; value: number }[] }) {
  const W = 320, H = 96, PAD = 6;
  const vals = points.map((p) => p.value);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = Math.max(1, hi - lo);
  const x = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - lo) / span) * (H - PAD * 2 - 8) - 4;
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" preserveAspectRatio="none" role="img" aria-label="Your portfolio value over time">
        <defs><linearGradient id="pwArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" style={{ stopColor: B.navy, stopOpacity: 0.18 }} /><stop offset="100%" style={{ stopColor: B.navy, stopOpacity: 0 }} /></linearGradient></defs>
        <path d={area} fill="url(#pwArea)" />
        <path d={line} fill="none" style={{ stroke: B.navy }} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        <circle cx={x(points.length - 1)} cy={y(points[points.length - 1].value)} r="4" style={{ fill: B.amber }} />
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground"><span>{month(points[0].date)}</span><span>{month(points[points.length - 1].date)}</span></div>
    </div>
  );
}

/** A donut of shares of 100, with a label in the middle. */
function Donut({ parts, colors, centre, sub }: { parts: { pct: number }[]; colors: string[]; centre: string; sub: string }) {
  const R = 52, C = 2 * Math.PI * R;
  let offset = 0;
  const total = parts.reduce((s, p) => s + p.pct, 0) || 1;
  return (
    <div className="relative h-36 w-36 shrink-0">
      <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90" role="img" aria-label={`${centre} ${sub}`}>
        <circle cx="70" cy="70" r={R} fill="none" style={{ stroke: B.cloud }} strokeWidth="18" />
        {parts.map((p, i) => {
          const len = (p.pct / total) * C;
          const el = <circle key={i} cx="70" cy="70" r={R} fill="none" style={{ stroke: colors[i % colors.length] }} strokeWidth="18" strokeDasharray={`${Math.max(0, len - 1.5)} ${C}`} strokeDashoffset={-offset} />;
          offset += len;
          return el;
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="font-serif text-xl font-semibold">{centre}</span><span className="text-[10px] text-muted-foreground">{sub}</span></div>
    </div>
  );
}

/** The plain-language reading of a chart. */
const Commentary = ({ lines }: { lines?: string[] }) =>
  lines && lines.length ? (
    <div className="space-y-1.5 rounded-lg p-3 text-sm leading-relaxed text-foreground" style={{ background: tint(B.sand, 0.35) }}>
      {lines.map((l, i) => <p key={i}>{l}</p>)}
    </div>
  ) : null;

/** A horizontal bar made of segments, each a share of 100. */
function Segments({ parts, label }: { parts: { pct: number; bg: string; title: string }[]; label: string }) {
  return (
    <div className="flex h-7 w-full overflow-hidden rounded-md bg-muted" role="img" aria-label={label}>
      {parts.filter((p) => p.pct > 0).map((p, i) => <div key={i} style={{ width: `${p.pct}%`, background: p.bg }} title={p.title} />)}
    </div>
  );
}

/**
 * The household's Portfolio Review, as Rolf approved it. Every figure was worked out in code and frozen when he published; the client sees
 * exactly that. Built to be looked at, not read: charts first, the numbers behind them one tap away. Staff see it too, as a preview.
 */
export function PortalPortfolioReview({ view, publishedAt, preview = false }: { view: ClientView; publishedAt?: string; preview?: boolean }) {
  const history = view.history ?? [];
  const up = (view.summary.ytdPct ?? 0) >= 0;
  const maxValue = Math.max(1, ...(view.accounts ?? []).map((a) => a.value ?? 0));
  const funds = view.funds;
  const modelFunds = funds ? funds.rows.filter((r) => r.inModel) : [];
  const otherHeld = funds ? funds.rows.filter((r) => !r.inModel).reduce((s, r) => s + r.heldPct, 0) : 0;
  const resetMax = Math.max(1, ...(view.reset?.rows ?? []).map((r) => r.newGuarantee));

  return (
    <Card data-testid="portfolio-review">
      <CardContent className="space-y-5 p-5 sm:p-6">
        <div>
          <h3 className="font-serif text-lg font-semibold text-foreground">{preview ? "Preview: " : ""}Your Portfolio Review</h3>
          <p className="text-xs text-muted-foreground">{view.householdLabel}{view.valuesAsOf ? ` · as of ${day(view.valuesAsOf)}` : ""}{publishedAt ? ` · shared ${day(publishedAt.slice(0, 10))}` : ""}</p>
        </div>

        {view.note && <blockquote className="whitespace-pre-line border-l-2 border-accent pl-3 text-sm text-foreground">{view.note}<footer className="mt-1 text-xs text-muted-foreground">Rolf</footer></blockquote>}

        {/* The headline */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
            <div>
              <p className="text-xs text-muted-foreground">Your portfolio</p>
              <p className="font-serif text-3xl font-semibold leading-none text-foreground">{money(view.summary.value)}</p>
            </div>
            <div className="text-right">
              <Chip good={up}>{up ? "▲" : "▼"} {pct(Math.abs(view.summary.ytdPct ?? 0))} this year</Chip>
              <p className="mt-1 text-xs text-muted-foreground">{signed(view.summary.changeYtd)} since January</p>
            </div>
          </div>
          {history.length >= 2 && <ValueLine points={history} />}
        </div>

        {view.accounts && (
          <Section title="Your accounts">
            <ul className="space-y-2.5">
              {[...view.accounts].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).map((a, i) => (
                <li key={i}>
                  <div className="flex items-baseline justify-between gap-2 text-sm"><span className="font-medium text-foreground">{a.label}{a.owner ? <span className="font-normal text-muted-foreground"> · {a.owner.split(" ")[0]}</span> : null}</span><span className="text-xs"><span className="font-medium">{short(a.value ?? 0)}</span>{a.ytdPct != null && <span className="ml-2" style={{ color: a.ytdPct >= 0 ? B.navy : "hsl(26 40% 30%)" }}>{a.ytdPct >= 0 ? "▲" : "▼"} {pct(Math.abs(a.ytdPct))}</span>}</span></div>
                  <div className="mt-1 h-2 rounded-full bg-muted"><div className="h-2 rounded-full" style={{ width: `${Math.max(2, ((a.value ?? 0) / maxValue) * 100)}%`, background: B.navy }} /></div>
                </li>
              ))}
            </ul>
            <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">All returns</summary>
              <table className="mt-2 w-full"><thead><tr className="text-left"><th className="py-1 pr-2 font-normal">Account</th><th className="px-2 text-right font-normal">This year</th><th className="px-2 text-right font-normal">1 year</th><th className="pl-2 text-right font-normal">3 years</th></tr></thead>
                <tbody>{view.accounts.map((a, i) => <tr key={i} className="border-t border-border/60"><td className="py-1 pr-2">{a.label}</td><td className="px-2 text-right">{pct(a.ytdPct)}</td><td className="px-2 text-right">{pct(a.oneYearPct)}</td><td className="pl-2 text-right">{pct(a.threeYearPct)}</td></tr>)}</tbody></table>
            </details>
          </Section>
        )}

        {view.mix && (
          <Section title="Your mix" lead={view.mix.profileLabel ? `Compared with your ${view.mix.profileLabel} profile` : undefined}>
            <div className="flex flex-col items-center gap-5 sm:flex-row">
              <Donut parts={view.mix.classes} colors={DONUT} centre={`${Math.round(view.mix.incomePct ?? 0)}%`} sub="income" />
              <div className="w-full flex-1 space-y-3">
                <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {view.mix.classes.map((c, i) => <li key={c.key} className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: DONUT[i % DONUT.length] }} />{c.label} {Math.round(c.pct)}%</li>)}
                </ul>
                {view.mix.rangeMin != null && view.mix.rangeMax != null && view.mix.incomePct != null && (
                  <div>
                    <div className="relative h-3 rounded-full bg-muted" role="img" aria-label={`Income ${pct(view.mix.incomePct)}; your profile's range is ${view.mix.rangeMin} to ${view.mix.rangeMax}%`}>
                      <div className="absolute h-3 rounded-full" style={{ left: `${view.mix.rangeMin}%`, width: `${view.mix.rangeMax - view.mix.rangeMin}%`, background: tint(B.amber, 0.35) }} />
                      <div className="absolute -top-1 h-5 w-1 rounded" style={{ left: `calc(${Math.min(100, Math.max(0, view.mix.incomePct))}% - 2px)`, background: B.navy }} />
                    </div>
                    <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>0% income</span><span>Your profile: {view.mix.rangeMin}–{view.mix.rangeMax}%</span><span>100%</span></div>
                  </div>
                )}
                {MIX_CHIP[view.mix.status].text && <Chip good={MIX_CHIP[view.mix.status].good}>{MIX_CHIP[view.mix.status].text}</Chip>}
              </div>
            </div>
            <Commentary lines={view.mix.commentary} />
          </Section>
        )}

        {funds && (
          <Section title={`Your funds and our ${funds.modelLabel} model portfolio`} lead={`${Math.round(funds.heldInModelPct)}% of what you hold is in the funds our model portfolio uses.`}>
            <div className="space-y-2.5">
              <div><p className="mb-1 text-xs text-muted-foreground">Our model portfolio</p><Segments label="Our model portfolio's funds" parts={modelFunds.map((r, i) => ({ pct: r.modelPct ?? 0, bg: FUND_COLORS[i % FUND_COLORS.length], title: `${r.name} ${r.modelPct}%` }))} /></div>
              <div><p className="mb-1 text-xs text-muted-foreground">Your portfolio</p><Segments label="Your funds" parts={[...modelFunds.map((r, i) => ({ pct: r.heldPct, bg: FUND_COLORS[i % FUND_COLORS.length], title: `${r.name} ${r.heldPct}%` })), { pct: otherHeld, bg: OTHER_BG, title: `Other funds ${otherHeld.toFixed(1)}%` }]} /></div>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {modelFunds.map((r, i) => <li key={r.name} className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: FUND_COLORS[i % FUND_COLORS.length] }} />{r.name}</li>)}
                {otherHeld > 0 && <li className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: OTHER_BG }} />Other funds (not part of the model)</li>}
              </ul>
            </div>
            <Commentary lines={funds.commentary} />
            <p className="text-xs text-muted-foreground">Our model portfolios as at {day(funds.modelAsOf)}.</p>
            <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Each fund</summary>
              <table className="mt-2 w-full"><thead><tr className="text-left"><th className="py-1 pr-2 font-normal">Fund</th><th className="px-2 text-right font-normal">Model</th><th className="pl-2 text-right font-normal">You hold</th></tr></thead>
                <tbody>{funds.rows.map((r) => <tr key={r.name} className="border-t border-border/60"><td className="py-1 pr-2">{r.name}{!r.inModel ? " (not part of the model)" : ""}</td><td className="px-2 text-right">{r.modelPct === null ? "—" : `${r.modelPct}%`}</td><td className="pl-2 text-right">{pct(r.heldPct)}</td></tr>)}</tbody></table>
            </details>
          </Section>
        )}

        {view.rebalance && (
          <Section title="What I propose" lead="To bring these accounts back in line with your profile, I propose switching between funds inside each account. No money moves between accounts.">
            <ul className="space-y-2.5">
              {view.rebalance.rows.map((r, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0"><span className="font-medium text-foreground">{r.label}</span>{r.owner ? <span className="text-muted-foreground"> · {r.owner.split(" ")[0]}</span> : null}<span className="block text-xs text-muted-foreground">{r.direction === "to_income" ? "From equity funds into income funds" : "From income funds into equity funds"}{r.taxable ? " · taxable account" : ""}</span></span>
                  <span className="shrink-0 font-serif text-base font-semibold" style={{ color: B.navy }}>about {money(r.amount)}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">These amounts move with markets, so I will confirm them with you before anything is done.{view.rebalance.hasTaxable ? " In a non-registered account a switch can create a taxable gain, and I will review that with you first." : ""}</p>
          </Section>
        )}

        {view.reset && (
          <Section title="Your death benefit guarantee" lead="Each year I can reset the death benefit guarantee on your segregated fund contracts to today's value. It costs nothing and does not change your fees.">
            <div className="rounded-lg p-4 text-center" style={{ background: tint(B.sand, 0.45) }}>
              <p className="text-xs" style={{ color: B.navy }}>Your death benefit guarantee after this year's reset</p>
              <p className="font-serif text-3xl font-semibold" style={{ color: B.navy }}>{money(view.reset.totalAfter ?? view.reset.rows.reduce((n, r) => n + r.newGuarantee, 0))}</p>
              <p className="text-xs" style={{ color: B.navy }}>up {money(view.reset.totalLift)} from {money(view.reset.totalNow ?? view.reset.rows.reduce((n, r) => n + r.currentGuarantee, 0))} today, across {view.reset.rows.length} account{view.reset.rows.length === 1 ? "" : "s"}</p>
            </div>
            <ul className="space-y-3">
              {view.reset.rows.map((r, i) => (
                <li key={i}>
                  <div className="flex items-baseline justify-between gap-2 text-sm"><span className="font-medium text-foreground">{r.name}{r.last4 ? ` …${r.last4}` : ""}{r.owner ? <span className="font-normal text-muted-foreground"> · {r.owner.split(" ")[0]}</span> : null}</span><span className="font-serif font-semibold" style={{ color: B.navy }}>{money(r.newGuarantee)}</span></div>
                  <div className="relative mt-1 h-2 rounded-full bg-muted"><div className="absolute h-2 rounded-full" style={{ width: `${(r.newGuarantee / resetMax) * 100}%`, background: B.amber }} /><div className="absolute h-2 rounded-full" style={{ width: `${(r.currentGuarantee / resetMax) * 100}%`, background: B.navy }} /></div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Guarantee today {money(r.currentGuarantee)} · up {money(r.lift)}</p>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground">Navy: your guarantee today. Bronze: what it becomes after the reset. These are estimates from your latest values: a reset locks in your value on the day I do it.</p>
          </Section>
        )}

        <div className="space-y-1 border-t border-border pt-3">
          {view.disclosures.map((d, i) => <p key={i} className="text-[11px] leading-snug text-muted-foreground">{d}</p>)}
        </div>
      </CardContent>
    </Card>
  );
}
