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

/**
 * The messages to file when these are handled: themselves, plus every other message in their conversations that is still in the Inbox or unread,
 * so the whole conversation leaves the Inbox and not only the newest message (Gmail shows a conversation in the Inbox while any of its messages is there).
 * A starred message is never moved. If a conversation cannot be read, its own message is still filed.
 */
export async function withConversationSiblings(gm: Gm, ids: string[]): Promise<string[]> {
  const out = new Set(ids);
  try {
    const threadIds = new Set<string>();
    await Promise.all(ids.map(async (id) => {
      const r = await gm(`messages/${id}?format=minimal`);
      if (r.ok) { const t = (await r.json()).threadId; if (t) threadIds.add(String(t)); }
    }));
    await Promise.all([...threadIds].map(async (tid) => {
      const r = await gm(`threads/${tid}?format=minimal`);
      if (!r.ok) return;
      for (const m of ((await r.json()).messages ?? []) as { id: string; labelIds?: string[] }[]) {
        const labels = m.labelIds ?? [];
        if (!labels.includes("STARRED") && (labels.includes("INBOX") || labels.includes("UNREAD"))) out.add(m.id);
      }
    }));
  } catch { /* the messages themselves are still filed */ }
  return [...out];
}

export interface ThreadMessage { id: string; labelIds?: string[]; internalDate?: string }

/**
 * A conversation that is filed as handled but still sits in the Inbox. If every Inbox message in it is older than the newest handled one, the
 * leftovers are what an earlier filing missed: `archive` lists them (never a starred one). If an Inbox message is newer than the newest handled
 * one, someone replied after it was filed, so it is `newReply` and left alone for Rolf.
 */
export function staleHandledMessages(messages: ThreadMessage[], handledId: string): { archive: string[]; newReply: boolean } {
  const at = (m: ThreadMessage) => Number(m.internalDate ?? 0);
  const handled = messages.filter((m) => (m.labelIds ?? []).includes(handledId));
  const inbox = messages.filter((m) => (m.labelIds ?? []).includes("INBOX"));
  if (!handled.length || !inbox.length) return { archive: [], newReply: false };
  const newest = Math.max(...handled.map(at));
  if (inbox.some((m) => at(m) > newest)) return { archive: [], newReply: true };
  return { archive: inbox.filter((m) => !(m.labelIds ?? []).includes("STARRED")).map((m) => m.id), newReply: false };
}
