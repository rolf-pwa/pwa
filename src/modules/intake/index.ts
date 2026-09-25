/**
 * Public API of the `intake` module.
 *
 * Other modules may only import from `@/modules/intake` — never from files
 * inside it. Deep cross-module imports are blocked by ESLint.
 */
export { PortalIntakeBanner } from "./components/PortalIntakeBanner";
export { PortalIntakePage } from "./components/PortalIntakePage";
export { IntakeBackfillTile } from "./components/IntakeBackfillTile";
export { OnboardingShell } from "./components/onboarding/OnboardingShell";
export { OnboardingStepper, type OnboardingStepMeta } from "./components/onboarding/OnboardingStepper";
export { GeorgiaDiagnosticCard } from "./components/GeorgiaDiagnosticCard";
