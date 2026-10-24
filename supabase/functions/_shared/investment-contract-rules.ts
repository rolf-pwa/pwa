// investment-contract-rules.ts: the segregated fund contract after the iA application: the right-to-cancel window and the delivery letter. Pure.
// The number of business days to cancel is entered from the contract and information folder; it is never assumed here. Weekends are skipped; public holidays are not.

export interface ContractInput {
  contractNumber: string; accounts: string; amount: number; applicationUrl: string; applicationName: string; contractUrl: string; contractName: string;
  issuedOn: string; confirmationReceivedOn: string; cancelBusinessDays: number | null; fundFactsOn: string; fundFactsNote: string;
}
const ymdOk = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`)) ? String(v) : "");
const text = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
const url = (v: unknown) => { const s = text(v, 500); return /^https:\/\//.test(s) ? s : ""; };

export function cleanContract(raw: unknown): ContractInput {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const days = r.cancelBusinessDays === null || r.cancelBusinessDays === "" || r.cancelBusinessDays === undefined ? null : Math.round(Number(r.cancelBusinessDays));
  return {
    contractNumber: text(r.contractNumber, 60), accounts: text(r.accounts, 200), amount: num(r.amount), applicationUrl: url(r.applicationUrl), applicationName: text(r.applicationName, 200),
    contractUrl: url(r.contractUrl), contractName: text(r.contractName, 200), issuedOn: ymdOk(r.issuedOn), confirmationReceivedOn: ymdOk(r.confirmationReceivedOn),
    cancelBusinessDays: days !== null && Number.isFinite(days) && days >= 0 && days <= 60 ? days : null, fundFactsOn: ymdOk(r.fundFactsOn), fundFactsNote: text(r.fundFactsNote, 300),
  };
}

/** The date `n` business days after a date (Monday to Friday; the day itself is not counted). */
export function addBusinessDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  let left = n;
  while (left > 0) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) left--; }
  return d.toISOString().slice(0, 10);
}

export type CancelState = { state: "unset" | "open" | "closed"; endsOn: string | null; daysLeft: number | null };
/** Where the right-to-cancel window stands: unset until the confirmation date and the number of business days are known. */
export function cancelWindow(c: Pick<ContractInput, "confirmationReceivedOn" | "cancelBusinessDays">, today: string): CancelState {
  if (!c.confirmationReceivedOn || c.cancelBusinessDays === null) return { state: "unset", endsOn: null, daysLeft: null };
  const endsOn = addBusinessDays(c.confirmationReceivedOn, c.cancelBusinessDays);
  const left = Math.round((Date.parse(`${endsOn}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  return left >= 0 ? { state: "open", endsOn, daysLeft: left } : { state: "closed", endsOn, daysLeft: null };
}

const longDay = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-CA", { timeZone: "America/Vancouver", dateStyle: "long" });
const money = (v: unknown) => `$${Math.round(num(v)).toLocaleString("en-CA")}`;

/** The delivery letter, as Markdown the advisor edits. Blanks (____) mark what is still to be filled in; the letter will not send with any. */
export function deliveryLetter(i: { person: string; date: Date; c: ContractInput; modelLabel: string | null }): string {
  const { c } = i;
  const win = cancelWindow(c, i.date.toISOString().slice(0, 10));
  return [
    `# Your Segregated Fund Contract`,
    `**Date:** ${i.date.toLocaleDateString("en-CA", { timeZone: "America/Vancouver", dateStyle: "long" })}  \n**For:** ${i.person}  \n**From:** Rolf Issler, ProsperWise Advisors`,
    `## Your contract`,
    `Your iA Financial Group segregated fund contract${c.contractNumber ? ` (number ${c.contractNumber})` : ""} has been issued${c.issuedOn ? ` on ${longDay(c.issuedOn)}` : ""}.`,
    `- **Invested:** ${c.amount ? money(c.amount) : "____"}${c.accounts ? ` in your ${c.accounts}` : ""}${i.modelLabel ? `, in the iA ${i.modelLabel} model portfolio` : ""}`,
    `- **The Fund Facts and the information folder** were given to you ${c.fundFactsOn ? `on ${longDay(c.fundFactsOn)}` : "on ____"}${c.fundFactsNote ? ` (${c.fundFactsNote})` : ""}.`,
    `## Your right to cancel`,
    win.state === "unset" ? `You can cancel within ____ business days of receiving your confirmation of ____.` : `You received your confirmation on ${longDay(c.confirmationReceivedOn)}. You can cancel within ${c.cancelBusinessDays} business day${c.cancelBusinessDays === 1 ? "" : "s"} of receiving it, that is until **${longDay(win.endsOn!)}**. How to cancel is in your contract and information folder.`,
    `If you change your mind within that time, tell me or write to iA as your contract explains. After it, the contract's withdrawal terms apply, and a withdrawal can reduce your guarantees.`,
    `## Please confirm`,
    `Please check that this is right. By confirming you tell me that you have received your contract, the Fund Facts and the information folder, and that you understand your right to cancel.`,
  ].join("\n\n");
}
