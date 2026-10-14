// portfolio-review-data.ts: gathers what a household's Portfolio Review pack is built from. The comparison itself is in portfolio-review.ts.

// deno-lint-ignore-file no-explicit-any
import { MANAGED_CUSTODIANS } from "./monthly-import.ts";
import { buildPortfolioPack, type Guarantee, type InvestorProfile, type ModelPortfolio, type PackAccount, type StatementFunds } from "./portfolio-review.ts";

const norm = (s: string | null | undefined) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

export async function portfolioPackFor(db: any, householdId: string, today: string) {
  const { data: people } = await db.from("contacts").select("id, first_name, last_name, full_name, date_of_birth").eq("household_id", householdId);
  const contactIds = (people ?? []).map((p: any) => p.id);
  const dobOf = new Map((people ?? []).map((p: any) => [p.id, p.date_of_birth as string | null]));
  const ownerOf = new Map((people ?? []).map((p: any) => [p.id, p.full_name || `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim()]));

  const [{ data: tankRows }, { data: vineRows }] = await Promise.all([
    db.from("holding_tank").select("id, contact_id, account_name, account_number, account_type, custodian, current_value, book_value").or(`household_id.eq.${householdId}${contactIds.length ? `,contact_id.in.(${contactIds.join(",")})` : ""}`).neq("status", "moved"),
    contactIds.length ? db.from("vineyard_accounts").select("id, contact_id, account_name, account_number, account_type, custodian, current_value, book_value").in("contact_id", contactIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const managed = (r: any) => r.custodian && MANAGED_CUSTODIANS.includes(r.custodian);
  const rows = [
    ...(tankRows ?? []).filter(managed).map((r: any) => ({ ...r, table: "holding_tank_id" })),
    ...(vineRows ?? []).filter(managed).map((r: any) => ({ ...r, table: "vineyard_account_id" })),
  ];
  // The same account can sit in both tables: keep one per account number.
  const seen = new Set<string>();
  const accounts = rows.filter((r: any) => { const k = norm(r.account_number) || r.id; if (seen.has(k)) return false; seen.add(k); return true; });

  const tankIds = accounts.filter((a: any) => a.table === "holding_tank_id").map((a: any) => a.id);
  const vineIds = accounts.filter((a: any) => a.table === "vineyard_account_id").map((a: any) => a.id);
  const [{ data: snapT }, { data: snapV }] = await Promise.all([
    tankIds.length ? db.from("account_harvest_snapshots").select("holding_tank_id, snapshot_date, boy_value, current_value, ror_ytd, ror_6m, ror_1y, ror_3y, ror_5y, ror_since_inception").in("holding_tank_id", tankIds).order("snapshot_date", { ascending: false }) : Promise.resolve({ data: [] as any[] }),
    vineIds.length ? db.from("account_harvest_snapshots").select("vineyard_account_id, snapshot_date, boy_value, current_value, ror_ytd, ror_6m, ror_1y, ror_3y, ror_5y, ror_since_inception").in("vineyard_account_id", vineIds).order("snapshot_date", { ascending: false }) : Promise.resolve({ data: [] as any[] }),
  ]);
  const snapsOf = (a: any) => [...(snapT ?? []), ...(snapV ?? [])].filter((s: any) => s[a.table] === a.id);

  // Statements the advisor approved in the Vault scan: the latest one per account number.
  const { data: audits } = await db.from("stage2_verification_audit").select("extracted_entities, created_at").eq("household_id", householdId).eq("review_status", "approved").order("created_at", { ascending: false });
  const funds = new Map<string, StatementFunds & { at: string }>();
  const guarantees = new Map<string, { date: string; guarantee: Guarantee | null; allocation: PackAccount["statementAllocation"] }>();
  for (const au of audits ?? []) {
    const ex = au.extracted_entities?.extraction;
    for (const acc of ex?.accounts ?? []) {
      const key = norm(acc.account_number);
      const date = ex?.statement_date ?? null;
      // Guarantee and mix are read from the same latest statement per account as the funds.
      if (key && (acc.guarantee || acc.statement_allocation)) {
        const gPrev = guarantees.get(key);
        if (!gPrev || gPrev.date < (date ?? "")) {
          const g = acc.guarantee;
          guarantees.set(key, {
            date: date ?? "",
            guarantee: g ? { series: g.series ?? null, maturityDate: g.maturity_date ?? null, guaranteedAtMaturity: num(g.guaranteed_at_maturity), guaranteedAtDeath: num(g.guaranteed_at_death), lastQuarterFee: num(g.last_quarter_fee), valueOfFunds: num(g.value_of_funds) } : null,
            allocation: acc.statement_allocation ? { incomePct: num(acc.statement_allocation.income_pct), equityPct: num(acc.statement_allocation.equity_pct), profile: acc.statement_allocation.profile ?? null } : null,
          });
        }
      }
      if (!key || !Array.isArray(acc.funds) || !acc.funds.length) continue;
      const prev = funds.get(key);
      if (prev && (prev.statementDate ?? "") >= (date ?? "")) continue;
      funds.set(key, { statementDate: date, sourceFile: au.extracted_entities?.source?.file_name ?? null, at: au.created_at, funds: acc.funds.map((f: any) => ({ name: String(f.name ?? ""), category: f.category ?? null, value: num(f.value) ?? 0 })) });
    }
  }

  const { data: resetRows } = await db.from("guarantee_resets").select("account_number, last_reset_date").eq("household_id", householdId);
  const lastReset = new Map((resetRows ?? []).map((r: any) => [norm(r.account_number), r.last_reset_date as string | null]));

  const packAccounts: PackAccount[] = accounts.map((a: any) => {
    const snaps = snapsOf(a);
    const latest = snaps[0] ?? null;
    const prior = latest ? snaps.find((s: any) => s.snapshot_date < latest.snapshot_date) ?? null : null;
    return {
      id: a.id, name: a.account_name ?? "", number: a.account_number ?? null, type: a.account_type ?? null, custodian: a.custodian ?? null, owner: ownerOf.get(a.contact_id) ?? null,
      value: num(latest?.current_value) ?? num(a.current_value), boyValue: num(latest?.boy_value) ?? num(a.book_value), asOf: latest?.snapshot_date ?? null,
      returns: { ytd: num(latest?.ror_ytd), sixMonth: num(latest?.ror_6m), oneYear: num(latest?.ror_1y), threeYear: num(latest?.ror_3y), fiveYear: num(latest?.ror_5y), sinceInception: num(latest?.ror_since_inception) },
      priorValue: num(prior?.current_value), priorAsOf: prior?.snapshot_date ?? null,
      statement: funds.get(norm(a.account_number)) ?? null,
      guarantee: guarantees.get(norm(a.account_number))?.guarantee ?? null,
      statementAllocation: guarantees.get(norm(a.account_number))?.allocation ?? null,
      ownerDob: dobOf.get(a.contact_id) ?? null,
      lastResetDate: lastReset.get(norm(a.account_number)) ?? null,
    };
  });

  const { data: profRows } = await db.from("investor_profiles").select("*").eq("household_id", householdId);
  const profiles: InvestorProfile[] = (profRows ?? []).map((p: any) => ({ accountNumber: p.account_number, label: p.label, incomePct: num(p.income_pct), equityPct: num(p.equity_pct), bandPct: num(p.band_pct) ?? 0, asOf: p.as_of, source: p.source, profileKey: p.profile_key ?? null }));
  const models = await latestModels(db);
  // The household's value at each month-end: only dates where most accounts reported, so a thin month does not look like a fall.
  const byDate = new Map<string, { sum: number; n: number }>();
  for (const s of [...(snapT ?? []), ...(snapV ?? [])]) {
    const v = num(s.current_value);
    if (v === null) continue;
    const cur = byDate.get(s.snapshot_date) ?? { sum: 0, n: 0 };
    cur.sum += v; cur.n += 1; byDate.set(s.snapshot_date, cur);
  }
  const most = Math.max(0, ...[...byDate.values()].map((x) => x.n));
  const history = [...byDate.entries()].filter(([, x]) => x.n >= Math.ceil(most * 0.8)).map(([date, x]) => ({ date, value: Math.round(x.sum) })).sort((a, b) => a.date.localeCompare(b.date)).slice(-13);
  return { pack: buildPortfolioPack({ accounts: packAccounts, profiles, today, models, history }), profiles: profRows ?? [], models };
}

/** The newest published set of iA model portfolios. */
export async function latestModels(db: any): Promise<ModelPortfolio[]> {
  const { data: newest } = await db.from("ia_model_portfolios").select("as_of").order("as_of", { ascending: false }).limit(1).maybeSingle();
  if (!newest?.as_of) return [];
  const { data } = await db.from("ia_model_portfolios").select("*").eq("as_of", newest.as_of).order("sort_order");
  return (data ?? []).map((m: any) => ({ asOf: m.as_of, key: m.profile_key, label: m.label, incomeMin: Number(m.income_min), incomeMax: Number(m.income_max), equityMin: Number(m.equity_min), equityMax: Number(m.equity_max), incomeTarget: Number(m.income_target), funds: Array.isArray(m.funds) ? m.funds : [] }));
}
