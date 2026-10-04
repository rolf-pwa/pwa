// Shared helper for the client Portal. Mirrors pro-portal-auth.ts's shape for
// `pro_portal_tokens`, but for `portal_tokens` -- the same portal_tokens lookup
// this repo has so far re-implemented inline in vault-service and (formerly) asana-service.

export interface PortalContact {
  contactId: string;
  householdId: string | null;
}

/**
 * Validate a raw client portal token and return the linked contact/household.
 * Returns null when invalid/expired/revoked.
 */
export async function validatePortalContact(
  supabaseAdmin: any,
  rawToken: string | null | undefined,
): Promise<PortalContact | null> {
  if (!rawToken) return null;

  const { data: row } = await supabaseAdmin
    .from("portal_tokens")
    .select("contact_id, expires_at, revoked")
    .eq("token", rawToken)
    .maybeSingle();

  if (!row || row.revoked) return null;
  if (row.expires_at && new Date(row.expires_at) <= new Date()) return null;

  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("id, household_id")
    .eq("id", row.contact_id)
    .maybeSingle();
  if (!contact) return null;

  return { contactId: contact.id, householdId: contact.household_id };
}
