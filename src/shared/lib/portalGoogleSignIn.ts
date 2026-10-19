import { supabase } from "@/shared/integrations/supabase/client";

export type PortalSignIn = { ok: true; data: unknown } | { ok: false; reason: "no_account" | "retry" };

/** Whether a failed portal sign-in means there is no client account for the email, or only that it did not work this time. */
export async function failureKind(resp: { error?: unknown; data?: { error?: unknown } | null }): Promise<"no_account" | "retry"> {
  if (typeof resp.data?.error === "string" && /no account found/i.test(resp.data.error)) return "no_account";
  const ctx = (resp.error as { context?: { status?: number; json?: () => Promise<{ error?: string }> } } | undefined)?.context;
  if (ctx?.status === 404) return "no_account";
  try {
    const body = await ctx?.json?.();
    if (typeof body?.error === "string" && /no account found/i.test(body.error)) return "no_account";
  } catch { /* not JSON */ }
  return "retry";
}

type Invoke = (email: string) => Promise<{ error?: unknown; data?: { error?: unknown } | null }>;

const defaultInvoke: Invoke = (email) => supabase.functions.invoke("portal-otp", { body: { action: "google-auth", email } });

/**
 * Opens the portal for a client who has signed in with Google. Loading the portal takes a few seconds (longer on a phone), so this waits for it,
 * and tries once more after a failure that is not "no account"; only a real "no account" is reported as that.
 */
export async function signInToPortalWithGoogle(email: string, invoke: Invoke = defaultInvoke, attempts = 2): Promise<PortalSignIn> {
  for (let i = 0; i < attempts; i++) {
    let resp: Awaited<ReturnType<Invoke>>;
    try { resp = await invoke(email); } catch { resp = { error: new Error("network") }; }
    if (!resp.error && resp.data && !resp.data.error) return { ok: true, data: resp.data };
    if ((await failureKind(resp)) === "no_account") return { ok: false, reason: "no_account" };
  }
  return { ok: false, reason: "retry" };
}
