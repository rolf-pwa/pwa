import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/shared/integrations/supabase/client";
import { signInWithGoogle } from "@/shared/lib/auth";
import { toast } from "sonner";
import { PortalTerritory } from "@/modules/portal/components/PortalTerritory";
import { PortalHoldingTank } from "@/modules/portal/components/PortalHoldingTank";
import { PortalInsurance } from "@/modules/portal/components/PortalInsurance";
import { PortalRequests } from "@/modules/portal/components/PortalRequests";
import { PortalMeetings } from "@/modules/portal/components/PortalMeetings";
import { PortalCharter } from "@/modules/portal/components/PortalCharter";
import { PortalTimeline } from "@/modules/portal/components/PortalTimeline";
import { PortalTasks } from "@/modules/portal/components/PortalTasks";
import { PortalUpdates, useUnreadUpdateCount } from "@/modules/portal/components/PortalUpdates";
import { PortalGeorgiaChat } from "@/modules/portal/components/PortalGeorgiaChat";
import { PortalNotificationBell } from "@/modules/portal/components/PortalNotificationBell";
import { PortalMessages } from "@/modules/portal/components/PortalMessages";
import { PortalVault } from "@/modules/portal/components/PortalVault";
import { PortalIntakeBanner } from "@/modules/intake";
import { OnboardingShell } from "@/modules/intake";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { Input } from "@/shared/components/ui/input";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/shared/components/ui/input-otp";
import { Grape, ScrollText, Clock, Calendar, FolderOpen, CheckSquare, ShieldCheck, ExternalLink, FileBarChart, Mail, MailX, Loader2, Home, Users, ChevronLeft, ChevronDown, ChevronRight, ArrowRight, Landmark, MessageCircle, Video, MapPin, ClipboardList, LogOut, Megaphone, Building2, FolderLock } from "lucide-react";
import prosperwiseLogo from "@/assets/prosperwise-icon-paper.png";
import { insuranceCashForStorehouses, sumValues, isAumStorehouse, formatCurrency } from "@/modules/portal/lib/portalAum";

interface PortalData {
  portal_token?: string;
  contact: any;
  charter?: {
    id: string;
    title: string | null;
    draft_status: string | null;
    ratified_at: string | null;
    last_generated_at: string | null;
  } | null;
  vineyard_accounts: any[];
  storehouses: any[];
  holding_tank?: any[];
  household_holding_tank?: any[];
  family_holding_tank?: any[];
  audit_trail: any[];
  portal_requests: any[];
  meetings: any[];
  family: any | null;
  household: any | null;
  household_members: any[];
  hierarchy?: any;
  corporations?: any[];
  quarterly_reviews?: Array<{
    id: string;
    contact_id: string;
    title: string;
    file_name: string | null;
    signed_url: string | null;
    drive_url: string | null;
    review_date: string | null;
  }>;
  insurance_policies?: any[];
}

const INACTIVITY_TIMEOUT = 15 * 60 * 1000;
const CORP_TYPE_LABELS: Record<string, string> = { opco: "Operating Co", holdco: "Holding Co", trust: "Trust", partnership: "Partnership", other: "Entity" };

const ROLE_LABELS: Record<string, string> = {
  head_of_family: "Head of Family",
  head_of_household: "Head of Household",
  spouse: "Spouse",
  beneficiary: "Beneficiary",
  minor: "Minor",
};

// ─── Drill-down view types ───
type ViewLevel = "family" | "household" | "individual";

interface DrilldownState {
  level: ViewLevel;
  householdId?: string;
  memberId?: string;
}

// ─── Dynamic Portal Links Component ───
const LINK_ICONS: Record<string, any> = {
  ExternalLink,
  FolderOpen,
  Landmark,
  ShieldCheck,
  FileBarChart,
  ScrollText,
  BookOpen: FolderOpen,
  Globe: ExternalLink,
};

function PortalDynamicLinks({ contact }: { contact: any }) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const { data: links = [] } = useQuery({
    queryKey: ["portal-links-public"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("portal_links" as any)
        .select("*")
        .eq("is_active", true)
        .order("sort_order")
        .order("created_at");
      if (error) throw error;
      return data as any[];
    },
  });

  if (links.length === 0) return null;

  // Split into ungrouped and grouped
  const ungrouped = links.filter((l: any) => !l.group_label);
  const grouped = links
    .filter((l: any) => l.group_label)
    .reduce<Record<string, any[]>>((acc, l: any) => {
      if (!acc[l.group_label]) acc[l.group_label] = [];
      acc[l.group_label].push(l);
      return acc;
    }, {});

  const toggleGroup = (g: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  };

  const renderLink = (link: any) => {
    const IconComp = LINK_ICONS[link.icon] || ExternalLink;
    const href = link.url;

    return (
      <a
        key={link.id}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 rounded px-3 py-2 text-sm transition-colors text-foreground hover:bg-muted/50"
      >
        <IconComp className="h-3.5 w-3.5" />
        {link.label}
        <ExternalLink className="ml-auto h-3 w-3 opacity-40" />
      </a>
    );
  };

  const systemUngrouped = ungrouped.filter((l: any) => l.is_system);
  const customUngrouped = ungrouped.filter((l: any) => !l.is_system);

  return (
    <div className="flex flex-col gap-1.5">
      {/* System ungrouped links first */}
      {systemUngrouped.map((link: any) => {
        const IconComp = LINK_ICONS[link.icon] || ExternalLink;
        const href = link.url;

        return (
          <a
            key={link.id}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-md border border-border px-3 py-2.5 text-sm font-medium transition-colors text-foreground hover:bg-muted/50"
          >
            <IconComp className="h-4 w-4" />
            {link.label}
            <ExternalLink className="ml-auto h-3 w-3 opacity-40" />
          </a>
        );
      })}

      {/* Grouped links (e.g. My Accounts) */}
      {Object.entries(grouped).map(([groupName, groupLinks]) => {
        const isOpen = openGroups.has(groupName);
        return (
          <div key={groupName} className="rounded-md border border-border">
            <button
              type="button"
              onClick={() => toggleGroup(groupName)}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
            >
              <Landmark className="h-4 w-4" />
              {groupName}
              {isOpen ? (
                <ChevronDown className="ml-auto h-3.5 w-3.5 opacity-60" />
              ) : (
                <ChevronRight className="ml-auto h-3.5 w-3.5 opacity-60" />
              )}
            </button>
            {isOpen && (
              <div className="flex flex-col gap-0.5 px-2 pb-2">
                {groupLinks.map(renderLink)}
              </div>
            )}
          </div>
        );
      })}
      {/* Custom user-created links after groups */}
      {customUngrouped.map((link: any) => {
        const IconComp = LINK_ICONS[link.icon] || ExternalLink;
        return (
          <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-md border border-border px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
          >
            <IconComp className="h-4 w-4" />
            {link.label}
            <ExternalLink className="ml-auto h-3 w-3 opacity-40" />
          </a>
        );
      })}
    </div>
  );
}

const Portal = ({ intakeRoute = false }: { intakeRoute?: boolean }) => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!token);
  const [activeTab, setActiveTab] = useState("tasks");

  // Drill-down state
  const [drilldown, setDrilldown] = useState<DrilldownState>({ level: "individual" });
  const [georgiaOpen, setGeorgiaOpen] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [togglingNotif, setTogglingNotif] = useState(false);
  const [expandedCorps, setExpandedCorps] = useState<Set<string>>(new Set());
  const [accountsOpen, setAccountsOpen] = useState(false);

  // Unread update count — must be called unconditionally (Rules of Hooks)
  const unreadUpdateCount = useUnreadUpdateCount(data?.household?.governance_status ?? "", data?.contact?.id ?? "", data?.contact?.household_id ?? null, token || data?.portal_token || "");

  // OTP login state
  const [email, setEmail] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [trustDevice, setTrustDevice] = useState(true);

  // ── Trusted device (skip-OTP) helpers ──
  const TRUSTED_DEVICE_KEY = "pw_trusted_device";
  const readTrustedDevice = (): { token: string; email: string } | null => {
    try {
      const raw = localStorage.getItem(TRUSTED_DEVICE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.token || !parsed?.email) return null;
      return parsed;
    } catch { return null; }
  };
  const writeTrustedDevice = (token: string | null, emailVal: string) => {
    if (!token) return;
    try { localStorage.setItem(TRUSTED_DEVICE_KEY, JSON.stringify({ token, email: emailVal.toLowerCase() })); } catch {}
  };
  const clearTrustedDevice = () => {
    try { localStorage.removeItem(TRUSTED_DEVICE_KEY); } catch {}
  };

  // Inactivity timeout (15 minutes) — INACTIVITY_TIMEOUT hoisted to module scope
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleLogout = useCallback(() => {
    sessionStorage.removeItem("portal_google_auth");
    supabase.auth.signOut().then(() => {
      setData(null);
      setEmail("");
      setOtpSent(false);
      setOtp("");
      window.location.href = "/portal";
    });
  }, []);

  useEffect(() => {
    if (!data) return; // Only track activity when logged in

    const resetTimer = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(handleLogout, INACTIVITY_TIMEOUT);
    };

    const events = ["mousedown", "keydown", "scroll", "touchstart", "mousemove"];
    events.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }));
    resetTimer(); // start timer

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      events.forEach((e) => window.removeEventListener(e, resetTimer));
    };
  }, [data, handleLogout]);
  // Sync notification preference from data
  useEffect(() => {
    if (data?.contact?.email_notifications_enabled !== undefined) {
      setNotificationsEnabled(data.contact.email_notifications_enabled);
    }
  }, [data?.contact?.email_notifications_enabled]);

  const handleToggleNotifications = async () => {
    const activeToken = token || data?.portal_token;
    if (!activeToken) return;
    const prevVal = notificationsEnabled;
    const newVal = !notificationsEnabled;
    setTogglingNotif(true);
    // Optimistic update
    setNotificationsEnabled(newVal);
    try {
      const res = await supabase.functions.invoke("portal-update-scope", {
        body: { portal_token: activeToken, action: "toggle_notifications", enabled: newVal },
      });
      if (res.error || res.data?.error) throw new Error(res.data?.error || "Failed to update notifications");
    } catch (err: any) {
      // Revert and surface the error to the user
      setNotificationsEnabled(prevVal);
      toast.error(err?.message || "Could not update notification preferences. Please try again.");
    } finally {
      setTogglingNotif(false);
    }
  };


  useEffect(() => {
    if (token || data) return;
    const stored = sessionStorage.getItem("portal_google_auth");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed?.contact) {
          setData(parsed);
          setDrilldown({ level: "individual" });
          sessionStorage.removeItem("portal_google_auth");
        }
      } catch {}
    }
  }, [token, data]);

  // Refresh portal data (after scope change etc.)
  const refreshData = async (currentToken: string) => {
    try {
      const resp = await supabase.functions.invoke("portal-validate", {
        body: { token: currentToken },
      });
      if (!resp.error && !resp.data?.error) {
        setData(resp.data);
      }
    } catch {}
  };

  // Legacy token-based access (for advisor "View Portal" bypass)
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const resp = await supabase.functions.invoke("portal-validate", {
          body: { token },
        });
        if (resp.error || resp.data?.error) {
          setError(resp.data?.error || "Invalid link");
        } else {
          setData(resp.data);
          setDrilldown({ level: "individual" });
        }
      } catch {
        setError("Unable to load portal");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const handleSendOtp = async () => {
    if (!email.trim()) return;
    setOtpLoading(true);
    setOtpError(null);
    try {
      // Try silent device login first (skips OTP for trusted devices)
      const stored = readTrustedDevice();
      if (stored && stored.email === email.trim().toLowerCase()) {
        const dev = await supabase.functions.invoke("portal-otp", {
          body: { action: "device-login", email: email.trim(), trusted_device_token: stored.token },
        });
        if (!dev.error && !dev.data?.error && dev.data?.portal_token) {
          // device-login only confirms trust and issues a token — it does not
          // return full portal data. Fetch that via portal-validate, same as
          // the token-based magic-link path, rather than setting state from
          // its minimal { contact } response.
          const full = await supabase.functions.invoke("portal-validate", {
            body: { token: dev.data.portal_token },
          });
          if (!full.error && !full.data?.error) {
            setData(full.data);
            setDrilldown({ level: "individual" });
            setOtpLoading(false);
            return;
          }
        }
        // token rejected — clear it so we don't loop
        clearTrustedDevice();
      }

      const resp = await supabase.functions.invoke("portal-otp", {
        body: { action: "send", email: email.trim() },
      });
      if (resp.error) throw resp.error;
      setOtpSent(true);
    } catch {
      setOtpError("Something went wrong. Please try again.");
    } finally {
      setOtpLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otp.length !== 6) return;
    setOtpLoading(true);
    setOtpError(null);
    try {
      const resp = await supabase.functions.invoke("portal-otp", {
        body: { action: "verify", email: email.trim(), code: otp, trust_device: trustDevice },
      });
      if (resp.error || resp.data?.error) {
        setOtpError(resp.data?.error || "Invalid code. Please try again.");
      } else {
        if (trustDevice && resp.data?.trusted_device_token) {
          writeTrustedDevice(resp.data.trusted_device_token, email.trim());
        }
        setData(resp.data);
        setDrilldown({ level: "individual" });
      }
    } catch {
      setOtpError("Something went wrong. Please try again.");
    } finally {
      setOtpLoading(false);
    }
  };

  // --- OTP Login Screen ---
  if (!token && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="mx-4 w-full max-w-md space-y-8 text-center">
          <div className="space-y-3">
            <div className="mx-auto flex h-16 w-16 items-center justify-center">
              <img src={prosperwiseLogo} alt="ProsperWise" className="h-16 w-16" />
            </div>
            <h1 className="text-3xl font-bold text-foreground font-serif">
              ProsperWise Portal
            </h1>
            <p className="text-sm text-muted-foreground">
              ProsperWise Advisors — Secure Client Access
            </p>
          </div>

          <div className="rounded-lg border border-border bg-card p-8 text-left space-y-5">
            {/* Client login now runs through its own External-type GCP OAuth
                client (separate from staff's Internal Gmail/Calendar/Drive
                connector), so any Google account can complete sign-in here. */}
            <Button
              onClick={() => signInWithGoogle()}
              variant="outline"
              className="w-full"
              size="lg"
            >
              <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              Sign in with Google
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">or use email code</span>
              </div>
            </div>

            {!otpSent ? (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Email Address</label>
                  <p className="text-xs text-muted-foreground">
                    Enter the email on file with your Personal CFO.
                  </p>
                  <Input
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSendOtp()}
                    disabled={otpLoading}
                  />
                </div>
                {otpError && <p className="text-xs text-destructive">{otpError}</p>}
                <Button onClick={handleSendOtp} disabled={otpLoading || !email.trim()} className="w-full" size="lg">
                  {otpLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                  Send Access Code
                </Button>
              </>
            ) : (
              <>
                <div className="space-y-2 text-center">
                  <Mail className="h-8 w-8 text-accent mx-auto" />
                  <p className="text-sm text-foreground font-medium">Check your email</p>
                  <p className="text-xs text-muted-foreground">
                    We sent a 6-digit code to <span className="font-medium text-foreground">{email}</span>
                  </p>
                </div>
                <div className="flex justify-center">
                  <InputOTP maxLength={6} value={otp} onChange={setOtp}>
                    <InputOTPGroup>
                      <InputOTPSlot index={0} />
                      <InputOTPSlot index={1} />
                      <InputOTPSlot index={2} />
                      <InputOTPSlot index={3} />
                      <InputOTPSlot index={4} />
                      <InputOTPSlot index={5} />
                    </InputOTPGroup>
                  </InputOTP>
                </div>
                {otpError && <p className="text-xs text-destructive text-center">{otpError}</p>}
                <label className="flex items-center justify-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={trustDevice}
                    onChange={(e) => setTrustDevice(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-border accent-accent"
                  />
                  Remember this device for 30 days
                </label>
                <Button onClick={handleVerifyOtp} disabled={otpLoading || otp.length !== 6} className="w-full" size="lg">
                  {otpLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Verify & Enter Portal
                </Button>
                <button
                  onClick={() => { setOtpSent(false); setOtp(""); setOtpError(null); }}
                  className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Use a different email
                </button>
              </>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            OTP code expires in 10 minutes · Max 3 requests per hour
          </p>

          <Link
            to="/portal/privacy"
            className="block text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
          >
            Privacy & Security Policy
          </Link>
        </div>
      </div>
    );
  }

  // --- Loading ---
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <img src={prosperwiseLogo} alt="ProsperWise" className="h-10 w-10 animate-pulse" />
          <p className="text-muted-foreground text-sm">Loading your Financial Territory…</p>
        </div>
      </div>
    );
  }

  if (error || !data?.contact) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <img src={prosperwiseLogo} alt="ProsperWise" className="h-12 w-12 mx-auto opacity-50" />
          <h1 className="text-xl font-semibold text-foreground">Access Denied</h1>
          <p className="text-muted-foreground text-sm max-w-sm">
            {error || "This portal link is invalid or has expired. Please contact your Personal CFO for a new link."}
          </p>
        </div>
      </div>
    );
  }

  const { contact, charter, vineyard_accounts, storehouses, holding_tank = [], household_holding_tank = [], family_holding_tank = [], audit_trail, portal_requests, meetings, family, household, household_members, hierarchy, corporations = [], quarterly_reviews = [], insurance_policies = [] } = data;
  const portalToken = token || data.portal_token || "";
  const hierarchyLevel = hierarchy?.level || "individual";

  // Determine current view context
  const currentHousehold = drilldown.householdId
    ? hierarchy?.households?.find((h: any) => h.id === drilldown.householdId)
    : null;
  const currentMember = drilldown.memberId
    ? (currentHousehold?.members || hierarchy?.members || []).find((m: any) => m.id === drilldown.memberId)
    : null;

  // Breadcrumb navigation
  const renderBreadcrumb = () => {
    if (drilldown.level === "family" && hierarchyLevel === "family") return null;
    
    return (
      <div className="flex items-center gap-2 text-sm mb-4">
        {hierarchyLevel === "family" && (drilldown.level === "household" || drilldown.level === "individual") && (
          <button
            onClick={() => setDrilldown({ level: "family" })}
            className="flex items-center gap-1 text-primary hover:underline"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            {family?.name || "Family"}
          </button>
        )}
        {drilldown.level === "individual" && drilldown.householdId && (
          <>
            <span className="text-muted-foreground">/</span>
            <button
              onClick={() => setDrilldown({ level: "household", householdId: drilldown.householdId })}
              className="text-primary hover:underline"
            >
              {currentHousehold?.label || "Household"}
            </button>
          </>
        )}
        {drilldown.level === "individual" && currentMember && (
          <>
            <span className="text-muted-foreground">/</span>
            <span className="text-foreground font-medium">{currentMember.first_name} {currentMember.last_name || ""}</span>
          </>
        )}
      </div>
    );
  };

  // Helper: aggregate assets from hierarchy at a given scope level.
  // Note: backend already filters out households where hof_visible=false for
  // HoFs, so every household present in `hierarchy` is fully accessible.
  const aggregateAssetsAtLevel = (level: "family" | "household", householdId?: string) => {
    const allVineyard: any[] = [];
    const allStorehouses: any[] = [];

    if (level === "family") {
      const households = hierarchy?.households || [];
      households.forEach((hh: any) => {
        (hh.members || []).forEach((m: any) => {
          (m.vineyard_accounts || []).forEach((a: any) => allVineyard.push(a));
          (m.storehouses || [])
            .filter((a: any) => a.asset_type !== 'Primary Residence & Protected Legacy Accounts')
            .forEach((a: any) => allStorehouses.push(a));
        });
      });
    } else if (level === "household") {
      const members = householdId
        ? (hierarchy?.households?.find((h: any) => h.id === householdId)?.members || [])
        : (hierarchy?.members || []);
      const selfInMembers = members.some((m: any) => m.id === contact.id);
      if (!selfInMembers) {
        allVineyard.push(...vineyard_accounts);
        allStorehouses.push(
          ...storehouses.filter((a: any) => a.asset_type !== 'Primary Residence & Protected Legacy Accounts')
        );
      }
      members.forEach((m: any) => {
        (m.vineyard_accounts || []).forEach((a: any) => allVineyard.push(a));
        (m.storehouses || [])
          .filter((a: any) => a.asset_type !== 'Primary Residence & Protected Legacy Accounts')
          .forEach((a: any) => allStorehouses.push(a));
      });
    }

    return { vineyard: allVineyard, storehouses: allStorehouses };
  };


  // ─── Family Overview (drill-down landing) ───
  const renderFamilyView = () => {
    const households = hierarchy?.households || [];

    // Family Shared total: only assets explicitly scoped `family_shared`
    // across all HoF-visible households (respects household privacy).
    const allMembers = households.flatMap((hh: any) => hh.members || []);
    const memberIdSet = new Set<string>(allMembers.map((m: any) => m.id));
    const sharedVineyard = allMembers.flatMap((m: any) =>
      (m.vineyard_accounts || []).filter((a: any) => a.visibility_scope === "family_shared")
    );
    const sharedStore = allMembers.flatMap((m: any) =>
      (m.storehouses || []).filter((a: any) => a.visibility_scope === "family_shared" && isAumStorehouse(a))
    );
    const sharedTank = (family_holding_tank || []).filter(
      (t: any) => memberIdSet.has(t.contact_id) && t.visibility_scope === "family_shared"
    );
    const sharedInsurance = (insurance_policies || []).filter(
      (p: any) => memberIdSet.has(p.contact_id) && p.visibility_scope === "family_shared"
    );
    const familySharedTotal = sumValues(sharedVineyard) + sumValues(sharedStore)
      + sumValues(sharedTank)
      + insuranceCashForStorehouses(sharedInsurance);

    return (
      <div className="space-y-6">
        {/* Family Summary — shows only assets explicitly shared with the family */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
                <Home className="h-5 w-5 text-accent" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground font-serif">{family?.name || "Family"}</h2>
                <p className="text-xs text-muted-foreground">
                  {households.length} household{households.length !== 1 ? "s" : ""} · {households.reduce((s: number, h: any) => s + (h.members?.length || 0), 0)} members
                </p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-2xl font-bold text-accent">{formatCurrency(familySharedTotal)}</p>
                <p className="text-xs text-muted-foreground">Family Shared Assets</p>
              </div>
            </div>
          </CardContent>
        </Card>


        {/* Household Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {households.map((hh: any) => {
            const members = hh.members || [];
            const isOwnHousehold = hh.id === contact.household_id;

            // Every household card on the Family Overview — including the viewer's
            // own — shows only family_shared assets, so each card's total is
            // provably a component of the family-level total above (§ familySharedTotal).
            const scopeFilter = (a: any) => a.visibility_scope === "family_shared";

            const hhVineyard = members.flatMap((m: any) =>
              (m.vineyard_accounts || []).filter(scopeFilter)
            );
            const hhStore = members.flatMap((m: any) =>
              (m.storehouses || []).filter((a: any) => isAumStorehouse(a) && scopeFilter(a))
            );
            const memberIds = new Set(members.map((m: any) => m.id));
            const hhTank = (family_holding_tank || []).filter(
              (t: any) => memberIds.has(t.contact_id) && scopeFilter(t)
            );
            const hhInsurance = (insurance_policies || []).filter(
              (p: any) => memberIds.has(p.contact_id) && scopeFilter(p)
            );
            const hhTotal = sumValues(hhVineyard) + sumValues(hhStore)
              + sumValues(hhTank)
              + insuranceCashForStorehouses(hhInsurance);

            const hasSharedAssets = hhTotal > 0;

            return (
              <button
                key={hh.id}
                onClick={() => setDrilldown({ level: "household", householdId: hh.id })}
                className="text-left rounded-lg border border-border bg-card p-5 hover:border-accent/30 hover:bg-muted/30 transition-colors group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Home className="h-4 w-4 text-accent" />
                    <h3 className="font-semibold text-foreground font-serif">{hh.label} Household</h3>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                {hh.address && (
                  <p className="text-xs text-muted-foreground mb-3">{hh.address}</p>
                )}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      {members.length} member{members.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  {isOwnHousehold || hasSharedAssets ? (
                    <span className="text-sm font-semibold text-foreground">
                      {formatCurrency(hhTotal)}
                    </span>
                  ) : (
                    <span className="text-xs italic text-muted-foreground">Private</span>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {members.slice(0, 4).map((m: any) => (
                    <span key={m.id} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                      {m.first_name}
                    </span>
                  ))}
                  {members.length > 4 && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                      +{members.length - 4}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  // ─── Household View (shows member cards + territory sidebar) ───
  const renderHouseholdView = () => {
    const members = currentHousehold?.members || hierarchy?.members || [];
    const hhLabel = currentHousehold?.label || household?.label || "Household";
    const viewingOwnHousehold = members.some((m: any) => m.id === contact.id);
    // Privacy firewall: when viewing a sibling household, only assets
    // explicitly scoped `family_shared` are visible. Household-internal
    // assets stay private to that household's members.
    const allowedScopes = viewingOwnHousehold
      ? new Set(["household_shared", "family_shared"])
      : new Set(["family_shared"]);
    const rawHhAssets = aggregateAssetsAtLevel("household", drilldown.householdId);
    const hhAssets = {
      vineyard: rawHhAssets.vineyard.filter((a: any) => allowedScopes.has(a.visibility_scope)),
      storehouses: rawHhAssets.storehouses.filter((a: any) => allowedScopes.has(a.visibility_scope)),
    };
    const visibleInsurance = (insurance_policies || []).filter((p: any) => allowedScopes.has(p.visibility_scope));


    return (
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content: Household info + member cards */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
                  <Home className="h-5 w-5 text-accent" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-foreground font-serif">{hhLabel} Household</h2>
                  <p className="text-xs text-muted-foreground">
                    {members.length + (viewingOwnHousehold ? 0 : 1)} member{members.length !== 0 ? "s" : ""}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Member cards — ordered: Head, Spouse, Beneficiary, Minor */}
          <div className="grid gap-3">
            {(!viewingOwnHousehold
              ? members.map((m: any) => ({ ...m, _isSelf: false }))
              : [
                  { ...contact, _isSelf: true },
                  ...members.filter((m: any) => m.id !== contact.id).map((m: any) => ({ ...m, _isSelf: false })),
                ])
              .sort((a: any, b: any) => {
                const order: Record<string, number> = { head_of_family: 0, head_of_household: 1, spouse: 2, beneficiary: 3, minor: 4 };
                return (order[a.family_role] ?? 4) - (order[b.family_role] ?? 4);
              })
              .map((m: any) => {
                const isSelf = m._isSelf;
                const mVineyard = isSelf ? vineyard_accounts : (m.vineyard_accounts || []);
                const mStorehouses = isSelf ? storehouses : (m.storehouses || []);
                const mVineyardShared = mVineyard.filter((a: any) => allowedScopes.has(a.visibility_scope));
                const mStoreShared = mStorehouses.filter((a: any) => allowedScopes.has(a.visibility_scope) && isAumStorehouse(a));
                const rawTank = ((isSelf ? (holding_tank || []) : []) as any[])
                  .concat((household_holding_tank || []).filter((t: any) => t.contact_id === m.id))
                  .concat((family_holding_tank || []).filter((t: any) => t.contact_id === m.id));
                const mTankAll = Array.from(new Map(rawTank.map((t: any) => [t.id, t])).values());
                const mTankDedup = mTankAll.filter((t: any) => allowedScopes.has(t.visibility_scope));
                const mInsuranceAll = insurance_policies.filter((p: any) => p.contact_id === m.id);
                const mInsurance = mInsuranceAll.filter((p: any) => allowedScopes.has(p.visibility_scope));
                const mTotal = sumValues(mVineyardShared) + sumValues(mStoreShared)
                  + sumValues(mTankDedup)
                  + insuranceCashForStorehouses(mInsurance);



                const canDrill = isSelf || viewingOwnHousehold;
                return (
                  <button
                    key={m.id}
                    disabled={!canDrill}
                    onClick={() => {
                      if (!canDrill) return;
                      setDrilldown({
                        level: "individual",
                        householdId: drilldown.householdId,
                        memberId: isSelf ? undefined : m.id,
                      });
                    }}
                    className={`text-left rounded-lg p-4 transition-colors group ${
                      isSelf
                        ? "border border-primary/30 bg-primary/5 hover:bg-primary/10"
                        : canDrill
                          ? "border border-border bg-card hover:border-primary/30 hover:bg-muted/30"
                          : "border border-border bg-card cursor-default"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`flex h-8 w-8 items-center justify-center rounded-full ${isSelf ? "bg-primary/20" : "bg-muted"}`}>
                          {isSelf ? <img src={prosperwiseLogo} alt="" className="h-4 w-4" /> : <Users className="h-4 w-4 text-muted-foreground" />}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{m.first_name} {m.last_name || ""}</p>
                          <p className="text-xs text-muted-foreground">
                            {ROLE_LABELS[m.family_role] || m.family_role}
                            {isSelf ? " · You" : ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {<span className="text-sm font-semibold text-foreground">{formatCurrency(mTotal)}</span>}
                        {canDrill && <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />}
                      </div>
                    </div>
                  </button>
                );
              })
            }
          </div>

          {/* Corporation cards — `corporations` is always the viewer's own
              shareholdings (portal-validate scopes it to the viewer's own
              household, not the household being viewed), so only show it
              here when this page is actually the viewer's own household. */}
          {viewingOwnHousehold && corporations.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 mt-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Corporate Entities</h3>
              </div>
              {corporations.map((corp: any) => {
                const isExpanded = expandedCorps.has(corp.id);
                const toggleCorp = () => {
                  setExpandedCorps(prev => {
                    const next = new Set(prev);
                    if (next.has(corp.id)) next.delete(corp.id);
                    else next.add(corp.id);
                    return next;
                  });
                };
                return (
                  <button
                    key={corp.id}
                    onClick={toggleCorp}
                    className="w-full text-left rounded-lg border border-border bg-card p-4 space-y-2 hover:border-primary/30 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                          <Building2 className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{corp.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {CORP_TYPE_LABELS[corp.corporation_type] || corp.corporation_type}
                            {corp.jurisdiction ? ` · ${corp.jurisdiction}` : ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">{formatCurrency(corp.total_assets || 0)}</span>
                        {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="space-y-2 pt-1">
                        {/* Shareholders */}
                        <div className="pl-11 space-y-0.5">
                          {corp.shareholders.map((sh: any) => {
                            const memberName = sh.contact_id === contact.id
                              ? `${contact.first_name} ${contact.last_name || ""}`.trim()
                              : (() => {
                                  const m = household_members.find((m: any) => m.id === sh.contact_id);
                                  return m ? `${m.first_name} ${m.last_name || ""}`.trim() : "Member";
                                })();
                            return (
                              <p key={sh.contact_id} className="text-xs text-muted-foreground">
                                {memberName} — {sh.ownership_percentage}% {sh.share_class || ""}
                                {sh.role_title ? ` · ${sh.role_title}` : ""}
                              </p>
                            );
                          })}
                        </div>
                        {/* Corporate Vineyard Accounts */}
                        {(corp.vineyard_accounts || []).length > 0 && (
                          <div className="pl-11 space-y-1 border-t border-border/50 pt-2">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Accounts</p>
                            {corp.vineyard_accounts.map((acc: any) => (
                              <div key={acc.id} className="flex items-center justify-between text-xs">
                                <span className="text-foreground/80">{acc.account_name}</span>
                                <span className="font-medium text-foreground">{formatCurrency(Number(acc.current_value) || 0)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Sidebar: Household-Shared Territory */}
        <div className="space-y-4">
          {/* Household Holding Tank — private to household members only */}
          {viewingOwnHousehold && (() => {
            const visibleTank = household_holding_tank.filter((t: any) => allowedScopes.has(t.visibility_scope));
            return visibleTank.length > 0 && (
              <PortalHoldingTank accounts={visibleTank} defaultCollapsed />
            );
          })()}

          <PortalTerritory
            vineyardAccounts={hhAssets.vineyard}
            storehouses={hhAssets.storehouses}
            insurancePolicies={visibleInsurance}
            contact={contact}
            family={family}
            household={currentHousehold || household}
            householdMembers={[]}
            scopeLabel={viewingOwnHousehold ? "Household Shared" : "Family-Shared"}
            portalToken={portalToken}
            onScopeChange={() => refreshData(portalToken)}
            corporations={viewingOwnHousehold ? corporations : []}
            defaultCollapsed
          />
          {visibleInsurance.length > 0 && (
            <PortalInsurance policies={visibleInsurance} defaultCollapsed />
          )}
        </div>
      </div>
    );
  };

  // ─── Individual View (tasks + meetings main, territory sidebar) ───
  const getIndividualData = () => {
    if (currentMember) {
      // Reachable only for a fellow member of the viewer's own household
      // (gated by canDrill in the household view) — but that doesn't make
      // their private-scoped assets visible to us. Same rule as everywhere
      // else: household_shared/family_shared only, private stays private.
      const allowed = new Set(["household_shared", "family_shared"]);
      return {
        name: `${currentMember.first_name} ${currentMember.last_name || ""}`.trim(),
        role: currentMember.family_role,
        vineyardAccounts: (currentMember.vineyard_accounts || []).filter((a: any) => allowed.has(a.visibility_scope)),
        memberStorehouses: (currentMember.storehouses || []).filter((a: any) => allowed.has(a.visibility_scope)),
        insurancePolicies: (insurance_policies || []).filter((p: any) => p.contact_id === currentMember.id && allowed.has(p.visibility_scope)),
      };
    }


    // Viewing self
    return {
      name: `${contact.first_name} ${contact.last_name || ""}`.trim(),
      role: contact.family_role,
      vineyardAccounts: vineyard_accounts,
      memberStorehouses: storehouses,
      insurancePolicies: (insurance_policies || []).filter((p: any) => p.contact_id === contact.id),
    };
  };

  // unreadUpdateCount is already declared at the top level

  const renderIndividualView = () => {
    const ind = getIndividualData();
    const isSelf = !currentMember;
    const hasTerritory = (ind.vineyardAccounts?.length || 0) > 0 || (ind.memberStorehouses?.length || 0) > 0;
    const hasInsurance = (ind.insurancePolicies?.length || 0) > 0;
    const hasFinancials = hasTerritory || hasInsurance || (isSelf && holding_tank.length > 0);
    const effectiveTab = !hasFinancials && activeTab === "financials" ? "tasks" : activeTab;





    return (
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content: Tabbed Interface */}
        <div className="space-y-4 lg:col-span-2">
          {/* Sovereignty Survey — auto-hides once the survey is complete */}
          {isSelf && (
            <PortalIntakeBanner
              portalToken={portalToken}
              to={token ? `/portal/${token}/intake` : "/portal/intake"}
            />
          )}

          {/* Ask for Help — pinned above tabs */}
          {isSelf && (
            <Button
              variant="outline"
              onClick={() => setGeorgiaOpen(true)}
              className="w-full justify-center gap-2"
            >
              <MessageCircle className="h-4 w-4" />
              Ask for Help
            </Button>
          )}

          {/* Main Tabs */}
          <Tabs value={effectiveTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="w-full bg-muted border border-border flex-wrap h-auto">
              <TabsTrigger value="tasks" className="flex-1 gap-1.5">
                <CheckSquare className="h-4 w-4" />
                <span className="hidden sm:inline">Action Items</span>
                <span className="sm:hidden">Tasks</span>
              </TabsTrigger>
              <TabsTrigger value="meetings" className="flex-1 gap-1.5">
                <Calendar className="h-4 w-4" />
                Meetings
              </TabsTrigger>
              {hasFinancials && (
                <TabsTrigger value="financials" className="flex-1 gap-1.5">
                  <Landmark className="h-4 w-4" />
                  Financials
                </TabsTrigger>
              )}

              {isSelf && (
                <TabsTrigger value="vault" className="flex-1 gap-1.5">
                  <FolderLock className="h-4 w-4" />
                  Documents
                </TabsTrigger>
              )}
              {isSelf &&
                household?.governance_status === "sovereign" &&
                household?.fiduciary_entity === "pwa" && (
                  <TabsTrigger value="messages" className="flex-1 gap-1.5">
                    <MessageCircle className="h-4 w-4" />
                    Messages
                  </TabsTrigger>
                )}
            </TabsList>

            {/* Action Items Tab */}
            <TabsContent value="tasks" className="mt-4">
              {isSelf ? (
                <PortalTasks portalToken={portalToken} clientName={`${contact.first_name} ${contact.last_name || ""}`.trim()} contactId={contact.id} />
              ) : (
                <div className="rounded-lg border border-border bg-muted/30 p-8 text-center">
                  <CheckSquare className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground">Task view is only available for your own account.</p>
                </div>
              )}
            </TabsContent>

            {/* Meetings Tab (with Reviews) */}
            <TabsContent value="meetings" className="mt-4 space-y-6">
              {isSelf && (
                <div className="flex items-center justify-end gap-2">
                  <a
                    href="https://calendar.app.google/Fwsmx2LC8BjWf3Zh9"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors border border-primary/20"
                  >
                    <MapPin className="h-3.5 w-3.5" />
                    Survey — Personal
                  </a>
                  <a
                    href="https://calendar.app.google/raxnRa2RFQGL7KnD9"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors border border-primary/20"
                  >
                    <Building2 className="h-3.5 w-3.5" />
                    Survey — Corporate
                  </a>
                </div>
              )}
              {isSelf ? (
                <PortalMeetings meetings={meetings} />
              ) : (
                <div className="rounded-lg border border-border bg-muted/30 p-8 text-center">
                  <Calendar className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground">Meeting schedule is only visible on your own view.</p>
                </div>
              )}

              {/* Reviews moved from sidebar */}
              {isSelf && quarterly_reviews.length > 0 && (
                <Card>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <FileBarChart className="h-4 w-4 text-accent" />
                      <h3 className="text-sm font-semibold text-foreground font-serif">Reviews</h3>
                    </div>
                    <div className="space-y-1.5 pt-1">
                      {quarterly_reviews.map((review) => {
                        const member = household_members.find((m: any) => m.id === review.contact_id);
                        const memberName = review.contact_id === contact.id
                          ? `${contact.first_name} ${contact.last_name || ""}`.trim()
                          : member ? `${member.first_name} ${member.last_name || ""}`.trim() : null;
                        const href = review.signed_url || review.drive_url || "#";
                        const dateLabel = review.review_date
                          ? new Date(review.review_date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
                          : null;
                        return (
                          <a
                            key={review.id}
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-start gap-2 rounded-md border border-border bg-card px-2.5 py-2 hover:border-primary/40 hover:bg-primary/5 transition-colors"
                          >
                            <FileBarChart className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-foreground truncate">{review.title}</p>
                              {(dateLabel || memberName) && (
                                <p className="text-[10px] text-muted-foreground truncate">
                                  {dateLabel}{dateLabel && memberName ? " · " : ""}{memberName}
                                </p>
                              )}
                            </div>
                          </a>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Financials Tab — Holding Tank, Vineyard, Storehouses, Insurance */}
            {hasFinancials && (
              <TabsContent value="financials" className="mt-4 space-y-6">
                {isSelf && holding_tank.length > 0 && (
                  <PortalHoldingTank accounts={holding_tank} defaultCollapsed />
                )}
                {hasTerritory && (
                  <PortalTerritory
                    vineyardAccounts={ind.vineyardAccounts}
                    storehouses={ind.memberStorehouses}
                    insurancePolicies={ind.insurancePolicies}
                    contact={isSelf ? contact : currentMember}
                    family={family}
                    household={household}
                    householdMembers={[]}
                    scopeLabel={isSelf ? "My Territory" : `${currentMember?.first_name || ""}'s Territory`}
                    portalToken={portalToken}
                    onScopeChange={() => refreshData(portalToken)}
                    corporations={corporations}
                    section="all"
                    defaultCollapsed
                  />
                )}
                {hasInsurance && (
                  <PortalInsurance policies={ind.insurancePolicies} defaultCollapsed />
                )}
              </TabsContent>
            )}


            {/* Vault Tab */}
            {isSelf && (
              <TabsContent value="vault" className="mt-4">
                <PortalVault portalToken={portalToken} householdId={contact.household_id ?? null} />
              </TabsContent>
            )}

            {isSelf &&
              household?.governance_status === "sovereign" &&
              household?.fiduciary_entity === "pwa" && (
                <TabsContent value="messages" className="mt-4">
                  <PortalMessages
                    portalToken={portalToken}
                    contactName={`${contact.first_name} ${contact.last_name || ""}`.trim()}
                  />
                </TabsContent>
              )}

          </Tabs>

        </div>

        {/* Right Sidebar */}
        <div className="space-y-4">
          {/* Family Tile — top of sidebar */}
          {family && (
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10">
                    <Home className="h-5 w-5 text-accent" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground font-serif">{family.name}</p>
                    {household && (
                      <p className="text-xs text-muted-foreground">{household.label} Household</p>
                    )}
                  </div>
                </div>
                {household_members.length > 0 && (
                  <div className="border-t border-border pt-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Users className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-[11px] font-medium text-muted-foreground">Members</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {[...household_members].sort((a: any, b: any) => {
                        const order: Record<string, number> = { head_of_family: 0, head_of_household: 1, spouse: 2, beneficiary: 3, minor: 4 };
                        return (order[a.family_role] ?? 4) - (order[b.family_role] ?? 4);
                      }).map((m: any) => (
                        <span key={m.id} className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground border border-border">
                          {m.first_name} {m.last_name || ""}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {/* Navigate to household view for HoH/spouse roles */}
                {(hierarchyLevel === "household" || hierarchyLevel === "family") && isSelf && (
                  <div className="border-t border-border pt-3">
                    <button
                      onClick={() => {
                        if (hierarchyLevel === "family") {
                          setDrilldown({ level: "family" });
                        } else {
                          setDrilldown({ level: "household", householdId: contact.household_id });
                        }
                      }}
                      className="w-full flex items-center justify-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                    >
                      <Users className="h-3.5 w-3.5" />
                      {hierarchyLevel === "family" ? "View Family Overview" : "View Household"}
                    </button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Dynamic Quick Links (My Accounts, Empathy, etc.) — pinned below Household */}
          {isSelf && <PortalDynamicLinks contact={contact} />}

          {/* Charter — hidden if no charter file */}
          {(() => {
            const charterUrl = charter?.draft_status === "ratified" ? (contact.charter_url || family?.charter_document_url) : null;
            return charterUrl ? <PortalCharter charterUrl={charterUrl} /> : null;
          })()}


          {/* Updates — moved from tabs */}
          {isSelf && (
            <Card>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Megaphone className="h-4 w-4 text-accent" />
                  <h3 className="text-sm font-semibold text-foreground font-serif">Updates</h3>
                  {unreadUpdateCount > 0 && (
                    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground px-1">
                      {unreadUpdateCount > 99 ? "99+" : unreadUpdateCount}
                    </span>
                  )}
                </div>
                <PortalUpdates governanceStatus={household?.governance_status ?? ""} contactId={contact.id} householdId={contact.household_id} portalToken={portalToken} />
              </CardContent>
            </Card>
          )}

          {/* Requests — moved from tabs */}
          {isSelf && (
            <Card>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-accent" />
                  <h3 className="text-sm font-semibold text-foreground font-serif">Requests</h3>
                </div>
                <PortalRequests
                  requests={portal_requests || []}
                  contactId={contact.id}
                  contactName={`${contact.first_name} ${contact.last_name || ""}`.trim()}
                  portalToken={portalToken}
                  onUpdate={() => refreshData(portalToken)}
                />
              </CardContent>
            </Card>
          )}





          {/* Timeline — bottom of sidebar */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-medium text-muted-foreground">Timeline</h3>
            </div>
            <PortalTimeline auditTrail={audit_trail} />
          </div>
        </div>
      </div>
    );
  };

  // ─── Determine what to render based on drilldown ───
  const renderContent = () => {
    if (intakeRoute) {
      return (
        <OnboardingShell
          portalToken={portalToken}
          onBack={() => navigate(token ? `/portal/${token}` : "/portal")}
          onAskForHelp={() => setGeorgiaOpen(true)}
        />
      );
    }
    if (drilldown.level === "family" && hierarchyLevel === "family") {
      return renderFamilyView();
    }
    if (drilldown.level === "household") {
      return renderHouseholdView();
    }
    return renderIndividualView();
  };

  // Header subtitle based on current view
  const getHeaderSubtitle = () => {
    if (drilldown.level === "family") return family?.name ? `${family.name} — Family Overview` : "Family Overview";
    if (drilldown.level === "household") {
      const label = currentHousehold?.label || household?.label || "";
      return `${label} Household`;
    }
    if (currentMember) return `${currentMember.first_name} ${currentMember.last_name || ""}`;
    return family?.name ? `${family.name} — ${household?.label || ""}` : "Sovereign Financial Territory";
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-accent/40 bg-primary sticky top-0 z-10">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src={prosperwiseLogo} alt="ProsperWise" className="h-9 w-9 rounded-full" />
              <div>
                <h1 className="text-lg font-semibold text-primary-foreground font-serif">
                  {contact.first_name} {contact.last_name || ""}
                </h1>
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-primary-foreground/60">
                  {getHeaderSubtitle()}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <PortalNotificationBell
                requests={portal_requests || []}
                contactId={contact.id}
                portalToken={portalToken}
                onNavigateToRequests={() => setActiveTab("requests")}
                onNavigateToTasks={() => setActiveTab("tasks")}
              />
              <Button
                variant="ghost"
                size="sm"
                className="text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-foreground/10"
                onClick={handleToggleNotifications}
                disabled={togglingNotif}
                title={notificationsEnabled ? "Email notifications on" : "Email notifications off"}
              >
                {notificationsEnabled ? (
                  <Mail className="h-4 w-4" />
                ) : (
                  <MailX className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-foreground/10"
                onClick={handleLogout}
              >
                <LogOut className="h-4 w-4 mr-1.5" />
                <span className="hidden sm:inline">Sign Out</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {renderBreadcrumb()}
        {renderContent()}
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-12">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 text-center space-y-1.5">
          <p className="text-xs text-muted-foreground">
            ProsperWise Advisors — Your Personal CFO
          </p>
          <Link
            to="/portal/privacy"
            className="block text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
          >
            Privacy & Security Policy
          </Link>
        </div>
      </footer>

      <PortalGeorgiaChat
        open={georgiaOpen}
        onOpenChange={setGeorgiaOpen}
        contactName={contact.first_name}
        contactId={contact.id}
        portalToken={portalToken}
        onRequestSubmitted={() => refreshData(portalToken)}
      />
    </div>
  );
};

export default Portal;
