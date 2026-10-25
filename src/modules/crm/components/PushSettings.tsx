import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/shared/components/ui/switch";
import { PUSH_CATEGORIES, currentSubscription, disablePush, enablePush, loadPushPrefs, pushSupported, savePushPrefs, sendPushTest } from "@/shared/lib/push";

const installed = () => { try { return window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true; } catch { return false; } };

/** Notifications on this phone: turn them on, choose what buzzes, and send a test. */
export function PushSettings() {
  const [sub, setSub] = useState<PushSubscription | null>(null);
  const [cats, setCats] = useState<string[]>(PUSH_CATEGORIES.map((c) => c.id));
  const [quiet, setQuiet] = useState(true);
  const [busy, setBusy] = useState(false);
  const supported = pushSupported();

  const refresh = useCallback(async () => {
    const s = await currentSubscription();
    setSub(s);
    if (s) { const p = await loadPushPrefs(s.endpoint); if (p) { setCats(p.categories); setQuiet(p.quiet); } }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e) { toast.error(e instanceof Error ? e.message : "Something went wrong"); } finally { setBusy(false); } };
  const turnOn = () => run(async () => { const s = await enablePush(); setSub(s); await refresh(); toast.success("Notifications are on"); });
  const turnOff = () => run(async () => { if (sub) await disablePush(sub); setSub(null); });
  const toggle = (id: string, on: boolean) => { const next = on ? [...cats, id] : cats.filter((c) => c !== id); setCats(next); if (sub) void savePushPrefs(sub.endpoint, { categories: next }); };
  const setQuietHours = (on: boolean) => { setQuiet(on); if (sub) void savePushPrefs(sub.endpoint, { quiet: on }); };
  const test = () => run(async () => { const r = await sendPushTest(sub!.endpoint); toast[r.sent ? "success" : "error"](r.sent ? "Sent. It should arrive in a moment." : "Could not send. Turn notifications off and on again."); });

  return (
    <section aria-label="Notifications" data-testid="push-settings">
      <h2 className="mb-1.5 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Notifications</h2>
      <div className="overflow-hidden rounded-xl border bg-card text-sm">
        {!supported ? (
          <p className="p-4 text-xs text-muted-foreground">{installed() ? "This phone does not support notifications." : "Notifications work once ProsperWise is on your home screen: add it as described above, then open it from there."}</p>
        ) : !sub ? (
          <div className="flex items-center gap-3 p-4">
            <Bell className="h-5 w-5 shrink-0 text-accent" />
            <div className="flex-1"><p className="font-medium">Buzz me for what matters</p><p className="text-xs text-muted-foreground">Texts, voicemails and client requests, with who it is from. Never the message itself.</p></div>
            <button type="button" disabled={busy} onClick={turnOn} className="min-h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">Turn on</button>
          </div>
        ) : (
          <ul className="divide-y">
            {PUSH_CATEGORIES.map((c) => (
              <li key={c.id} className="flex min-h-14 items-center gap-3 px-4 py-2"><div className="flex-1"><p className="font-medium">{c.label}</p><p className="text-xs text-muted-foreground">{c.hint}</p></div><Switch aria-label={c.label} checked={cats.includes(c.id)} onCheckedChange={(on) => toggle(c.id, on)} /></li>
            ))}
            <li className="flex min-h-14 items-center gap-3 px-4 py-2"><div className="flex-1"><p className="font-medium">Quiet hours</p><p className="text-xs text-muted-foreground">9pm to 7am Pacific: only urgent texts and system alerts</p></div><Switch aria-label="Quiet hours" checked={quiet} onCheckedChange={setQuietHours} /></li>
            <li className="flex items-center justify-between px-4 py-2"><button type="button" disabled={busy} onClick={test} className="min-h-10 text-sm font-medium text-primary disabled:opacity-50">Send a test</button><button type="button" disabled={busy} onClick={turnOff} className="min-h-10 text-sm font-medium text-destructive disabled:opacity-50">Turn off</button></li>
          </ul>
        )}
      </div>
    </section>
  );
}
