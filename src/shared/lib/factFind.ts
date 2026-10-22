// The sections of the fact find, in order. Mirrors SECTIONS in supabase/functions/_shared/fact-find-rules.ts (a test keeps them in step).
export const SECTIONS = [
  { key: "personal", label: "About you" }, { key: "family", label: "Your family" }, { key: "employment", label: "Work and income" }, { key: "finances", label: "Your finances" },
  { key: "health", label: "Health and lifestyle" }, { key: "insurance", label: "Insurance" }, { key: "estate", label: "Estate planning" }, { key: "goals", label: "Goals and what matters to you" },
] as const;
