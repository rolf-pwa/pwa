// Pure rule for which Charter wins and whether it counts as ratified (no I/O, so it can be unit-tested).

export type CharterSource = "vault" | "household" | "contact" | null;

/** Pure: which Charter wins and whether it counts as ratified. */
export function decideCharter(i: {
  vaultCharter: { ratified: boolean } | null;
  hasHouseholdCharter: boolean;
  householdComplete: boolean;
  hasContactCharterRow: boolean;
  hasCharterUrl: boolean;
  contactCharterRatified: boolean;
}): { source: CharterSource; ratified: boolean } {
  if (i.vaultCharter) return { source: "vault", ratified: i.vaultCharter.ratified };
  if (i.hasHouseholdCharter) return { source: "household", ratified: i.householdComplete };
  if (i.hasContactCharterRow || i.hasCharterUrl) return { source: "contact", ratified: i.hasCharterUrl || i.contactCharterRatified };
  return { source: null, ratified: false };
}

