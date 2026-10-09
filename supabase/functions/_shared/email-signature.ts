// Emails sent through the Gmail API don't get the signature set in Gmail's own settings (that is added by
// the Gmail compose window only), so each staff member's signature (profiles.email_signature, plain text)
// is appended here. A blank signature means none.

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

export interface EmailSignature { text: string; html: string }

export function buildSignature(raw: string | null | undefined): EmailSignature | null {
  const text = (raw ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) return null;
  // Bare web addresses become links; everything else is escaped text.
  const html = text
    .split("\n")
    .map((line) =>
      esc(line).replace(/\b((?:https?:\/\/|www\.)[^\s<]+?)(?=[.,;:!?)]*(?:\s|$|<))/gi, (m) => {
        const href = /^https?:\/\//i.test(m) ? m : `https://${m}`;
        return `<a href="${href}">${m}</a>`;
      })
    )
    .join("<br>");
  return { text, html };
}

/** True when the draft already carries the signature's name block, so it is not added twice. */
export function alreadySigned(draft: string, sig: EmailSignature): boolean {
  const marker = sig.text.split("\n").find((l) => l.includes(",") && l.trim() !== "Thanks," && l.trim().length > 8)?.trim();
  return !!marker && draft.includes(marker);
}
