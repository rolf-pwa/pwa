import { lazy, Suspense } from "react";
import { Toaster } from "@/shared/components/ui/toaster";
import { Toaster as Sonner } from "@/shared/components/ui/sonner";
import { TooltipProvider } from "@/shared/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/shared/hooks/useAuth";
import { ProtectedRoute } from "@/shared/components/ProtectedRoute";
import { Loader2 } from "lucide-react";

// Eager: tiny entry/exit routes needed on first paint.
import AuthCallback from "@/pages/AuthCallback";
import Login from "@/pages/Login";
import AccessDenied from "@/pages/AccessDenied";
import NotFound from "@/pages/NotFound";

// Lazy: everything else is fetched on demand.
const Dashboard = lazy(() => import("@/modules/crm/pages/Dashboard"));
const Contacts = lazy(() => import("@/modules/crm/pages/Contacts"));
const ContactDetail = lazy(() => import("@/modules/crm/pages/ContactDetail"));
const ContactForm = lazy(() => import("@/modules/crm/pages/ContactForm"));
const GoogleCallback = lazy(() => import("@/pages/GoogleCallback"));
const Portal = lazy(() => import("@/modules/portal/pages/Portal"));
const VfoPortal = lazy(() => import("@/modules/portal/pages/VfoPortal"));
const PrivacyPolicy = lazy(() => import("@/modules/portal/pages/PrivacyPolicy"));
const AdminVfo = lazy(() => import("@/modules/crm/pages/AdminVfo"));
const Families = lazy(() => import("@/modules/crm/pages/Families"));
const FamilyDetail = lazy(() => import("@/modules/crm/pages/FamilyDetail"));
const DiscoveryV2 = lazy(() => import("@/modules/intake/pages/DiscoveryV2"));
const DiscoveryV2Embed = lazy(() => import("@/modules/intake/pages/DiscoveryV2Embed"));
const VfoOnboardingEmbed = lazy(() => import("@/modules/intake/pages/VfoOnboardingEmbed"));
const ProPortalLogin = lazy(() => import("@/modules/pro/pages/ProPortalLogin"));
const ProPortal = lazy(() => import("@/modules/pro/pages/ProPortal"));
const ProPortalFamily = lazy(() => import("@/modules/pro/pages/ProPortalFamily"));
const ProPortalHousehold = lazy(() => import("@/modules/pro/pages/ProPortalHousehold"));
const ProPortalContact = lazy(() => import("@/modules/pro/pages/ProPortalContact"));
const Leads = lazy(() => import("@/modules/crm/pages/Leads"));
const ReviewQueue = lazy(() => import("@/modules/audit/pages/ReviewQueue"));
const Requests = lazy(() => import("@/modules/crm/pages/Requests"));
const Households = lazy(() => import("@/modules/crm/pages/Households"));
const HouseholdDetail = lazy(() => import("@/modules/crm/pages/HouseholdDetail"));
const Corporations = lazy(() => import("@/modules/crm/pages/Corporations"));
const CorporationDetail = lazy(() => import("@/modules/crm/pages/CorporationDetail"));
const MarketingUpdates = lazy(() => import("@/modules/crm/pages/MarketingUpdates"));
const Workbench = lazy(() => import("@/modules/audit/pages/Workbench"));
const Pipeline = lazy(() => import("@/modules/crm/pages/Pipeline"));
const Vault = lazy(() => import("@/modules/crm/pages/Vault"));
const VaultGuest = lazy(() => import("@/modules/portal/pages/VaultGuest"));
const KnowledgeBase = lazy(() => import("@/modules/crm/pages/KnowledgeBase"));
const HoldingTankPage = lazy(() => import("@/modules/crm/pages/HoldingTankPage"));
const Onboarding = lazy(() => import("@/modules/intake/pages/Onboarding"));
const BulkOnboarding = lazy(() => import("@/modules/intake/pages/BulkOnboarding"));
const BulkImporters = lazy(() => import("@/modules/intake/pages/BulkImporters"));
const WebForms = lazy(() => import("@/modules/crm/pages/WebForms"));
const BillingServices = lazy(() => import("@/modules/billing/pages/Services"));
const BillingInvoices = lazy(() => import("@/modules/billing/pages/Invoices"));
const BookService = lazy(() => import("@/modules/billing/pages/BookService"));
const BookingConfirmation = lazy(() => import("@/modules/billing/pages/BookingConfirmation"));
const QuickPay = lazy(() => import("@/modules/billing/pages/QuickPay"));
const TermsOfEngagementDoc = lazy(() => import("@/modules/billing/pages/TermsOfEngagementDoc"));
const Projects = lazy(() => import("@/modules/pm/pages/Projects"));
const ImportAsanaProject = lazy(() => import("@/modules/pm/pages/ImportAsanaProject"));
const ProjectDetail = lazy(() => import("@/modules/pm/pages/ProjectDetail"));
const TeamCapacity = lazy(() => import("@/modules/pm/pages/TeamCapacity"));

const Brain = lazy(() => import("@/modules/brain/pages/Brain"));
const BrainDocument = lazy(() => import("@/modules/brain/pages/BrainDocument"));

const Analytics = lazy(() => import("@/modules/crm/pages/Analytics"));
const StabilizationMap = lazy(() => import("@/modules/audit/pages/StabilizationMap"));
const StabilizationMapResolver = lazy(() => import("@/modules/audit/pages/StabilizationMapResolver"));
const GovernanceAudit = lazy(() => import("@/modules/audit/pages/GovernanceAudit"));
const GovernanceAuditResolver = lazy(() => import("@/modules/audit/pages/GovernanceAuditResolver"));
const QuarterlySystemReview = lazy(() => import("@/modules/audit/pages/QuarterlySystemReview"));
const QuarterlySystemReviewResolver = lazy(() => import("@/modules/audit/pages/QuarterlySystemReviewResolver"));
const QuarterlyReview = lazy(() => import("@/modules/audit/pages/QuarterlyReview"));
const GovernanceReview = lazy(() => import("@/modules/audit/pages/GovernanceReview"));
const QuarterlyVfoAudit = lazy(() => import("@/modules/audit/pages/QuarterlyVfoAudit"));
const SovereigntyCharter = lazy(() => import("@/modules/audit/pages/SovereigntyCharter"));
const CharterIntake = lazy(() => import("@/modules/audit/pages/CharterIntake"));
const HouseholdOntology = lazy(() => import("@/modules/audit/pages/HouseholdOntology"));
const DeltaReconciliationWorkbench = lazy(() => import("@/modules/audit/pages/DeltaReconciliationWorkbench"));
const Inbox = lazy(() => import("@/modules/crm/pages/Inbox"));
const Professionals = lazy(() => import("@/modules/crm/pages/Professionals"));
const ProfessionalDetail = lazy(() => import("@/modules/crm/pages/ProfessionalDetail"));

const queryClient = new QueryClient();

const RouteFallback = () => (
  <div className="flex min-h-screen items-center justify-center bg-background">
    <Loader2 className="h-5 w-5 animate-spin text-accent" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<AuthCallback />} />
              <Route path="/login" element={<Login />} />
              <Route path="/access-denied" element={<AccessDenied />} />
              <Route path="/discovery-v2" element={<DiscoveryV2 />} />
              <Route path="/discovery-v2/embed" element={<DiscoveryV2Embed />} />
              <Route path="/discovery-v2-embed" element={<DiscoveryV2Embed />} />
              <Route path="/vfo-onboarding" element={<VfoOnboardingEmbed />} />
              <Route path="/vfo-onboarding/embed" element={<VfoOnboardingEmbed />} />
              <Route path="/portal" element={<Portal />} />
              <Route path="/portal/intake" element={<Portal intakeRoute />} />
              <Route path="/portal/privacy" element={<PrivacyPolicy />} />
              <Route path="/portal/:token" element={<Portal />} />
              <Route path="/portal/:token/intake" element={<Portal intakeRoute />} />
              <Route path="/vfo/:token" element={<VfoPortal />} />
              <Route path="/pro-portal/login" element={<ProPortalLogin />} />
              <Route path="/pro-portal" element={<ProPortal />} />
              <Route path="/pro-portal/family/:id" element={<ProPortalFamily />} />
              <Route path="/pro-portal/household/:id" element={<ProPortalHousehold />} />
              <Route path="/pro-portal/contact/:id" element={<ProPortalContact />} />
              <Route path="/admin/vfo" element={<ProtectedRoute><AdminVfo /></ProtectedRoute>} />
              <Route path="/google-callback" element={<ProtectedRoute><GoogleCallback /></ProtectedRoute>} />
              <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/inbox" element={<ProtectedRoute><Inbox /></ProtectedRoute>} />
              <Route path="/holding-tank" element={<ProtectedRoute><HoldingTankPage /></ProtectedRoute>} />
              <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
              <Route path="/onboarding/bulk" element={<ProtectedRoute><BulkOnboarding /></ProtectedRoute>} />
              <Route path="/importers" element={<ProtectedRoute><BulkImporters /></ProtectedRoute>} />
              <Route path="/webforms" element={<ProtectedRoute><WebForms /></ProtectedRoute>} />

              <Route path="/families" element={<ProtectedRoute><Families /></ProtectedRoute>} />
              <Route path="/families/:id" element={<ProtectedRoute><FamilyDetail /></ProtectedRoute>} />
              <Route path="/households" element={<ProtectedRoute><Households /></ProtectedRoute>} />
              <Route path="/households/:id" element={<ProtectedRoute><HouseholdDetail /></ProtectedRoute>} />
              <Route path="/corporations" element={<ProtectedRoute><Corporations /></ProtectedRoute>} />
              <Route path="/corporations/:id" element={<ProtectedRoute><CorporationDetail /></ProtectedRoute>} />
              <Route path="/leads" element={<ProtectedRoute><Leads /></ProtectedRoute>} />
              <Route path="/requests" element={<ProtectedRoute><Requests /></ProtectedRoute>} />
              <Route path="/review-queue" element={<ProtectedRoute><ReviewQueue /></ProtectedRoute>} />
              <Route path="/marketing-updates" element={<ProtectedRoute><MarketingUpdates /></ProtectedRoute>} />
              <Route path="/workbench" element={<ProtectedRoute><Workbench /></ProtectedRoute>} />
              <Route path="/pipeline" element={<ProtectedRoute><Pipeline /></ProtectedRoute>} />
              <Route path="/services" element={<ProtectedRoute><BillingServices /></ProtectedRoute>} />
              <Route path="/invoices" element={<ProtectedRoute><BillingInvoices /></ProtectedRoute>} />
              <Route path="/projects" element={<ProtectedRoute><Projects /></ProtectedRoute>} />
              <Route path="/projects/import" element={<ProtectedRoute><ImportAsanaProject /></ProtectedRoute>} />
              <Route path="/projects/:id" element={<ProtectedRoute><ProjectDetail /></ProtectedRoute>} />
              <Route path="/team-capacity" element={<ProtectedRoute><TeamCapacity /></ProtectedRoute>} />
              <Route path="/book" element={<BookService />} />
              <Route path="/book/embed" element={<BookService embed />} />
              <Route path="/book/confirm" element={<BookingConfirmation />} />
              <Route path="/book/:slug" element={<BookService />} />
              <Route path="/book/:slug/embed" element={<BookService embed />} />
              <Route path="/pay" element={<QuickPay />} />
              <Route path="/pay/:slug" element={<QuickPay />} />
              <Route path="/terms-of-engagement" element={<TermsOfEngagementDoc />} />


              <Route path="/contacts" element={<ProtectedRoute><Contacts /></ProtectedRoute>} />
              <Route path="/professionals" element={<ProtectedRoute><Professionals /></ProtectedRoute>} />
              <Route path="/professionals/:id" element={<ProtectedRoute><ProfessionalDetail /></ProtectedRoute>} />
              <Route path="/contacts/new" element={<ProtectedRoute><ContactForm /></ProtectedRoute>} />
              <Route path="/contacts/:id" element={<ProtectedRoute><ContactDetail /></ProtectedRoute>} />
              <Route path="/contacts/:id/edit" element={<ProtectedRoute><ContactForm /></ProtectedRoute>} />

              <Route path="/vault" element={<ProtectedRoute><Vault /></ProtectedRoute>} />
              <Route path="/vault/household/:householdId" element={<ProtectedRoute><Vault /></ProtectedRoute>} />
              <Route path="/vault/:contactId" element={<ProtectedRoute><Vault /></ProtectedRoute>} />
              <Route path="/vault/guest/:token" element={<VaultGuest />} />
              <Route path="/vault/share/:token" element={<VaultGuest />} />
              <Route path="/knowledge-base" element={<ProtectedRoute><KnowledgeBase /></ProtectedRoute>} />
              <Route path="/brain" element={<ProtectedRoute><Brain /></ProtectedRoute>} />
              <Route path="/brain/:id" element={<ProtectedRoute><BrainDocument /></ProtectedRoute>} />
              <Route path="/analytics" element={<ProtectedRoute><Analytics /></ProtectedRoute>} />
              <Route path="/stabilization-map/lead/:leadId" element={<ProtectedRoute><StabilizationMapResolver /></ProtectedRoute>} />
              <Route path="/stabilization-map/contact/:contactId" element={<ProtectedRoute><StabilizationMapResolver /></ProtectedRoute>} />
              <Route path="/stabilization-map/household/:householdId" element={<ProtectedRoute><StabilizationMapResolver /></ProtectedRoute>} />
              <Route path="/stabilization-map/:id" element={<ProtectedRoute><StabilizationMap /></ProtectedRoute>} />
              <Route path="/governance-audit/household/:householdId" element={<ProtectedRoute><GovernanceAuditResolver /></ProtectedRoute>} />
              <Route path="/governance-audit/:id" element={<ProtectedRoute><GovernanceAudit /></ProtectedRoute>} />
              <Route path="/quarterly-system-review/contact/:contactId" element={<ProtectedRoute><QuarterlySystemReviewResolver /></ProtectedRoute>} />
              <Route path="/quarterly-system-review/:id" element={<ProtectedRoute><QuarterlySystemReview /></ProtectedRoute>} />
              <Route path="/workbench/quarterly-review" element={<ProtectedRoute><QuarterlyReview /></ProtectedRoute>} />
              <Route path="/workbench/governance-review" element={<ProtectedRoute><GovernanceReview /></ProtectedRoute>} />
              <Route path="/workbench/vfo-audit" element={<ProtectedRoute><QuarterlyVfoAudit /></ProtectedRoute>} />
              <Route path="/quarterly-account-sync" element={<ProtectedRoute><QuarterlyReview /></ProtectedRoute>} />
              <Route path="/sovereignty-charter/contact/:contactId" element={<ProtectedRoute><SovereigntyCharter /></ProtectedRoute>} />
              <Route path="/charter-intake/household/:householdId" element={<ProtectedRoute><CharterIntake /></ProtectedRoute>} />
              <Route path="/household-ontology/household/:householdId" element={<ProtectedRoute><HouseholdOntology /></ProtectedRoute>} />
              <Route path="/delta-reconciliation/household/:householdId" element={<ProtectedRoute><DeltaReconciliationWorkbench /></ProtectedRoute>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
