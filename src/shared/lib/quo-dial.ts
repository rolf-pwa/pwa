import { supabase } from "@/shared/integrations/supabase/client";

// Click-to-call helper. Which phone provider the CRM uses (Quo or Callizy) decides where the number is dialled.
//
// Quo (OpenPhone) click-to-call:
// OpenPhone has no REST endpoint to place outbound calls from a server,
// so we deep-link into the OpenPhone desktop app and fall back to the
// web app if the protocol handler doesn't catch the request.

export function normalizePhone(raw: string): string {
  const digits = (raw || "").replace(/[^\d+]/g, "");
  if (!digits) return "";
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export type DialProvider = "quo" | "callizy";
let provider: DialProvider | null = null;
/** Remember the provider the CRM sends through (the Inbox switch calls this when it changes). */
export function setDialProvider(p: DialProvider) { provider = p; }
async function loadProvider() {
  try {
    const { data } = await supabase.functions.invoke("quo-service", { body: { action: "getProvider" } });
    provider = data?.provider === "callizy" ? "callizy" : "quo";
  } catch { /* keep the default and try again at the next call */ }
}
// Looked up ahead of time so a click can open the right app straight away.
if (typeof window !== "undefined") void loadProvider();

export function dialViaQuo(rawPhone: string) {
  const e164 = normalizePhone(rawPhone);
  if (!e164) return;

  // Callizy: its web softphone dials from the link (the agent must be signed in to Callizy).
  if (provider === "callizy") {
    window.open(`https://app.callizy.ca/call?number=${encodeURIComponent(e164)}`, "_blank", "noopener,noreferrer");
    return;
  }
  if (provider === null) void loadProvider();

  const desktop = `openphone://dial?number=${encodeURIComponent(e164)}&action=call`;
  const web = `https://my.openphone.com/dial?number=${encodeURIComponent(e164)}&action=call`;

  // Try the desktop app first.
  window.location.href = desktop;

  // Fallback: open the web app in a new tab if the protocol handler did
  // nothing (no app installed). Short delay so the OS gets a chance to
  // launch the desktop client first.
  window.setTimeout(() => {
    window.open(web, "_blank", "noopener,noreferrer");
  }, 600);
}

/** The same helper under a name that does not say Quo. */
export const dialPhone = dialViaQuo;
