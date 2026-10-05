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
 * printed, so the model is told never to compute any of them.
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
Add "net_transactions" to every account object. Use null for anything not printed.`;
