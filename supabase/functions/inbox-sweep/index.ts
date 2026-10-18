// inbox-sweep: Georgia sorts the signed-in staff member's own recent inbox mail and proposes what to do with it. READ-ONLY: the Gmail
// scope the app holds cannot change a message, and nothing here tries to. Only sender, subject and a short snippet go to the model.
//   run       sort inbox mail from the last 7 days that has not been sorted yet
//   list      the sorted mail from the last 7 days, and how often the proposals were marked right
//   feedback  mark one proposal right or wrong

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getValidGoogleAccessToken } from "../_shared/google-token.ts";
import { GEMINI_EXTRACT_MODEL, generateVertexContent, parseServiceAccountKey, withThinking } from "../_shared/vertex-ai.ts";
import { accuracy, addressOf, ruleVerdict, SWEEP_TOOL, sweepPrompt, verdictsFromModel, type SweepMessage, type Verdict } from "../_shared/inbox-sweep.ts";

const ALLOWED_ORIGINS = [
  "https://prosperwise-portal.web.app",
  "https://prosperwise.lovable.app",
  "https://app.prosperwise.ca",
  "https://id-preview--339dfc8f-3e82-4b05-8a36-a9f66fc58449.lovable.app",
];
function cors(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".lovable.app") || origin.endsWith(".lovableproject.com") ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-region",
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const MAX_NEW = 60;
const WINDOW_DAYS = 7;

async function requireStaff(req: Request): Promise<{ userId: string; email: string } | null> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data } = await userClient.auth.getUser();
  if (!data?.user?.email?.endsWith("@prosperwise.ca")) return null;
  return { userId: data.user.id, email: data.user.email };
}

const header = (headers: any[], name: string) => headers?.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

async function run(userId: string) {
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
  const clients = new Set((contacts ?? []).map((c: any) => String(c.email).trim().toLowerCase()).filter(Boolean));
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

Deno.serve(async (req) => {
  const headers = { ...cors(req), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers });
  try {
    const staff = await requireStaff(req);
    if (!staff) return json({ error: "Not authorized" }, 401);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");

    if (action === "run") return json({ ok: true, ...(await run(staff.userId)) });

    if (action === "list") {
      const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
      const { data } = await db.from("inbox_sweep_items").select("id, message_id, from_addr, subject, snippet, received_at, bucket, reason, decided_by, feedback")
        .eq("user_id", staff.userId).gte("received_at", since).order("received_at", { ascending: false }).limit(300);
      const items = (data ?? []).map((r: any) => ({ ...r, from_addr: r.from_addr, address: addressOf(r.from_addr), link: `https://mail.google.com/mail/u/0/#all/${r.message_id}` }));
      return json({ items, accuracy: accuracy(items) });
    }

    if (action === "feedback") {
      const id = String(body?.id ?? "");
      const value = body?.value === "right" || body?.value === "wrong" ? body.value : null;
      if (!id) return json({ error: "id required" }, 400);
      await db.from("inbox_sweep_items").update({ feedback: value }).eq("id", id).eq("user_id", staff.userId);
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e: any) {
    console.error("inbox-sweep error", e);
    return json({ error: e?.message ?? "Failed" }, 500);
  }
});
