import { Card, CardContent } from "@/shared/components/ui/card";
import type { ClientView, MixStatus } from "../../../../supabase/functions/_shared/portfolio-review-client";

const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }));
const signed = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n >= 0 ? "+" : "-"}${money(Math.abs(n))}`);
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n.toFixed(1)}%`);
const day = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" }) : "");
const acct = (name: string, owner: string | null, last4: string | null) => [name, [owner, last4 ? `…${last4}` : null].filter(Boolean).join(" · ")];

const MIX_TEXT: Record<MixStatus, string> = {
  inside: "inside your profile's range",
  below: "below your profile's income range (more growth-oriented)",
  above: "above your profile's income range (more conservative)",
  unknown: "",
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-2 border-t border-border pt-4">
    <h4 className="font-serif text-sm font-semibold text-foreground">{title}</h4>
    {children}
  </section>
);

/**
 * The household's Portfolio Review, as Rolf approved it. Every figure was worked out in code and frozen when he published; the client
 * sees exactly that. Staff see the same component as a preview before publishing.
 */
export function PortalPortfolioReview({ view, publishedAt, preview = false }: { view: ClientView; publishedAt?: string; preview?: boolean }) {
  return (
    <Card data-testid="portfolio-review">
      <CardContent className="space-y-4 p-5">
        <div>
          <h3 className="font-serif text-base font-semibold text-foreground">{preview ? "Preview: " : ""}Your Portfolio Review</h3>
          <p className="text-xs text-muted-foreground">
            {view.householdLabel}{view.valuesAsOf ? ` · values as of ${day(view.valuesAsOf)}` : ""}{publishedAt ? ` · shared ${day(publishedAt.slice(0, 10))}` : ""}
          </p>
        </div>

        {view.note && <blockquote className="whitespace-pre-line border-l-2 border-accent pl-3 text-sm text-foreground">{view.note}<footer className="mt-1 text-xs text-muted-foreground">Rolf</footer></blockquote>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div><p className="text-xs text-muted-foreground">Your portfolio</p><p className="font-serif text-lg font-semibold">{money(view.summary.value)}</p></div>
          <div><p className="text-xs text-muted-foreground">This year</p><p className="font-serif text-lg font-semibold">{signed(view.summary.changeYtd)}</p></div>
          <div><p className="text-xs text-muted-foreground">Return this year</p><p className="font-serif text-lg font-semibold">{pct(view.summary.ytdPct)}</p></div>
        </div>

        {view.accounts && (
          <Section title="Your accounts">
            <ul className="divide-y divide-border/60">
              {view.accounts.map((a, i) => {
                const [name, sub] = acct(a.name, a.owner, a.last4);
                return (
                  <li key={i} className="py-2 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="font-medium text-foreground">{name}</span><span className="font-medium">{money(a.value)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{sub}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">This year {pct(a.ytdPct)} · 1 year {pct(a.oneYearPct)} · 3 years {pct(a.threeYearPct)}</p>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        {view.mix && (
          <Section title="Your mix">
            <p className="text-sm text-foreground">
              Your accounts hold {pct(view.mix.incomePct)} in income funds and {pct(view.mix.equityPct)} in equity funds.
              {view.mix.profileLabel && view.mix.rangeMin != null ? ` Your ${view.mix.profileLabel} profile holds ${view.mix.rangeMin}–${view.mix.rangeMax}% in income funds, so you are ${MIX_TEXT[view.mix.status]}.` : view.mix.profileLabel ? ` Your profile is ${view.mix.profileLabel}.` : ""}
            </p>
            {view.mix.accounts.some((a) => a.status !== "inside" && a.status !== "unknown") && (
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {view.mix.accounts.filter((a) => a.status === "below" || a.status === "above").map((a, i) => <li key={i}>{a.name}{a.last4 ? ` …${a.last4}` : ""}: {pct(a.incomePct)} income, {MIX_TEXT[a.status]}</li>)}
              </ul>
            )}
          </Section>
        )}

        {view.funds && (
          <Section title={`Your funds and iA's ${view.funds.modelLabel} model`}>
            <p className="text-sm text-foreground">iA publishes a model portfolio for each profile (as at {day(view.funds.modelAsOf)}). {pct(view.funds.heldInModelPct)} of what you hold is in the funds that model uses. Rolf will talk through any differences with you.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b text-left text-muted-foreground"><th className="py-1 pr-2">Fund</th><th className="px-2 text-right">Model</th><th className="pl-2 text-right">You hold</th></tr></thead>
                <tbody>
                  {view.funds.rows.map((r) => (
                    <tr key={r.name} className="border-b last:border-0">
                      <td className="py-1 pr-2">{r.name}{!r.inModel && <span className="ml-1 text-muted-foreground">(not part of the model)</span>}</td>
                      <td className="px-2 text-right">{r.modelPct === null ? "—" : `${r.modelPct}%`}</td>
                      <td className="pl-2 text-right">{pct(r.heldPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {view.reset && (
          <Section title="Resetting your death benefit guarantee">
            <p className="text-sm text-foreground">Each year Rolf can reset the death benefit guarantee on your segregated fund contracts to today's value. It costs nothing and does not change your fees. This year's reset would raise the guarantee by {money(view.reset.totalLift)} in total.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b text-left text-muted-foreground"><th className="py-1 pr-2">Account</th><th className="px-2 text-right">Guarantee now</th><th className="px-2 text-right">After reset</th><th className="pl-2 text-right">Increase</th></tr></thead>
                <tbody>
                  {view.reset.rows.map((r, i) => (
                    <tr key={i} className="border-b last:border-0"><td className="py-1 pr-2">{r.name}{r.last4 ? ` …${r.last4}` : ""}{r.owner ? ` (${r.owner})` : ""}</td><td className="px-2 text-right">{money(r.currentGuarantee)}</td><td className="px-2 text-right">{money(r.newGuarantee)}</td><td className="pl-2 text-right">{signed(r.lift)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        <div className="space-y-1 border-t border-border pt-3">
          {view.disclosures.map((d, i) => <p key={i} className="text-[11px] leading-snug text-muted-foreground">{d}</p>)}
        </div>
      </CardContent>
    </Card>
  );
}
