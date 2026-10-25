// Sends the push notifications: who is subscribed, what each device wants, and clearing out devices that are gone.
import * as webpush from "jsr:@negrel/webpush@0.5.0";
import { BADGE_SOURCES, categoryForSource, shouldBuzz, staffPayload, textPayload, type PushPayload } from "./push-rules.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

// VAPID_KEYS is the exported key pair (JSON), VAPID_SUBJECT an optional contact address for the push services.
let server: Promise<{ app: webpush.ApplicationServer; publicKey: string } | null> | null = null;
function appServer() {
  server ??= (async () => {
    const raw = Deno.env.get("VAPID_KEYS");
    if (!raw) return null;
    const keys = await webpush.importVapidKeys(JSON.parse(raw), { extractable: false });
    return { app: await webpush.ApplicationServer.new({ contactInformation: Deno.env.get("VAPID_SUBJECT") || "mailto:admin@prosperwise.ca", vapidKeys: keys }), publicKey: await webpush.exportApplicationServerKey(keys) };
  })().catch((e) => { console.error("[push] keys", e); return null; });
  return server;
}

export const vapidPublicKey = async () => (await appServer())?.publicKey ?? "";

interface Sub { id: string; endpoint: string; p256dh: string; auth: string; categories: string[]; quiet: boolean }

/** Sends one payload to each device; a device the push service reports gone (404/410) is removed. Returns how many were sent. */
async function deliver(db: Db, subs: Sub[], payload: PushPayload): Promise<number> {
  const srv = await appServer();
  if (!srv) return 0;
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      const subscriber = srv.app.subscribe({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } });
      await subscriber.pushTextMessage(JSON.stringify(payload), { ttl: 3600, urgency: webpush.Urgency.High });
      sent++;
      await db.from("push_subscriptions").update({ last_sent_at: new Date().toISOString(), last_error: null }).eq("id", s.id);
    } catch (e) {
      if (e instanceof webpush.PushMessageError && e.isGone()) await db.from("push_subscriptions").delete().eq("id", s.id);
      else await db.from("push_subscriptions").update({ last_error: (e instanceof Error ? e.message : String(e)).slice(0, 300) }).eq("id", s.id);
    }
  }));
  return sent;
}

/** The red number on the icon: unread texts and calls, plus unread bell items that need Rolf. */
export async function badgeCount(db: Db): Promise<number> {
  const [m, c, n] = await Promise.all([
    db.from("quo_messages").select("id", { count: "exact", head: true }).eq("direction", "inbound").is("read_at", null),
    db.from("quo_calls").select("id", { count: "exact", head: true }).eq("direction", "inbound").is("read_at", null),
    db.from("staff_notifications").select("id", { count: "exact", head: true }).eq("read", false).in("source_type", [...BADGE_SOURCES]),
  ]);
  return (m.count ?? 0) + (c.count ?? 0) + (n.count ?? 0);
}

/** A notification or an inbound text just landed: buzz the devices that want this kind, respecting quiet hours. */
export async function pushNotify(db: Db, kind: "staff" | "text", id: string, now = new Date()): Promise<{ sent: number; reason?: string }> {
  let payload: PushPayload, category, source: string;
  if (kind === "staff") {
    const { data: n } = await db.from("staff_notifications").select("id, title, link, contact_id, source_type").eq("id", id).maybeSingle();
    if (!n) return { sent: 0, reason: "no such notification" };
    category = categoryForSource(n.source_type);
    if (!category) return { sent: 0, reason: "not a buzzing kind" };
    source = n.source_type; payload = staffPayload(n, await badgeCount(db));
  } else {
    const { data: m } = await db.from("quo_messages").select("id, contact_id, direction").eq("id", id).maybeSingle();
    if (!m || m.direction !== "inbound") return { sent: 0, reason: "not an inbound text" };
    let name: string | null = null;
    if (m.contact_id) { const { data: c } = await db.from("contacts").select("first_name, last_name").eq("id", m.contact_id).maybeSingle(); name = c ? `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || null : null; }
    category = "texts" as const; source = "text"; payload = textPayload(m, name, await badgeCount(db));
  }
  const { data: subs } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth, categories, quiet");
  const wanted = ((subs ?? []) as Sub[]).filter((s) => shouldBuzz(category!, source, s, now));
  return { sent: await deliver(db, wanted, payload) };
}

/** A test from the phone itself, to the device that asked. */
export async function pushTest(db: Db, userId: string, endpoint: string): Promise<{ sent: number }> {
  const { data: subs } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth, categories, quiet").eq("user_id", userId).eq("endpoint", endpoint);
  return { sent: await deliver(db, (subs ?? []) as Sub[], { title: "Notifications are on", body: "This is how ProsperWise will reach you.", url: "/more", tag: "push-test", badge: await badgeCount(db) }) };
}

export async function pushSubscribe(db: Db, userId: string, sub: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }, userAgent: string): Promise<{ ok: boolean; error?: string }> {
  if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return { ok: false, error: "Incomplete subscription" };
  if (!/^https:\/\//.test(sub.endpoint)) return { ok: false, error: "Bad endpoint" };
  const { error } = await db.from("push_subscriptions").upsert({ user_id: userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, user_agent: userAgent.slice(0, 200) }, { onConflict: "endpoint", ignoreDuplicates: false });
  return error ? { ok: false, error: "Could not save" } : { ok: true };
}
