// gmail-handled.ts: the Georgia/Handled Gmail label. An email carrying it, or out of the Inbox, is done as far as the briefing is concerned.
// Georgia files mail with it in the meeting, the Done button on a briefing email files it the same way, and Rolf can apply it by hand in Gmail.

export const HANDLED_LABEL = "Georgia/Handled";
export const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

export type Gm = (path: string, init?: RequestInit) => Promise<Response>;

/** A Gmail caller for one account's access token. */
export const gmailFor = (token: string): Gm => (path, init) =>
  fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });

/** The id of the label if it exists; null when it does not, or when Gmail cannot be read. */
export async function findHandledLabelId(gm: Gm): Promise<string | null> {
  const list = await gm("labels");
  if (!list.ok) return null;
  const found = ((await list.json()).labels ?? []).find((l: { name?: string }) => l.name === HANDLED_LABEL);
  return found?.id ?? null;
}

/** The id of the label, made the first time it is needed. */
export async function handledLabelId(gm: Gm): Promise<string | null> {
  const found = await findHandledLabelId(gm);
  if (found) return found;
  const made = await gm("labels", { method: "POST", body: JSON.stringify({ name: HANDLED_LABEL, labelListVisibility: "labelShow", messageListVisibility: "show" }) });
  return made.ok ? (await made.json()).id ?? null : null;
}

/** Whether a message is still waiting in the Inbox: in it, and not labelled handled. */
export const stillInInbox = (labelIds: string[] | undefined, handledId: string | null): boolean =>
  (labelIds ?? []).includes("INBOX") && !(handledId && (labelIds ?? []).includes(handledId));
