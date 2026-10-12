// gmail-read.ts: reads a Gmail thread as the shared service mailbox. The parsing is pure (testable); fetchThread does the I/O.

export interface ThreadMessage {
  id: string;
  from: string;
  subject: string;
  labelIds: string[];
  internalDate: number;
  headers: Record<string, string>;
  text: string;
}

export function b64urlDecode(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

const stripHtml = (h: string) => h.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

// deno-lint-ignore no-explicit-any
export function extractPlainText(payload: any): string {
  if (!payload) return "";
  const walk = (part: any, mime: string): string | null => {
    if (part.mimeType === mime && part.body?.data) return b64urlDecode(part.body.data);
    for (const child of part.parts ?? []) {
      const hit = walk(child, mime);
      if (hit) return hit;
    }
    return null;
  };
  const plain = walk(payload, "text/plain");
  if (plain) return plain;
  const html = walk(payload, "text/html");
  return html ? stripHtml(html) : "";
}

// deno-lint-ignore no-explicit-any
export function headerMap(headers: any[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers ?? []) out[String(h.name).toLowerCase()] = String(h.value);
  return out;
}

// deno-lint-ignore no-explicit-any
export function normalizeMessage(m: any): ThreadMessage {
  const headers = headerMap(m.payload?.headers);
  return { id: m.id, from: headers["from"] ?? "", subject: headers["subject"] ?? "", labelIds: m.labelIds ?? [], internalDate: Number(m.internalDate ?? 0), headers, text: extractPlainText(m.payload) };
}

export async function fetchThread(accessToken: string, threadId: string): Promise<ThreadMessage[]> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`gmail_thread_failed [${res.status}]: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return (j.messages ?? []).map(normalizeMessage);
}
