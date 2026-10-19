// inbox-sweep-handlers.ts: Georgia sorts the signed-in staff member's own recent inbox mail and proposes what to do with it. Sorting only reads.
// The one thing that changes Gmail is sweepArchive, which runs only when Rolf says so and only removes the Inbox label (undoable). Only sender,
// subject and a short snippet go to the model.
// Served by daily-briefing-generate (ea_sweep_run / ea_sweep_list / ea_sweep_feedback): the project is at its function cap.

// deno-lint-ignore-file no-explicit-any
import { getValidGoogleAccessToken } from "./google-token.ts";
import { GEMINI_EXTRACT_MODEL, generateVertexContent, parseServiceAccountKey, withThinking } from "./vertex-ai.ts";
import { accuracy, addressOf, archiveTargets, BUCKET_LABEL, correctionPlan, ruleVerdict, SWEEP_TOOL, sweepPrompt, verdictsFromModel, type Learned, type SweepMessage, type Verdict } from "./inbox-sweep.ts";

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

  const [{ data: contacts }, { data: prefs }, { data: told }] = await Promise.all([
    db.from("contacts").select("email").not("email", "is", null).limit(10000),
    db.from("ea_preferences").select("value").eq("staff_user_id", userId).eq("kind", "mute_sender").eq("active", true),
    db.from("inbox_sweep_senders").select("sender, bucket").eq("user_id", userId),
  ]);
  const learned: Learned = new Map((told ?? []).map((t: any) => [String(t.sender), t.bucket]));
  const clients = new Set<string>((contacts ?? []).map((c: any) => String(c.email).trim().toLowerCase()).filter(Boolean));
  const muted = (prefs ?? []).map((p: any) => String(p.value));

  const verdicts = new Map<string, Verdict>();
  const undecided: SweepMessage[] = [];
  for (const m of msgs) {
    const v = ruleVerdict(m, clients, muted, learned);
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
    return { user_id: userId, message_id: m.id, thread_id: m.threadId ?? null, from_addr: m.from.slice(0, 300), subject: m.subject.slice(0, 300), snippet: m.snippet ?? "", received_at: m.receivedAt ? new Date(m.receivedAt).toISOString() : null, bucket: v.bucket, proposed_bucket: v.bucket, reason: v.reason, decided_by: v.decidedBy };
  });
  if (rows.length) {
    const { error } = await db.from("inbox_sweep_items").upsert(rows, { onConflict: "user_id,message_id", ignoreDuplicates: true });
    if (error) throw error;
  }
  return { sorted: rows.length, remaining: fresh.length - batch.length, modelFailed };
}


export async function sweepList(db: any, userId: string) {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
  const [{ data }, { data: senders }, { data: cfg }, allowed] = await Promise.all([
    db.from("inbox_sweep_items").select("id, message_id, from_addr, subject, snippet, received_at, bucket, proposed_bucket, correct_bucket, reason, decided_by, feedback, archived_at, archive_batch")
      .eq("user_id", userId).gte("received_at", since).order("received_at", { ascending: false }).limit(300),
    db.from("inbox_sweep_senders").select("sender, bucket").eq("user_id", userId).order("updated_at", { ascending: false }),
    db.from("inbox_sweep_config").select("auto").eq("id", true).maybeSingle(),
    canArchive(db, userId),
  ]);
  const items = (data ?? []).map((r: any) => ({ ...r, address: addressOf(r.from_addr), link: `https://mail.google.com/mail/u/0/#all/${r.message_id}` }));
  const batches = items.filter((i: any) => i.archive_batch && i.archived_at).sort((a: any, b: any) => String(b.archived_at).localeCompare(String(a.archived_at)));
  const lastBatch = batches.length ? batches.filter((i: any) => i.archive_batch === batches[0].archive_batch).length : 0;
  return { items, accuracy: accuracy(items), senders: senders ?? [], auto: cfg?.auto !== false, canArchive: allowed, lastBatch };
}

/**
 * Right: the sort stands. Wrong with the bucket it belonged in: the message moves there now, the sender is remembered so its mail is sorted that
 * way from then on, and the same sender's other unrated mail in the window moves too. Clearing the mark leaves what was learned (it can be forgotten).
 */
export async function sweepFeedback(db: any, userId: string, id: string, value: unknown, correctBucket?: unknown) {
  if (!id) return { error: "id required" };
  const { data: item } = await db.from("inbox_sweep_items").select("id, from_addr, bucket, proposed_bucket").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!item) return { error: "Not found" };
  if (value === "wrong" && correctBucket !== undefined && correctBucket !== null) {
    const plan = correctionPlan(item, correctBucket);
    if (!plan) return { error: "Choose a different place for it: Needs you, FYI or Would archive." };
    await db.from("inbox_sweep_items").update({ feedback: "wrong", correct_bucket: plan.correct, bucket: plan.correct, proposed_bucket: item.proposed_bucket ?? item.bucket }).eq("id", id).eq("user_id", userId);
    let moved = 0;
    if (plan.sender) {
      await db.from("inbox_sweep_senders").upsert({ user_id: userId, sender: plan.sender, bucket: plan.correct, source: "corrected", updated_at: new Date().toISOString() }, { onConflict: "user_id,sender" });
      const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
      const { data: others } = await db.from("inbox_sweep_items").select("id, from_addr, bucket").eq("user_id", userId).is("feedback", null).neq("id", id).neq("bucket", "client").gte("received_at", since).limit(300);
      const same = (others ?? []).filter((o: any) => addressOf(o.from_addr) === plan.sender && o.bucket !== plan.correct).map((o: any) => o.id);
      if (same.length) {
        await db.from("inbox_sweep_items").update({ bucket: plan.correct, decided_by: "learned", reason: `You told Georgia mail from this sender belongs in ${BUCKET_LABEL[plan.correct as keyof typeof BUCKET_LABEL]}` }).in("id", same);
        moved = same.length;
      }
    }
    return { ok: true, moved, remembered: plan.sender || null };
  }
  const v = value === "right" || value === "wrong" ? value : null;
  // Clearing a "wrong" mark puts the message back where Georgia first put it.
  const back = v === null && item.proposed_bucket ? { bucket: item.proposed_bucket, correct_bucket: null } : {};
  await db.from("inbox_sweep_items").update({ feedback: v, ...(v === "right" ? { correct_bucket: null } : {}), ...back }).eq("id", id).eq("user_id", userId);
  return { ok: true };
}

/** Stop applying what was learned about one sender. */
export async function sweepForgetSender(db: any, userId: string, sender: string) {
  if (!sender) return { error: "sender required" };
  await db.from("inbox_sweep_senders").delete().eq("user_id", userId).eq("sender", sender.toLowerCase());
  return { ok: true };
}

/** The morning sweep for everyone on staff with Google connected: a few passes each, so a backlog clears. Read-only, like every sweep. */
export async function sweepMorning(db: any): Promise<string[]> {
  const { data: cfg } = await db.from("inbox_sweep_config").select("auto").eq("id", true).maybeSingle();
  if (cfg && cfg.auto === false) return ["off"];
  const { data: staff } = await db.from("profiles").select("user_id, email").ilike("email", "%@prosperwise.ca");
  const out: string[] = [];
  for (const s of (staff ?? []) as any[]) {
    try {
      let sorted = 0;
      for (let pass = 0; pass < 4; pass++) {
        const r = await sweepRun(db, s.user_id);
        sorted += r.sorted;
        if (!r.remaining) break;
      }
      out.push(`${s.email}: sorted ${sorted}`);
    } catch (e) {
      out.push(`${s.email}: ${e instanceof Error ? e.message : "failed"}`); // for example, Google not connected
    }
  }
  return out;
}

export async function sweepSetAuto(db: any, on: boolean) {
  await db.from("inbox_sweep_config").upsert({ id: true, auto: on }, { onConflict: "id" });
  return { ok: true, auto: on };
}


const MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const NEEDS_PERMISSION = "Georgia needs your permission to archive mail. On the Ask Georgia page, press Allow archiving and approve it once with Google.";

/** Whether the connected Google account has agreed to let Georgia change mail (archive and undo). */
export async function canArchive(db: any, userId: string): Promise<boolean> {
  const { data } = await db.from("google_tokens").select("scopes").eq("user_id", userId).maybeSingle();
  return ((data?.scopes ?? []) as string[]).includes(MODIFY_SCOPE);
}

const gmailPost = (token: string, path: string, body: unknown) =>
  fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });

/**
 * Archives swept Would-archive mail at Rolf's say-so: scope "rated" is only what he marked right, "all" is every Would-archive sort he has not marked wrong.
 * Starred mail and mail already out of the Inbox are left alone. Removing the Inbox label is all that happens: nothing is deleted, and it can be undone.
 */
export async function sweepArchive(db: any, userId: string, scope: "rated" | "all") {
  if (!(await canArchive(db, userId))) return { error: "needs_permission", message: NEEDS_PERMISSION };
  const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
  const { data } = await db.from("inbox_sweep_items").select("id, message_id, bucket, feedback, archived_at, undone_at").eq("user_id", userId).eq("bucket", "archivable").gte("received_at", since).limit(300);
  const targets = archiveTargets((data ?? []) as any[], scope).slice(0, 200);
  if (!targets.length) return { ok: true, archived: 0, skippedStarred: 0, alreadyGone: 0 };

  const token = await getValidGoogleAccessToken(db, userId);
  const labels = await Promise.all(targets.map(async (t: any) => {
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${t.message_id}?format=minimal`, { headers: { Authorization: `Bearer ${token}` } });
    return r.ok ? ((await r.json()).labelIds ?? []) as string[] : null; // null: gone or unreadable, leave it
  }));
  const move: any[] = [], gone: any[] = [];
  let skippedStarred = 0;
  targets.forEach((t: any, i: number) => {
    const l = labels[i];
    if (!l) return;
    if (!l.includes("INBOX")) gone.push(t);
    else if (l.includes("STARRED")) skippedStarred++;
    else move.push(t);
  });
  const now = new Date().toISOString();
  if (move.length) {
    const r = await gmailPost(token, "messages/batchModify", { ids: move.map((m) => m.message_id), removeLabelIds: ["INBOX"] });
    if (!r.ok) {
      if (r.status === 403) return { error: "needs_permission", message: NEEDS_PERMISSION };
      throw new Error(`Gmail archive error: ${r.status}`);
    }
    await db.from("inbox_sweep_items").update({ archived_at: now, archive_batch: crypto.randomUUID() }).in("id", move.map((m) => m.id));
  }
  if (gone.length) await db.from("inbox_sweep_items").update({ archived_at: now }).in("id", gone.map((g) => g.id));
  return { ok: true, archived: move.length, skippedStarred, alreadyGone: gone.length };
}

/** Puts the most recent archive batch back in the Inbox. Those messages are never archived in bulk again. */
export async function sweepUndoArchive(db: any, userId: string) {
  if (!(await canArchive(db, userId))) return { error: "needs_permission", message: NEEDS_PERMISSION };
  const { data: last } = await db.from("inbox_sweep_items").select("archive_batch").eq("user_id", userId).not("archive_batch", "is", null).not("archived_at", "is", null).order("archived_at", { ascending: false }).limit(1).maybeSingle();
  if (!last?.archive_batch) return { ok: true, restored: 0 };
  const { data: rows } = await db.from("inbox_sweep_items").select("id, message_id").eq("user_id", userId).eq("archive_batch", last.archive_batch);
  const items = (rows ?? []) as any[];
  if (!items.length) return { ok: true, restored: 0 };
  const token = await getValidGoogleAccessToken(db, userId);
  const r = await gmailPost(token, "messages/batchModify", { ids: items.map((i) => i.message_id), addLabelIds: ["INBOX"] });
  if (!r.ok) throw new Error(`Gmail undo error: ${r.status}`);
  await db.from("inbox_sweep_items").update({ archived_at: null, archive_batch: null, undone_at: new Date().toISOString() }).eq("user_id", userId).eq("archive_batch", last.archive_batch);
  return { ok: true, restored: items.length };
}
