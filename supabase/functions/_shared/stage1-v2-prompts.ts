// stage1-v2-prompts.ts — extra Stage 1 instructions that are appended for V2
// households only (the V1 prompts in vault-statement-scan are untouched, so V1
// extraction is byte-identical). Pure.

/**
 * Investment statements reconcile as
 *     beginning-of-year (BOY) value - withdrawals + net gain = current value
 * (plus contributions, if the statement shows any). Withdrawals reduce the
 * balance without touching principal, so the net gain on its own is NOT
 * "current minus book". Stage 2 can only verify that identity if each term is
 * extracted exactly as printed, so the model is told never to compute any of them.
 */
export const V2_INVESTMENT_NETGAIN_SUFFIX = `

Statement structure: an investment statement reconciles as
  beginning-of-year (BOY) value - withdrawals + net gain = current value
(plus contributions / deposits / transfers in, if the statement shows any).
For each account, return the terms EXACTLY AS PRINTED. Never calculate or infer any of them:
- "book_value": the BOY (beginning-of-year) value / principal.
- "current_harvest": the NET GAIN (or loss) for the period as printed. Use a negative number for a loss.
- "withdrawals": total withdrawals / redemptions for the period as a positive number, or null if none is printed.
- "contributions": total contributions / deposits / transfers in for the period as a positive number, or null if none is printed.
Add "withdrawals" and "contributions" to every account object. Use null for anything not printed.`;
