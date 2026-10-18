// inbox-sweep-handlers.ts: Georgia sorts the signed-in staff member's own recent inbox mail and proposes what to do with it. READ-ONLY:
// the Gmail scope the app holds cannot change a message, and nothing here tries to. Only sender, subject and a short snippet go to the model.
// Served by daily-briefing-generate (ea_sweep_run / ea_sweep_list / ea_sweep_feedback): the project is at its function cap.

// deno-lint-ignore-file no-explicit-any
import { getValidGoogleAccessToken } from "./google-token.ts";
import { GEMINI_EXTRACT_MODEL, generateVertexContent, parseServiceAccountKey, withThinking } from "./vertex-ai.ts";
import { accuracy, addressOf, ruleVerdict, SWEEP_TOOL, sweepPrompt, verdictsFromModel, type SweepMessage, type Verdict } from "./inbox-sweep.ts";

const MAX_NEW = 60;
const WINDOW_DAYS = 7;

const header = (headers: any[], name: string) => headers?.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

export async function sweepRun(db: any, userId: string) {
  const token = await getValidGoogleAccessToken(db, userId);
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const list = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?` + new URLSearchParams({ q: `in:inbox newer_than:${WINDOW_DAYS}d`, maxResults: "100" }), auth);
  if (!list.ok) throw new Error(`Gmail list error: ${list.status}`);
  const ids: string[] = ((await list.json()).messages || []).map((m: any) => m.id);
  if (!ids.length) return { sorted: 0, remaining: 0 };

  const { data: done } = await db.from("inbox_sweep_items").select("message_id").eq("user_id", userId).in("message_id", ids);
  const seen = new Set((done ?? []).map((r: any) => r.message_id));
  const fresh = ids.filter((id) => !seen.has(id));
  const batch = fresh.slice(0, MAX_NEW);
  if (!batch.length) return { sorted: 0, remaining: 0 };

  const details = await Promise.all(batch.map(async (id) => {
    const params = new URLSearchParams({ format: "metadata" });
    for (const h of ["Subject", "From", "To", "List-Unsubscribe"]) params.append("metadataHeaders", h);
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?${params}`, auth);
    return r.ok ? await r.json() : null;
  }));
  const msgs: SweepMessage[] = details.filter(Boolean).map((m: any) => ({
    id: m.id,
    threadId: m.threadId,
    from: header(m.payload?.headers, "From"),
    subject: header(m.payload?.headers, "Subject") || "(no subject)",
    snippet: String(m.snippet || "").slice(0, 160),
    labels: m.labelIds || [],
    bulk: !!header(m.payload?.headers, "List-Unsubscribe"),
    receivedAt: Number(m.internalDate || 0),
  }));

  const [{ data: contacts }, { data: prefs }] = await Promise.all([
    db.from("contacts").select("email").not("email", "is", null).limit(10000),
    db.from("ea_preferences").select("value").eq("staff_user_id", userId).eq("kind", "mute_sender").eq("active", true),
  ]);
  const clients = new Set<string>((contacts ?? []).map((c: any) => String(c.email).trim().toLowerCase()).filter(Boolean));
  const muted = (prefs ?? []).map((p: any) => String(p.value));

  const verdicts = new Map<string, Verdict>();
  const undecided: SweepMessage[] = [];
  for (const m of msgs) {
    const v = ruleVerdict(m, clients, muted);
    if (v) verdicts.set(m.id, v); else undecided.push(m);
  }
  let modelFailed = false;
  if (undecided.length) {
    try {
      const sa = await parseServiceAccountKey(Deno.env.get("GCP_SERVICE_ACCOUNT_KEY"));
      const result = await generateVertexContent(
        sa,
        GEMINI_EXTRACT_MODEL,
        [{ role: "user", parts: [{ text: sweepPrompt(undecided) }] }],
        withThinking(GEMINI_EXTRACT_MODEL, { temperature: 0.1, maxOutputTokens: 4096 }, "low"),
        { tools: [SWEEP_TOOL], toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["sort_inbox"] } } },
      );
      const call = (result.candidates?.[0]?.content?.parts || []).find((p: any) => p.functionCall)?.functionCall;
      if (!call?.args) throw new Error("no structured answer");
      for (const v of verdictsFromModel(undecided, call.args)) verdicts.set(v.id, v);
    } catch (e) {
      console.error("inbox-sweep model failed", e);
      modelFailed = true; // leave these unsorted so the next run retries them
    }
  }

  const rows = msgs.filter((m) => verdicts.has(m.id)).map((m) => {
    const v = verdicts.get(m.id)!;
    return { user_id: userId, message_id: m.id, thread_id: m.threadId ?? null, from_addr: m.from.slice(0, 300), subject: m.subject.slice(0, 300), snippet: m.snippet ?? "", received_at: m.receivedAt ? new Date(m.receivedAt).toISOString() : null, bucket: v.bucket, reason: v.reason, decided_by: v.decidedBy };
  });
  if (rows.length) {
    const { error } = await db.from("inbox_sweep_items").upsert(rows, { onConflict: "user_id,message_id", ignoreDuplicates: true });
    if (error) throw error;
  }
  return { sorted: rows.length, remaining: fresh.length - batch.length, modelFailed };
}


export async function sweepList(db: any, userId: string) {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
  const { data } = await db.from("inbox_sweep_items").select("id, message_id, from_addr, subject, snippet, received_at, bucket, reason, decided_by, feedback")
    .eq("user_id", userId).gte("received_at", since).order("received_at", { ascending: false }).limit(300);
  const items = (data ?? []).map((r: any) => ({ ...r, address: addressOf(r.from_addr), link: `https://mail.google.com/mail/u/0/#all/${r.message_id}` }));
  return { items, accuracy: accuracy(items) };
}

export async function sweepFeedback(db: any, userId: string, id: string, value: unknown) {
  if (!id) return { error: "id required" };
  const v = value === "right" || value === "wrong" ? value : null;
  await db.from("inbox_sweep_items").update({ feedback: v }).eq("id", id).eq("user_id", userId);
  return { ok: true };
}
