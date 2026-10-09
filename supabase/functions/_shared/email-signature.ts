// Emails sent through the Gmail API don't get the signature set in Gmail's own settings (that is added by
// the Gmail compose window only), so staff signatures are appended here. Keyed by the sender's login email.

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

const SIGNATURES: Record<string, string[]> = {
  "rolf@prosperwise.ca": [
    "Thanks,",
    "Rolf",
    "",
    "Rolf Issler, BMGT, CLU",
    "Sudden Wealth Specialist | ProsperWise Advisors",
    "Turning Unexpected Windfalls Into Lasting Prosperity",
    "",
    "(778) 721-5208 | Kelowna, BC | www.prosperwise.ca",
  ],
};

export interface EmailSignature { text: string; html: string }

export function signatureFor(staffEmail: string | null | undefined): EmailSignature | null {
  const lines = SIGNATURES[(staffEmail || "").trim().toLowerCase()];
  if (!lines) return null;
  const html = lines
    .map((l) => esc(l).replace("www.prosperwise.ca", '<a href="https://www.prosperwise.ca">www.prosperwise.ca</a>'))
    .join("<br>");
  return { text: lines.join("\n"), html };
}

/** True when the draft already ends with this signature's name block, so it is not added twice. */
export function alreadySigned(draft: string, sig: EmailSignature): boolean {
  const marker = sig.text.split("\n").find((l) => l.includes(",") && l.trim() !== "Thanks,")?.trim();
  return !!marker && draft.includes(marker);
}
