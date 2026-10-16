// dob.ts: date of birth rules shared by the onboarding screen and the intake-portal function. Pure (no I/O).

/** Roles that must give a date of birth during onboarding: the adults whose accounts and death benefit resets depend on it. */
export const DOB_REQUIRED_ROLES = ["head_of_family", "head_of_household", "spouse"];
export const dobRequiredFor = (role: string | null | undefined) => DOB_REQUIRED_ROLES.includes(String(role ?? ""));

/**
 * A date of birth as YYYY-MM-DD, null when blank, or "invalid" when it is not a real past date after 1900.
 */
export function cleanDob(value: unknown, today = new Date().toISOString().slice(0, 10)): string | null | "invalid" {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return "invalid";
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return "invalid";
  return v >= "1900-01-01" && v <= today ? v : "invalid";
}
