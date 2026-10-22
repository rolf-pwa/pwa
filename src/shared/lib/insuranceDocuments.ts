// The checklist items each signed document covers. Mirrors DOC_ITEMS in supabase/functions/_shared/insurance-doc-service.ts (a test keeps them in step).
export const DOC_ITEMS: Record<string, string[]> = { disclosure_privacy: ["advisor_disclosure", "privacy_consent"], reason_why: ["recommendation"] };
