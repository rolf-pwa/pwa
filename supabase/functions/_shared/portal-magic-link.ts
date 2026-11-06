// portal-magic-link.ts
// Helpers for minting time-limited, single-use portal sign-in links that
// piggyback on the existing portal_tokens table. Issued by notification
// edge functions; consumed by portal-validate (which already accepts
// portal_tokens by token string).

const APP_BASE_URL = "https://app.prosperwise.ca";
const MAGIC_LINK_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface MagicLinkResult {
  url: string;
  token: string;
  expiresAt: string;
}

/**
 * Mint a 1-hour, single-use portal sign-in link tied to a notification.
 * Returns null if minting fails — caller should fall back to a plain
 * portal URL so the user can still log in via OTP.
 */
export async function mintMagicLink(
  supabase: any,
  args: {
    contactId: string;
    targetHash?: string; // e.g. "tasks", "requests", "updates"
  },
): Promise<MagicLinkResult | null> {
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS).toISOString();
  const { data, error } = await supabase
    .from("portal_tokens")
    .insert({
      contact_id: args.contactId,
      created_by: args.contactId,
      expires_at: expiresAt,
      purpose: "magic_link",
      single_use: true,
      target_hash: args.targetHash || null,
    })
    .select("token")
    .single();

  if (error || !data?.token) {
    console.error("[mintMagicLink] insert failed:", error);
    return null;
  }

  const url = args.targetHash
    ? `${APP_BASE_URL}/portal/${data.token}#${args.targetHash}`
    : `${APP_BASE_URL}/portal/${data.token}`;

  return { url, token: data.token, expiresAt };
}

/**
 * A link for this contact and tab that is still good: the last one minted that has not been used or revoked and has at least `minLeftMs` to run, else a new
 * one. A notification that is retried (or sent again soon after) reuses its link instead of minting another every time.
 */
export async function findOrMintMagicLink(
  supabase: any,
  args: { contactId: string; targetHash?: string },
  minLeftMs = 30 * 60 * 1000,
): Promise<MagicLinkResult | null> {
  const soonest = new Date(Date.now() + minLeftMs).toISOString();
  let q = supabase.from("portal_tokens").select("token, expires_at").eq("contact_id", args.contactId).eq("purpose", "magic_link")
    .eq("revoked", false).is("used_at", null).gt("expires_at", soonest);
  q = args.targetHash ? q.eq("target_hash", args.targetHash) : q.is("target_hash", null);
  const { data: existing } = await q.order("expires_at", { ascending: false }).limit(1).maybeSingle();
  if (existing?.token) {
    const url = args.targetHash ? `${APP_BASE_URL}/portal/${existing.token}#${args.targetHash}` : `${APP_BASE_URL}/portal/${existing.token}`;
    return { url, token: existing.token, expiresAt: existing.expires_at };
  }
  return await mintMagicLink(supabase, args);
}

/** Plain login URL for when minting fails or no contact id is available. */
export function plainPortalUrl(): string {
  return `${APP_BASE_URL}/portal`;
}
