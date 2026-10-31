# Book-of-business diagnostic: plan

Status: stages 1 and 2 live; stage 4 built (awaiting merge). Stages 3 to 5 not started: the page already has the stage 3 basics (accept, dismiss, snooze, filters), so stage 3 is now filtering, sorting and totals.

## Goal
Examine every household against a fixed rulebook and produce a ranked, evidence-backed list of opportunities to offer more products and services. Staff only. The list prompts Rolf to start a conversation; it never recommends anything to a client.

## Decisions (Rolf, 2026-10-30)
- Opportunity types to start: insurance gaps, Sovereignty Charter, tier upgrade, consolidation of outside assets, corporate structuring, estate gaps. More later, so the rulebook must be easy to extend.
- Revenue estimates: yes, using the iA commission schedule (received; it is the advisor's net rate). An estimate is blank, not guessed, when there is no premium to apply it to.
- Surfaces: a standalone "Book of Business" page, plus a weekly section in Georgia's briefing.
- Order: stage 1 (data-gaps report and rulebook) comes first, ahead of the monthly pipeline and meeting loop follow-ups.

## Principles
1. Rules decide; the model only words. A finding exists because a deterministic rule fired on stored data. Georgia may turn a finding into plain language and a suggested approach, but never creates or scores one.
2. Every finding shows its evidence (the rows and values that triggered it) and a confidence level.
3. Missing data is not "no gap". If a rule's inputs are absent, it emits a data gap instead of a finding.
4. Staff only. No client-facing wording, portal or VFO exposure.
5. No real client names in code, tests, commits or PRs. Fixtures use made-up households.

## Data the rules read
| Source | Used for |
|---|---|
| `households`, `contacts`, `families`, `household_relationships` | who is in the household, dependants, ages |
| `service-tiering.ts` (`classifyTier`, grouped AUM) | tier, distance to the $250k / $750k / $2M thresholds |
| `vineyard_accounts`, `holding_tank`, `storehouses`, `storehouse_rules` | AUM, custodian, idle cash vs reserve targets |
| `insurance_policies` (type, coverage, cash value, renewal_date, beneficiaries), `insurance_needs_analyses`, `insurance_fact_finds`, `insurance_quotes` | coverage versus need, pending work |
| `liabilities` | debt with no linked coverage |
| `other_assets` (+ owners) | outside assets, property |
| `household_charters`, `sovereignty_charters` | charter status |
| `corporations`, `corporate_shareholders`, `corporate_vineyard_accounts` | structuring signals |
| `professionals`, `professional_engagements` | lawyer, accountant, executor, POA on file |
| `review_obligations` | open obligations |
| `sovereignty-diagnostics.ts` | passive income, SBD clawback, vault and document readiness |

## Rulebook v1
Each rule is a pure function: `(HouseholdSnapshot) => Finding[] | DataGap[]`.

| Type | Fires when | Needs (else data gap) |
|---|---|---|
| `insurance_coverage_gap` | dependants or liabilities exist and coverage is below the needs analysis, or no needs analysis and no policy | household members, liabilities, policies |
| `debt_protection` | a liability above a threshold has no linked coverage | liabilities |
| `charter_candidate` | Tier 2A, AUM above a floor, no ratified charter | tier, AUM |
| `tier_upgrade` | grouped AUM within a set margin of the next threshold | grouped AUM |
| `consolidation` | other assets or accounts held away from iA / JustWealth | assets, custodian |
| `corporate_structuring` | corporation with passive income near the SBD clawback, or holdco without a structure review | corporation financials |
| `estate_gap` | no beneficiary designations, or no lawyer, executor or POA on file | designations, professionals |
| `idle_cash` | balances above the Storehouse reserve target | storehouse rules |
| `policy_event` | renewal or conversion window within 90 days | policy dates |

Thresholds live in one config object so they can be tuned without touching the rules.

## Output shape
`Finding`: household_id, type, title, evidence[] (table, row id, value), est_value (nullable until commission schedule), confidence (high / medium / low), suggested_next_step, status.
`DataGap`: household_id, field, why it matters, which rule it blocks.
Household completeness score = share of rule inputs present.

## Storage (stage 2)
Table `opportunities`: id, household_id, type, evidence jsonb, est_value, confidence, status (open / dismissed / converted / snoozed), snoozed_until, dismissed_reason, converted_at, rule_version, first_seen, last_seen. Unique on (household_id, type, dedupe_key) so weekly runs update rather than duplicate. Staff-only RLS. Explicit grants per CLAUDE.md. A run that no longer sees a finding marks it resolved, not deleted.

## Build stages
1. **Rulebook + data-gaps report.** Pure module in `supabase/functions/_shared/`, vitest with made-up households, a read-only report of data gaps and completeness per household. No schema change.
2. **Storage and runner.** `opportunities` table, an edge function that runs the rulebook, weekly cron.
3. **Book of Business page.** Dense list rows, filters by type, tier and confidence, evidence drawer, accept / dismiss / snooze, totals.
4. **Georgia.** Weekly briefing section with the top items; accepting one creates a task. Add to the pre-meeting brief later.
5. **Learning loop.** Dismissal reasons and conversions tune thresholds.

## Open items
- iA commission schedule from Rolf (needed for stage 2 estimates).
- Per-rule thresholds (liability floor, AUM floor for charter, upgrade margin): propose defaults in stage 1 for Rolf to adjust.
- Compliance wording check before anything from this list reaches Georgia's outward-facing drafts (none planned).
- Remember to review `vertex-ai/index.ts` (Sovereignty Assistant) if the page or data model becomes something the assistant should know about.

## Commission schedule (received 2026-10-30)
`26-10-30 iA Financial - Commissions.pdf` (iA Agent MGA Section, effective 2026-10-26) sits in Rolf's Drive. It is the MGA schedule, so it shows what iA pays down the chain, not necessarily what Rolf keeps. Findings that shape stage 2:
- Life and living-benefit commission is a percentage of annual premium by product and by policy year (1st, 2nd to 5th, 6th to 10th, 11th on). Examples: Pick-a-Term T20 to T40 50% first year, then 5%, 3%, 3%; whole life L100 60%, then 5%, 2%, 2%; UL Genesis level 60%; critical illness riders 40 to 50% first year, then 3%.
- Commission needs a premium, and an opportunity has none until quoted. A stage 2 estimate therefore needs an assumed annual premium (from the needs-analysis shortfall and the client's age) or a real quote. Proposed: use the latest `insurance_quotes` premium when one exists, otherwise leave the estimate blank rather than guess.
- Savings and retirement lines pay a sales commission or an F-class fee; those suit the AUM-based types (consolidation, tier upgrade) but need the fee Rolf actually charges, not iA's schedule.
- There is a 2-year chargeback period on some structures and a first-year cap rule ($25,000 total); estimates should say "first-year, before chargeback".
- Answered 2026-10-30: the iA schedule is what is paid to the advisor, so its percentages are the net rate (no MGA split).

## Stage 2 as built
- `opportunities` (one row per household, type and key; staff read and update, only the run adds rows) and `opportunity_runs` (summary plus each household's completeness and gaps).
- `_shared/opportunity-reconcile.ts` (pure): new findings insert; existing ones refresh; a dismissed or converted opportunity is never reopened; a snooze lapses on its date; one that stops firing is marked resolved, not deleted; a household that could not be read never resolves anything.
- `_shared/opportunity-run.ts`: reads every household, applies the rules, saves through the reconcile plan, records the run.
- Monday 5 am Pacific cron (`book_of_business`, through `daily-briefing-generate`), watched by the job-health watchdog. `book-of-business-run` lets staff start a run from the page.
- The stage 1 `book-of-business-report` function is removed; the page now reads stored data.
- Revenue estimates (`est_value`) remain null for now. The rate question is settled (the iA schedule is the net rate); what is still needed is a premium, so the next step is to price from the latest `insurance_quotes` premium and leave the estimate blank when there is none.

## Stage 4 as built
- **Briefing:** the new opportunities of the week (open, first seen in the last 7 days) appear in the Today page's "firm" tile: the top three, surest first, each linking to its household on the Book of Business page, then one "and N more" line. The lines are built from the stored finding (`_shared/opportunity-briefing.ts`); the model never sees them and they are not ranked as today's priorities. Items drop off when decided (the briefing refresh knows `opp:` keys).
- **Accept:** a new status `accepted` and a `task_id` column (migration `20270108120000`). `book-of-business-accept` (staff only) creates one task for the person who clicked, due in a week, with the evidence and next step in its description, and links it back so a second click never makes a second task. Accepted opportunities are not reopened or resolved by later runs; Mark converted closes them.
- **Page:** Accept replaces Mark converted on open items; a briefing link opens the right household.
- Not done: Georgia does not yet add opportunities to the pre-meeting brief, and revenue estimates are still blank.

## Fix: families, households and noisy gaps (2026-10-31)
- **Pooling follows the tier engine.** A family is pooled only with a ratified Charter, a Virtual Family Office, or a tier set by hand (`isPooledFamily`, review-units.ts); otherwise each active household stands alone and is tiered on its own assets. The first version pooled every family, so households of one family all showed the family's AUM and family-level findings (Charter, tier line) repeated per household. Now a household shows its own AUM; a pooled family's findings are raised once, on the household with the most assets (`assignAnchors`). The stored tier is used when there is one.
- **Ended relationships:** households with `relationship_ended_at` are not read, and what was open for them is resolved on the next run.
- **Fewer false gaps:** a needs analysis is asked for only where cover matters (dependants, debt over the floor, or a policy); "Assets under management" is a gap only when accounts are on file with no values; a lawyer recorded as an engagement counts; a missing service tier is a gap only when a household has assets or a policy.
- **Page:** each row shows the household's own AUM and how it is tiered; click a kind of missing data to list only the households missing it.

## F-class migration rule (2026-10-31)
Rolf's migration plan sheet ("PWA 3.0 - Migration Plan", read each Monday run through the Drive export, never written to) lists accounts held under a chargeback (CB2, CB3 or CB5) load. The rule `fclass_migration` raises one finding per household whose accounts are within six months of their CB maturity date (or already past it): the total chargeback if moved today and the monthly F-class fee.
- **Columns are read by header name** (Investment Date, Original Investment, Load Type, CB Maturity Date, Managed Investments, Account Number), not by letter; in the sheet CB Maturity Date is column M and column L is Contract Status.
- **Chargeback** = original investment x sales commission rate for the load x the share still charged for the month the deposit is in (iA schedule notes 2 to 4: CB2 over 24 months, CB3 36, CB5 60; 100% for the first twelve months, then stepping down). Rates used: CB2 2.32%, CB3 2.5%, CB5 4%, the schedule's rates for standard funds. The sheet has no fund column, so FORLIFE Guaranteed Income & Growth (1.74 / 2.0 / 3%) and the Money Market fund (0%) are not told apart, and deposits made under an earlier schedule carried that schedule's rates. Treat the figure as an estimate until the rates are confirmed.
- **Withdrawals (2026-10-31):** the chargeback on a withdrawal was already charged to the advisor when it was made, so only what is still invested can be charged back. The exact base is the original investment less the withdrawals since: optional sheet column **Net Transactions**, copied from iA's "Since contract issue" balance screen (Net Transactions (Deposits - Withdrawals), negative for withdrawals). The base is the original plus that figure, kept between zero and the original (later deposits have their own chargeback clocks). Without the column the base is estimated as the lower of the original and the market value, which ignores growth (so overstates) and cannot see withdrawals hidden by growth when the market value is at or above the original; such a finding is medium confidence and the household gets a "Net transactions" missing-data entry naming the accounts. The CRM's `book_value` is the beginning-of-year value, not net deposits, so it cannot stand in. **Sign check:** a positive Net Transactions on an account whose market value is below its original is almost certainly withdrawals typed without the minus sign; it is not used (reading it as deposits would charge back on the whole original at full confidence), the estimate stands, the finding drops to medium, and the household gets an entry saying to check the sign.
- **Monthly F-class fee** = market value x 1% x 80% (the advisor's share) / 12, using the Managed Investments column.
- **Original Investment** is empty in the sheet today; Rolf will fill it. Until then each finding says the chargeback is not yet known (or "at least" when some accounts have it) and the household gets a missing-data entry.
- Accounts are matched to households by account number (digits only) from the investment accounts and the holding tank; accounts that match nothing are counted on the page by their last four digits.
- If the sheet cannot be read, these findings are left exactly as they were and the page says so.
- Not decided: whether to show a break-even (chargeback divided by the monthly fee).
