// stage1-v2-prompts.ts — extra Stage 1 instructions that are appended for V2
// households only (the V1 prompts in vault-statement-scan are untouched, so V1
// extraction is byte-identical). Pure.

/**
 * Investment statements reconcile as
 *     opening (beginning-of-year) balance + net transactions + net gain = closing value
 * where "net transactions" is deposits minus withdrawals and is printed as ONE
 * signed figure (negative = net withdrawals; withdrawals reduce the balance
 * without touching principal). Statements usually show several periods (e.g.
 * "since the beginning of the year" and "since contract issue"), each of which
 * reconciles on its own, so every term must come from the SAME period.
 * Stage 2 can only verify the identity if each term is extracted exactly as
 * printed, so the model is told never to compute any of them. The same goes
 * for the fund lines, which Stage 2 sums itself (withdrawal-availability.ts).
 */
export const V2_INVESTMENT_NETGAIN_SUFFIX = `

Statement structure: an investment statement reconciles as
  opening balance (beginning of the year) + net transactions + net gain = current value
where net transactions = deposits - withdrawals, printed as one signed figure.
For each account return these terms EXACTLY AS PRINTED. Never calculate or infer any of them:
- "book_value": the opening balance / beginning-of-year (BOY) value.
- "net_transactions": the net transactions figure (deposits - withdrawals) as a SIGNED number: negative when withdrawals exceed deposits. Use null if the statement prints no such figure.
- "current_harvest": the NET GAIN (or loss), often labelled "variation in value" or similar, as a signed number (negative for a loss).
If the statement shows several periods (for example "since the beginning of the year" and "since contract issue"), use the beginning-of-year / year-to-date column for ALL of book_value, net_transactions and current_harvest, so they reconcile to the same period.
Add "net_transactions" to every account object. Use null for anything not printed.

Fund holdings: if the statement lists the funds held in an account (a table of funds with values), add to that account
"funds": [ { "name": the fund's name, "category": the category heading printed above it (for example "Income Funds" or "Canadian Equity funds"), "value": the fund's value as printed } ]
Include EVERY fund of that account on EVERY page, even if the table continues across pages or is split into several series or sections. Copy each value exactly as printed; never add them up and never skip a fund. Use "funds": null if the statement lists no fund holdings.

Withdrawals: if the statement has a "Transaction details for the period" section (fund-by-fund list of dated transactions), add to that account
"income_withdrawals": [ { "fund": the fund or section name the transaction is listed under, "category": the category heading printed for that fund or section if any, "date": the transaction date as YYYY-MM-DD, "amount": the amount of the withdrawal as a POSITIVE number exactly as printed } ]
List EVERY transaction whose type is a withdrawal (for example "Withdrawal", "Redemption", "Partial surrender"). Do NOT list deposits or premiums, interest, switches, transfers or reallocations between funds, or fees. Use an empty list [] if the statement has a transaction details section but no withdrawals, and null if the statement has no transaction details at all. Never add the amounts up.`;
