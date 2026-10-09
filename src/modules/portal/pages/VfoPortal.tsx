import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/shared/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { Badge } from "@/shared/components/ui/badge";

import { Button } from "@/shared/components/ui/button";
import {
  Loader2, Crown, ShieldCheck, Calendar, CheckSquare, Landmark, FolderLock,
  ClipboardList, MessageCircle, ScrollText, Home, Users, ChevronLeft,
  ChevronDown, ChevronRight, ArrowRight, Building2, Briefcase, Anchor, Grape,
} from "lucide-react";
import { PortalTerritory } from "@/modules/portal/components/PortalTerritory";
import { PortalHoldingTank } from "@/modules/portal/components/PortalHoldingTank";
import { PortalInsurance } from "@/modules/portal/components/PortalInsurance";
import { PortalTotalsCard, type TotalsRow } from "@/modules/portal/components/PortalTotalsCard";
import { PortalDashboard } from "@/modules/portal/components/PortalDashboard";
import { PortalRequests } from "@/modules/portal/components/PortalRequests";
import { PortalMeetings } from "@/modules/portal/components/PortalMeetings";
import { PortalCharter } from "@/modules/portal/components/PortalCharter";
import { PortalTasks, useTaskCounts } from "@/modules/portal/components/PortalTasks";
import { PortalVault } from "@/modules/portal/components/PortalVault";
import { PortalGeorgiaChat } from "@/modules/portal/components/PortalGeorgiaChat";
import { PortalYourTeam } from "@/modules/portal/components/PortalYourTeam";
import { PortalProfessionals } from "@/modules/portal/components/PortalProfessionals";
import { insuranceCashForStorehouses, sumValues, isAumStorehouse, formatCurrency, householdName } from "@/modules/portal/lib/portalAum";
import { MEETING_BOOKING_LINKS } from "@/shared/lib/meetingBookingLinks";
import { PortalDynamicLinks } from "@/modules/portal/components/PortalDynamicLinks";
import { PortalShoeboxUpload } from "@/modules/portal/components/PortalShoeboxUpload";
import { getPortalSession, setPortalSession, clearPortalSession } from "@/modules/portal/lib/portalSession";
import prosperwiseLogo from "@/assets/prosperwise-logo.png";
import prosperwiseIconPaper from "@/assets/prosperwise-icon-paper.png";

const CORP_TYPE_LABELS: Record<string, string> = { opco: "Operating Co", holdco: "Holding Co", trust: "Trust", partnership: "Partnership", other: "Entity" };

const ROLE_LABELS: Record<string, string> = {
  head_of_family: "Head of Family",
  head_of_household: "Head of Household",
  spouse: "Spouse",
  beneficiary: "Beneficiary",
  minor: "Minor",
};

type ViewLevel = "family" | "household" | "individual";
interface DrilldownState { level: ViewLevel; householdId?: string; memberId?: string; }

const fmt = (n: number) => formatCurrency(n || 0);

// `embedUrl` is the resolved Google Calendar appointment-schedule URL (the
// short calendar.app.google links 302 to this, but redirects drop query
// params, so ?gv=true must be appended to the resolved URL directly) —
// gv=true is Google's own embed-mode flag; without it the page sets
// X-Frame-Options: SAMEORIGIN and refuses to render in any other origin's
// iframe. Verified live for the Admin Meeting and Quarterly Review (In
// Person) schedules; the Video schedule follows the same URL pattern but
// wasn't individually tested.
// Matches the sidebar card style used everywhere else in the VFO
// (PortalTerritory's "The Vineyard"/"The Storehouses", PortalInsurance's
// "The Shield") — icon box, title + caption, big value + optional value
// caption on the right, chevron. Clickable in place of the expand/collapse
// those cards use, since these always navigate elsewhere.
function DashboardCard({
  icon: Icon,
  label,
  caption,
  value,
  valueCaption,
  colorClass = "text-accent",
  bgClass = "bg-accent/10",
  muted,
  valueSize = "lg",
  layout = "compact",
  onClick,
}: {
  icon: typeof Anchor;
  label: string;
  caption: string;
  value: string;
  valueCaption?: string;
  colorClass?: string;
  bgClass?: string;
  muted?: boolean;
  // "lg" for financial totals (the primary numbers on this page); "sm" for
  // status text like "2 New · 1 Ongoing" on Action Items/Requests,
  // which shouldn't compete visually with the dollar figures.
  valueSize?: "lg" | "sm";
  // "row" matches PortalInsurance's "The Shield" exactly (single row,
  // serif title) — only safe in the Financials tab's always-full-width
  // single column. "compact" (two rows) is what the Dashboard tab's grid
  // needs to avoid squeezing everything at narrow widths — see the
  // truncation fix above this component.
  layout?: "compact" | "row";
  onClick: () => void;
}) {
  const cardClassName = `cursor-pointer transition-colors ${
    muted ? "border-dashed border-accent/15 bg-card/50 hover:border-accent/30" : "border-accent/20 hover:border-accent/40"
  }`;

  if (layout === "row") {
    // Same look as the Family/Household financial cards (FinancialSummaryCard
    // below) — icon + label on top, big serif value, caption as a footer —
    // so the individual page's Financials tab matches those pages exactly.
    return (
      <Card
        className={`cursor-pointer transition-colors ${
          muted
            ? "border-dashed border-accent/15 bg-card/50 hover:border-accent/30"
            : "border-accent/20 bg-gradient-to-b from-accent/5 to-transparent hover:border-accent/40"
        }`}
        onClick={onClick}
      >
        <CardContent className="p-5 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon className={`h-4 w-4 ${muted ? "text-muted-foreground" : colorClass}`} />
              <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</h3>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className={`font-serif text-2xl ${muted ? "text-muted-foreground" : colorClass}`}>{value}</p>
          {caption && (
            <p className="text-[11px] text-muted-foreground leading-relaxed pt-2 border-t border-accent/10">{caption}</p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cardClassName} onClick={onClick}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${muted ? "bg-muted" : bgClass}`}>
              <Icon className={`h-4 w-4 ${muted ? "text-muted-foreground" : colorClass}`} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{label}</p>
              <p className="text-[11px] text-muted-foreground truncate">{caption}</p>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        </div>
        <div className="mt-3 flex items-baseline justify-between gap-2">
          <p className={`truncate ${valueSize === "lg" ? "text-xl font-bold" : "text-sm font-semibold"} ${muted ? "text-muted-foreground" : colorClass}`}>
            {value}
          </p>
          {valueCaption && <p className="text-[11px] text-muted-foreground shrink-0">{valueCaption}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// Same visual treatment as the original "Family AUM" aside card, reused for
// every Holding Tank/Vineyard/Storehouse breakout card on the Family and
// Household pages so they read as one consistent family — non-interactive
// (no onClick), unlike DashboardCard's clickable individual-page cards.
function FinancialSummaryCard({
  icon: Icon,
  label,
  value,
  caption,
}: {
  icon: typeof Anchor;
  label: string;
  value: string;
  caption?: string;
}) {
  return (
    <Card className="border-accent/20 bg-gradient-to-b from-accent/5 to-transparent">
      <CardContent className="p-5 space-y-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-accent" />
          <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</h3>
        </div>
        <p className="font-serif text-2xl text-accent">{value}</p>
        {caption && (
          <p className="text-[11px] text-muted-foreground leading-relaxed pt-2 border-t border-accent/10">{caption}</p>
        )}
      </CardContent>
    </Card>
  );
}

const VfoPortal = () => {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("dashboard");
  const [drilldown, setDrilldown] = useState<DrilldownState>({ level: "individual" });
  const [completedEl, setCompletedEl] = useState<HTMLElement | null>(null);
  const [expandedCorps, setExpandedCorps] = useState<Set<string>>(new Set());
  const [georgiaOpen, setGeorgiaOpen] = useState(false);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [bookMeetingOpen, setBookMeetingOpen] = useState(false);
  const [embeddedBooking, setEmbeddedBooking] = useState<{ label: string; embedUrl: string } | null>(null);
  // Set right before a "Book a Meeting" click also changes drilldown (e.g.
  // navigating from Family/Household to the viewer's own individual page),
  // so the reset effect below doesn't immediately wipe out the booking we
  // just intentionally set in the same click.
  const skipEmbedResetRef = useRef(false);

  // Reset the financials dashboard focus and any embedded booking widget
  // whenever we navigate to a different person/household, so neither
  // carries over stale state.
  useEffect(() => {
    if (skipEmbedResetRef.current) {
      skipEmbedResetRef.current = false;
    } else {
      setEmbeddedBooking(null);
    }
  }, [drilldown.level, drilldown.householdId, drilldown.memberId]);

  useEffect(() => {
    if (!token) { setError("Missing access token."); setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const stored = getPortalSession(token);
        let { data: res, error: err } = await supabase.functions.invoke("portal-validate", { body: { token: stored || token } });
        if (stored && (err || (res as any)?.error)) {
          // Stored session expired or was revoked: fall back to the link (which may itself be spent).
          clearPortalSession(token);
          ({ data: res, error: err } = await supabase.functions.invoke("portal-validate", { body: { token } }));
        }
        setPortalSession(token, (res as any)?.session_token);
        if (cancelled) return;
        if (err) throw err;
        if (!res || (res as any).error) throw new Error((res as any)?.error || "Invalid link");
        setData(res);
        // Land everyone on their own individual page first, regardless of
        // hierarchy level — a HoF/HoH can step up to Household/Family via
        // the breadcrumb or the up-level affordance, but shouldn't have to
        // click through those screens just to reach their own page.
        setDrilldown({ level: "individual", householdId: (res as any).household?.id });
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || "Unable to load your Family Office.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const refreshData = async () => {
    if (!token) return;
    try {
      const resp = await supabase.functions.invoke("portal-validate", { body: { token: getPortalSession(token) || token } });
      if (!resp.error && !resp.data?.error) setData(resp.data);
    } catch {}
  };

  // Action Items are always the logged-in user's own — never a housemate's
  // (PortalTasks is only ever rendered when isSelf) — so this uses the
  // logged-in contact specifically, not whichever page is being viewed.
  const { newCount: taskNewCount, ongoingCount: taskOngoingCount } = useTaskCounts(getPortalSession(token) || token || "", data?.contact?.id);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="max-w-md w-full border-accent/20 bg-card">
          <CardContent className="p-8 text-center space-y-3">
            <Crown className="h-8 w-8 text-accent mx-auto" />
            <h1 className="font-serif text-xl text-foreground">Family Office unavailable</h1>
            <p className="text-sm text-muted-foreground">{error || "Please contact your advisor."}</p>
            <Button variant="outline" asChild>
              <Link to="/portal">Sign in with your email</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const {
    contact, family, household, household_members = [],
    vineyard_accounts = [], storehouses = [],
    holding_tank = [], household_holding_tank = [], family_holding_tank = [],
    portal_requests = [], meetings = [], charter, corporations = [], hierarchy,
    professionals = [], engagements = [], insurance_policies = [],
  } = data;

  // Hoisted here (not just inside renderIndividualView) since the Concierge
  // card's Requests badge is now shared across all three views.
  const requestsNewCount = (portal_requests || []).filter((r: any) => r.status === "submitted").length;
  const requestsOngoingCount = (portal_requests || []).filter((r: any) => r.status === "in_progress").length;
  const requestsOpenCount = requestsNewCount + requestsOngoingCount;

  if (!family?.vfo_enabled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="max-w-md w-full border-accent/20 bg-card">
          <CardContent className="p-8 text-center space-y-3">
            <Crown className="h-8 w-8 text-accent mx-auto" />
            <h1 className="font-serif text-xl text-foreground">Not yet enrolled</h1>
            <p className="text-sm text-muted-foreground">
              The Virtual Family Office is reserved for select families. Your advisor can enable it for your household.
            </p>
            <Button variant="outline" asChild>
              <Link to={`/portal/${token}`}>Continue to your portal</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const familyName = family?.name || "Family";
  const hierarchyLevel = hierarchy?.level || "individual";
  const portalToken = getPortalSession(token) || token!;

  const currentHousehold = drilldown.householdId
    ? hierarchy?.households?.find((h: any) => h.id === drilldown.householdId)
    : null;
  const currentMember = drilldown.memberId
    ? (currentHousehold?.members || hierarchy?.members || []).find((m: any) => m.id === drilldown.memberId)
    : null;

  // ── Header AUM figure — gated by the viewer's actual role (contact.family_role),
  // not hierarchy.level: the backend gives head_of_household, spouse, and
  // beneficiary the identical level ("household"), so level alone can't tell
  // a household head apart from a regular member. Each branch also only
  // includes assets the viewer is actually entitled to see — this used to
  // sum every household's assets across every visibility scope regardless
  // of who was looking, the same privacy gap already fixed elsewhere on
  // this page.
  const viewerRole = contact?.family_role;

  // Head of Family: family_shared-scoped assets across every household —
  // identical computation to renderFamilyView's aside card, hoisted here so
  // both can share it instead of computing it twice.
  const famAllMembers = (hierarchy?.households || []).flatMap((hh: any) => hh.members || []);
  const famMemberIdSet = new Set<string>(famAllMembers.map((m: any) => m.id));
  const familySharedVineyard = famAllMembers.flatMap((m: any) =>
    (m.vineyard_accounts || []).filter((a: any) => a.visibility_scope === "family_shared")
  );
  const familySharedStore = famAllMembers.flatMap((m: any) =>
    (m.storehouses || []).filter((a: any) => a.visibility_scope === "family_shared" && isAumStorehouse(a))
  );
  const familySharedTank = (family_holding_tank || []).filter(
    (t: any) => famMemberIdSet.has(t.contact_id) && t.visibility_scope === "family_shared"
  );
  const familySharedIns = (insurance_policies || []).filter(
    (p: any) => famMemberIdSet.has(p.contact_id) && p.visibility_scope === "family_shared"
  );
  const familySharedTotal = sumValues(familySharedVineyard) + sumValues(familySharedStore)
    + sumValues(familySharedTank)
    + insuranceCashForStorehouses(familySharedIns);

  // Head of Household: their own assets in full, plus other same-household
  // members' assets that are actually marked shared with the household —
  // private stays private even from the household head. hierarchy.members
  // is the backend's list of the viewer's own household's other members
  // (self excluded) when level is "household"; it carries vineyard_accounts
  // /storehouses but not holding tank or insurance, which come from the
  // separate top-level fields filtered by contact_id below.
  const householdAllowedScopes = new Set(["household_shared", "family_shared"]);
  const otherHouseholdMembers = hierarchy?.members || [];
  const hhOtherIds = new Set(otherHouseholdMembers.map((m: any) => m.id));
  const hhVineyard = [
    ...vineyard_accounts,
    ...otherHouseholdMembers.flatMap((m: any) =>
      (m.vineyard_accounts || []).filter((a: any) => householdAllowedScopes.has(a.visibility_scope))
    ),
  ];
  const hhStore = [
    ...storehouses.filter(isAumStorehouse),
    ...otherHouseholdMembers.flatMap((m: any) =>
      (m.storehouses || []).filter((a: any) => isAumStorehouse(a) && householdAllowedScopes.has(a.visibility_scope))
    ),
  ];
  const selfTankIds = new Set((holding_tank || []).map((t: any) => t.id));
  const hhTankRaw = [
    ...(holding_tank || []),
    ...(household_holding_tank || []).filter(
      (t: any) => hhOtherIds.has(t.contact_id) && !selfTankIds.has(t.id) && householdAllowedScopes.has(t.visibility_scope)
    ),
    ...(family_holding_tank || []).filter(
      (t: any) => hhOtherIds.has(t.contact_id) && !selfTankIds.has(t.id) && householdAllowedScopes.has(t.visibility_scope)
    ),
  ];
  const hhTank = Array.from(new Map(hhTankRaw.map((t: any) => [t.id, t])).values());
  const hhIns = [
    ...(insurance_policies || []).filter((p: any) => p.contact_id === contact.id),
    ...(insurance_policies || []).filter(
      (p: any) => hhOtherIds.has(p.contact_id) && householdAllowedScopes.has(p.visibility_scope)
    ),
  ];
  const householdTotalForHoh = sumValues(hhVineyard) + sumValues(hhStore)
    + sumValues(hhTank)
    + insuranceCashForStorehouses(hhIns);

  // Everyone else (spouse, beneficiary, anyone without a head role): only
  // their own assets, every scope — it's their own data, nothing to filter.
  const selfStoreAum = storehouses.filter(isAumStorehouse);
  const selfInsurance = (insurance_policies || []).filter((p: any) => p.contact_id === contact.id);
  const individualTotal = sumValues(vineyard_accounts) + sumValues(selfStoreAum)
    + sumValues(holding_tank)
    + insuranceCashForStorehouses(selfInsurance);

  // One household's assets from this viewer's seat: their own household in full (their own records
  // plus whatever housemates share with the household), any other household only what it has shared
  // with the whole family. Private never appears.
  const HOUSEHOLD_SCOPES = new Set(["household_shared", "family_shared"]);
  const breakdownFor = (hh: { id?: string; members?: any[] }) => {
    const members = hh.members || [];
    const own = (!!hh.id && hh.id === contact.household_id) || members.some((m: any) => m.id === contact.id);
    const allowed = own ? HOUSEHOLD_SCOPES : new Set(["family_shared"]);
    const others = members.filter((m: any) => m.id !== contact.id);
    const otherIds = new Set(others.map((m: any) => m.id));
    const vineyard = [
      ...(own ? vineyard_accounts : []),
      ...others.flatMap((m: any) => (m.vineyard_accounts || []).filter((a: any) => allowed.has(a.visibility_scope))),
    ];
    const store = [
      ...(own ? storehouses.filter(isAumStorehouse) : []),
      ...others.flatMap((m: any) => (m.storehouses || []).filter((a: any) => isAumStorehouse(a) && allowed.has(a.visibility_scope))),
    ];
    const tankRaw = [
      ...(own ? (holding_tank || []) : []),
      ...(household_holding_tank || []).filter((t: any) => otherIds.has(t.contact_id) && allowed.has(t.visibility_scope)),
      ...(family_holding_tank || []).filter((t: any) => otherIds.has(t.contact_id) && allowed.has(t.visibility_scope)),
    ];
    const tank = Array.from(new Map(tankRaw.map((t: any) => [t.id, t])).values());
    const ins = [
      ...(own ? (insurance_policies || []).filter((p: any) => p.contact_id === contact.id) : []),
      ...(insurance_policies || []).filter((p: any) => otherIds.has(p.contact_id) && allowed.has(p.visibility_scope)),
    ];
    const total = sumValues(vineyard) + sumValues(store) + sumValues(tank) + insuranceCashForStorehouses(ins);
    return { own, vineyard, store, tank, ins, total };
  };
  const totalsRowsFor = (parts: { vineyard: any[]; store: any[]; tank: any[]; ins: any[] }): TotalsRow[] => [
    { label: "Holding Tank", total: sumValues(parts.tank), items: parts.tank.map((a: any) => ({ id: a.id, name: a.account_name, value: Number(a.current_value) || 0 })) },
    { label: "Vineyard", total: sumValues(parts.vineyard), items: parts.vineyard.map((a: any) => ({ id: a.id, name: a.account_name, value: Number(a.current_value) || 0 })) },
    { label: "Storehouses", total: sumValues(parts.store) + insuranceCashForStorehouses(parts.ins), items: parts.store.map((a: any) => ({ id: a.id, name: a.label || a.asset_type || a.notes || "Account", value: Number(a.current_value) || 0 })) },
  ].filter((r) => r.items.length > 0 || r.label !== "Holding Tank");
  const familyHouseholds: any[] = hierarchy?.households || [];

  const headerAumLabel =
    viewerRole === "head_of_family" ? (famAllMembers.length > 1 ? "Total Family AUM" : "Total AUM")
    : viewerRole === "head_of_household" ? "Total Household AUM"
    : "Your Total AUM";
  // Head of Family: their own holdings in full (it's their data) plus what other
  // members have shared with the whole family — never other members' private or
  // household-only assets. familySharedTotal alone omitted the viewer's own
  // non-family-shared accounts and so understated their wealth.
  const notSelf = (r: any) => r.id !== contact.id && r.contact_id !== contact.id;
  const hofTotal = individualTotal
    + sumValues(famAllMembers.filter(notSelf).flatMap((m: any) => (m.vineyard_accounts || []).filter((a: any) => a.visibility_scope === "family_shared")))
    + sumValues(famAllMembers.filter(notSelf).flatMap((m: any) => (m.storehouses || []).filter((a: any) => a.visibility_scope === "family_shared" && isAumStorehouse(a))))
    + sumValues(familySharedTank.filter(notSelf))
    + insuranceCashForStorehouses(familySharedIns.filter(notSelf));
  // The header figure for a head of family is the sum of what each household card shows.
  const hofTotalByHousehold = familyHouseholds.length > 0
    ? familyHouseholds.reduce((n: number, hh: any) => n + breakdownFor(hh).total, 0)
    : hofTotal;
  const totalAum =
    viewerRole === "head_of_family" ? hofTotalByHousehold
    : viewerRole === "head_of_household" ? householdTotalForHoh
    : individualTotal;

  const householdCount = hierarchy?.households?.length ?? (household ? 1 : 0);
  const memberCount = hierarchy?.households
    ? hierarchy.households.reduce((s: number, hh: any) => s + (hh.members?.length || 0), 0)
    : household_members.length + 1;
  // One person, one household: the family/household levels add nothing to look at.
  const isSolo = householdCount <= 1 && memberCount <= 1;

  // Backend hof_visible gating only decides which households reach the
  // client at all — it says nothing about which assets within a visible
  // household this viewer may see. This helper is scope-agnostic by design;
  // callers must filter the returned arrays by visibility_scope themselves
  // before summing or rendering, same as /portal's Portal.tsx.
  const aggregateAssetsAtLevel = (level: "family" | "household", householdId?: string) => {
    const v: any[] = [], s: any[] = [];
    if (level === "family") {
      (hierarchy?.households || []).forEach((hh: any) => {
        (hh.members || []).forEach((m: any) => {
          (m.vineyard_accounts || []).forEach((a: any) => v.push(a));
          (m.storehouses || []).filter((a: any) => a.asset_type !== 'Primary Residence & Protected Legacy Accounts').forEach((a: any) => s.push(a));
        });
      });
    } else {
      const members = householdId
        ? (hierarchy?.households?.find((h: any) => h.id === householdId)?.members || [])
        : (hierarchy?.members || []);
      const selfInMembers = members.some((m: any) => m.id === contact.id);
      if (!selfInMembers) {
        vineyard_accounts.forEach((a: any) => v.push(a));
        storehouses.filter((a: any) => a.asset_type !== 'Primary Residence & Protected Legacy Accounts').forEach((a: any) => s.push(a));
      }
      members.forEach((m: any) => {
        (m.vineyard_accounts || []).forEach((a: any) => v.push(a));
        (m.storehouses || []).filter((a: any) => a.asset_type !== 'Primary Residence & Protected Legacy Accounts').forEach((a: any) => s.push(a));
      });
    }
    return { vineyard: v, storehouses: s };
  };



  // ── Header subtitle ──
  const subtitle = (() => {
    if (drilldown.level === "family") return "Family Overview";
    if (drilldown.level === "household") {
      const label = currentHousehold?.label || household?.label || "";
      return householdName(label);
    }
    const m = currentMember || contact;
    const name = `${m.first_name || ""} ${m.last_name || ""}`.trim();
    return `${name}${m.family_role ? ` · ${ROLE_LABELS[m.family_role] || m.family_role}` : ""}`;
  })();

  // ── Breadcrumb ──
  const renderBreadcrumb = () => {
    const crumbs: Array<{ label: string; onClick?: () => void }> = [];
    if (hierarchyLevel === "family") {
      crumbs.push({
        label: familyName,
        onClick: drilldown.level !== "family" ? () => setDrilldown({ level: "family" }) : undefined,
      });
    }
    if (drilldown.level === "household" || drilldown.level === "individual") {
      const label = currentHousehold?.label || household?.label;
      if (label) {
        crumbs.push({
          label: householdName(label),
          onClick: drilldown.level === "individual"
            ? () => setDrilldown({ level: "household", householdId: drilldown.householdId || household?.id })
            : undefined,
        });
      }
    }
    if (drilldown.level === "individual") {
      const m = currentMember || contact;
      crumbs.push({ label: `${m.first_name || ""} ${m.last_name || ""}`.trim() });
    }
    if (crumbs.length <= 1 || isSolo) return null;
    return (
      <nav aria-label="breadcrumb" className="mb-5 flex items-center gap-2 text-xs">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <div key={i} className="flex items-center gap-2">
              {i > 0 && <ChevronRight className="h-3 w-3 text-accent/40" />}
              {last || !c.onClick ? (
                <span className="text-foreground font-medium tracking-wide">{c.label}</span>
              ) : (
                <button
                  onClick={c.onClick}
                  className="text-muted-foreground hover:text-accent transition-colors uppercase tracking-wider"
                >
                  {c.label}
                </button>
              )}
            </div>
          );
        })}
      </nav>
    );
  };

  // ── Concierge card — shared across Family, Household, and Individual
  // views. Every action here operates on the viewer themselves (Georgia,
  // Requests, Shoebox, booking a meeting) regardless of which page is
  // currently being browsed, so it's safe to show from any view level.
  const renderConciergeCard = () => (
    <Card className="border-accent/20 bg-gradient-to-b from-accent/5 to-transparent">
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-accent" />
          <h3 className="font-serif text-sm text-foreground">Your Concierge</h3>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Chat with Georgia for instant help, or open a private request for your advisory team.
        </p>
        <Button
          className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
          onClick={() => setGeorgiaOpen(true)}
        >
          <MessageCircle className="h-4 w-4 mr-2" />
          Ask Georgia
        </Button>
        <Button
          variant="ghost"
          className="w-full justify-between px-2 text-foreground hover:bg-accent/10 [&_svg]:text-accent"
          onClick={() => setRequestsOpen(true)}
        >
          <span className="flex items-center">
            <ClipboardList className="h-4 w-4 mr-2" />
            Requests
          </span>
          {requestsOpenCount > 0 && (
            <Badge variant="secondary" className="bg-accent/15 text-accent border-accent/30">{requestsOpenCount} open</Badge>
          )}
        </Button>
        <Button
          variant="ghost"
          className="w-full justify-between px-2 text-foreground hover:bg-accent/10 [&_svg]:text-accent"
          onClick={() => setBookMeetingOpen((o) => !o)}
        >
          <span className="flex items-center">
            <Calendar className="h-4 w-4 mr-2" />
            Book a Meeting
          </span>
          {bookMeetingOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </Button>
        {bookMeetingOpen && (
          <div className="space-y-1.5 pl-1">
            {(((data as any)?.meeting_types as typeof MEETING_BOOKING_LINKS | undefined) ?? MEETING_BOOKING_LINKS).map((link) => (
              <button
                key={link.url}
                onClick={() => {
                  setEmbeddedBooking(link);
                  setBookMeetingOpen(false);
                  // Booking always concerns the viewer's own meetings, so
                  // jump to their own individual page's Meetings tab even
                  // if this was clicked from the Family or Household view.
                  skipEmbedResetRef.current = true;
                  setDrilldown({ level: "individual", householdId: household?.id });
                  setTab("meetings");
                }}
                className="w-full flex items-center justify-between rounded-md border border-accent/15 bg-card px-3 py-2 text-xs text-foreground hover:border-accent/40 hover:bg-accent/[0.03] transition-colors text-left"
              >
                {link.label}
                <ArrowRight className="h-3.5 w-3.5 text-accent" />
              </button>
            ))}
          </div>
        )}
        <PortalShoeboxUpload portalToken={portalToken} householdId={household?.id} />
      </CardContent>
    </Card>
  );

  // ── Family View ──
  const renderFamilyView = () => {
    const households = familyHouseholds;
    const parts = households.map((hh: any) => breakdownFor(hh));
    const merged = {
      vineyard: parts.flatMap((p) => p.vineyard),
      store: parts.flatMap((p) => p.store),
      tank: parts.flatMap((p) => p.tank),
      ins: parts.flatMap((p) => p.ins),
    };
    const sortRole = (a: any, b: any) => {
      const order: Record<string, number> = { head_of_family: 0, head_of_household: 1, spouse: 2, beneficiary: 3, minor: 4 };
      return (order[a.family_role] ?? 4) - (order[b.family_role] ?? 4);
    };

    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardContent className="p-0 divide-y divide-border">
              <div className="flex items-center gap-2 px-4 py-3">
                <Crown className="h-4 w-4 text-accent" />
                <h2 className="font-serif text-sm font-semibold text-foreground">{familyName} Family</h2>
                <span className="ml-auto text-xs text-muted-foreground">
                  {households.length} household{households.length !== 1 ? "s" : ""} · {memberCount} members
                </span>
              </div>
              {households.map((hh: any, i: number) => {
                const p = parts[i];
                const members = [...(hh.members || [])].sort(sortRole);
                return (
                  <button
                    key={hh.id}
                    onClick={() => setDrilldown({ level: "household", householdId: hh.id })}
                    className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                  >
                    <Home className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {householdName(hh.label)}{p.own ? <span className="ml-1.5 text-xs font-normal text-accent">Yours</span> : null}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{members.map((m: any) => m.first_name).join(", ")}</p>
                    </div>
                    {p.total > 0 ? (
                      <span className="font-serif text-sm font-semibold tabular-nums text-foreground">{fmt(p.total)}</span>
                    ) : (
                      <span className="text-xs italic text-muted-foreground">Private</span>
                    )}
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <aside className="min-w-0 space-y-4">
          <PortalTotalsCard title="Family Totals" rows={totalsRowsFor(merged)} />
          {renderConciergeCard()}
          <PortalYourTeam professionals={professionals} engagements={engagements} />
        </aside>
      </div>
    );
  };

  // ── Household View ──
  const renderHouseholdView = () => {
    const hhRecord = currentHousehold
      || (household?.id ? { id: household.id, label: household.label, members: hierarchy?.members || [] } : { members: hierarchy?.members || [] });
    const members: any[] = hhRecord.members || [];
    const hhLabel = hhRecord.label || household?.label || "Household";
    const bd = breakdownFor(hhRecord);
    // hierarchy.members lists the OTHER members of the viewer's own household, so "is the viewer in
    // the list" is not enough to know whose household this is.
    const viewingOwnHousehold = bd.own || !drilldown.householdId;
    const allowedScopes = viewingOwnHousehold ? HOUSEHOLD_SCOPES : new Set(["family_shared"]);
    const sortRole = (a: any, b: any) => {
      const order: Record<string, number> = { head_of_family: 0, head_of_household: 1, spouse: 2, beneficiary: 3, minor: 4 };
      return (order[a.family_role] ?? 4) - (order[b.family_role] ?? 4);
    };
    const orderedMembers = (!viewingOwnHousehold
      ? members.map((m: any) => ({ ...m, _isSelf: false }))
      : [
          { ...contact, _isSelf: true },
          ...members.filter((m: any) => m.id !== contact.id).map((m: any) => ({ ...m, _isSelf: false })),
        ]
    ).sort(sortRole);

    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardContent className="p-0 divide-y divide-border">
              <div className="flex items-center gap-2 px-4 py-3">
                <Home className="h-4 w-4 text-accent" />
                <h2 className="font-serif text-sm font-semibold text-foreground">{householdName(hhLabel)}</h2>
                <span className="ml-auto text-xs text-muted-foreground">
                  {orderedMembers.length} member{orderedMembers.length !== 1 ? "s" : ""}
                </span>
              </div>
              {orderedMembers.map((m: any) => {
                const isSelf = m._isSelf;
                const canDrill = isSelf || viewingOwnHousehold;
                const mVineyard = (isSelf ? vineyard_accounts : (m.vineyard_accounts || [])).filter((a: any) => allowedScopes.has(a.visibility_scope));
                const mStoreAum = (isSelf ? storehouses : (m.storehouses || [])).filter(isAumStorehouse).filter((a: any) => allowedScopes.has(a.visibility_scope));
                const mTankRaw = ((isSelf ? (holding_tank || []) : []) as any[])
                  .concat((household_holding_tank || []).filter((t: any) => t.contact_id === m.id))
                  .concat((family_holding_tank || []).filter((t: any) => t.contact_id === m.id));
                const mTank = Array.from(new Map(mTankRaw.map((t: any) => [t.id, t])).values())
                  .filter((t: any) => allowedScopes.has(t.visibility_scope));
                const mInsurance = (insurance_policies || []).filter((p: any) => p.contact_id === m.id && allowedScopes.has(p.visibility_scope));
                const mTotal = sumValues(mVineyard) + sumValues(mStoreAum) + sumValues(mTank) + insuranceCashForStorehouses(mInsurance);
                return (
                  <button
                    key={m.id}
                    disabled={!canDrill}
                    onClick={() => {
                      if (!canDrill) return;
                      setDrilldown({ level: "individual", householdId: drilldown.householdId || household?.id, memberId: isSelf ? undefined : m.id });
                      setTab("dashboard");
                    }}
                    className={`group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${canDrill ? "hover:bg-muted/40" : "cursor-default"}`}
                  >
                    {isSelf ? <img src={prosperwiseLogo} alt="" className="h-4 w-4 shrink-0" /> : <Users className="h-4 w-4 shrink-0 text-muted-foreground" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{m.first_name} {m.last_name || ""}</p>
                      <p className="text-xs text-muted-foreground">{ROLE_LABELS[m.family_role] || m.family_role}{isSelf ? " · You" : ""}</p>
                    </div>
                    <span className="font-serif text-sm font-semibold tabular-nums text-foreground">{fmt(mTotal)}</span>
                    {canDrill && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  </button>
                );
              })}
            </CardContent>
          </Card>

          {/* `corporations` is always the viewer's own shareholdings (portal-validate scopes it to the
              viewer's own household, not the household being viewed), so only show it on that page. */}
          {viewingOwnHousehold && corporations.length > 0 && (
            <Card>
              <CardContent className="p-0 divide-y divide-border">
                <div className="flex items-center gap-2 px-4 py-3">
                  <Building2 className="h-4 w-4 text-accent" />
                  <h2 className="font-serif text-sm font-semibold text-foreground">Corporate Entities</h2>
                </div>
                {corporations.map((corp: any) => {
                  const isExpanded = expandedCorps.has(corp.id);
                  return (
                    <div key={corp.id}>
                      <button
                        onClick={() => setExpandedCorps((prev) => { const n = new Set(prev); n.has(corp.id) ? n.delete(corp.id) : n.add(corp.id); return n; })}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                      >
                        <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">{corp.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {CORP_TYPE_LABELS[corp.corporation_type] || corp.corporation_type}
                            {corp.jurisdiction ? ` · ${corp.jurisdiction}` : ""}
                          </p>
                        </div>
                        <span className="font-serif text-sm font-semibold tabular-nums text-foreground">{fmt(corp.total_assets || 0)}</span>
                        {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                      </button>
                      {isExpanded && (corp.vineyard_accounts || []).length > 0 && (
                        <div className="pb-2">
                          {corp.vineyard_accounts.map((acc: any) => (
                            <div key={acc.id} className="flex items-center justify-between pl-11 pr-4 py-1.5">
                              <span className="text-xs text-muted-foreground">{acc.account_name}</span>
                              <span className="text-xs tabular-nums text-foreground">{fmt(Number(acc.current_value) || 0)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>

        <aside className="min-w-0 space-y-4">
          <PortalTotalsCard title="Household Totals" rows={totalsRowsFor(bd)} />
          {renderConciergeCard()}
          <PortalYourTeam professionals={professionals} engagements={engagements} />
        </aside>
      </div>
    );
  };

  // ── Individual View ──
  const renderIndividualView = () => {
    const isSelf = !currentMember;
    // Reachable for another member only via the household view's drill-down,
    // which is gated to the viewer's own household (canDrill). That makes
    // them a housemate, not a stranger — but private-scoped assets are still
    // private from housemates too, so filter the same as everywhere else.
    const allowedScopes = new Set(["household_shared", "family_shared"]);
    let indVineyard: any[] = [];
    let indStorehouses: any[] = [];
    let indInsurance: any[] = [];
    let indName = "";
    if (isSelf) {
      indVineyard = vineyard_accounts;
      indStorehouses = storehouses;
      indInsurance = (insurance_policies || []).filter((p: any) => p.contact_id === contact.id);
      indName = `${contact.first_name || ""} ${contact.last_name || ""}`.trim();
    } else {
      indVineyard = (currentMember.vineyard_accounts || []).filter((a: any) => allowedScopes.has(a.visibility_scope));
      indStorehouses = (currentMember.storehouses || []).filter((a: any) => allowedScopes.has(a.visibility_scope));
      indInsurance = (insurance_policies || []).filter(
        (p: any) => p.contact_id === currentMember.id && allowedScopes.has(p.visibility_scope)
      );
      indName = `${currentMember.first_name || ""} ${currentMember.last_name || ""}`.trim();
    }

    const ind = { vineyardAccounts: indVineyard, memberStorehouses: indStorehouses, insurancePolicies: indInsurance, name: indName };
    const hasHolding = isSelf && holding_tank.length > 0;
    const hasTerritory = (ind.vineyardAccounts.length + ind.memberStorehouses.length) > 0;
    const hasInsurance = ind.insurancePolicies.length > 0;
    const hasFinancials = hasHolding || hasTerritory || hasInsurance;

    const indVineyardAccounts = ind.vineyardAccounts;
    const indAumStorehouses = ind.memberStorehouses.filter(isAumStorehouse);
    const holdingTankTotal = sumValues(holding_tank);
    const vineyardTotal = sumValues(indVineyardAccounts);
    const storehousesTotal = sumValues(indAumStorehouses)
      + insuranceCashForStorehouses(ind.insurancePolicies);
    const hasVineyard = indVineyardAccounts.length > 0;
    const hasStorehouses = indAumStorehouses.length > 0 || storehousesTotal > 0;


    // The viewer's own balance sheet for the dashboard: what they hold, less what they owe.
    const dashTotals = (() => {
      if (!isSelf || (!hasTerritory && !holding_tank.length)) return null;
      const sum = (rows: any[]) => rows.reduce((a, r) => a + (Number(r.current_value) || 0), 0);
      const cash = (ind.insurancePolicies || []).filter((p: any) => !p.cash_value_storehouse_id && p.cv_in_strategic !== false).reduce((a: number, p: any) => a + (Number(p.cash_value) || 0), 0);
      return { assets: sum(ind.vineyardAccounts) + sum(ind.memberStorehouses) + sum(holding_tank) + cash, liabilities: Number(data.liabilities_total) || 0 };
    })();
    const effectiveTab = (!hasFinancials && tab === "financials") || (!isSelf && tab === "dashboard") ? "tasks" : tab;
    const meetingTypes = (((data as any)?.meeting_types as { label: string; url: string; embedUrl: string }[] | undefined) ?? []);
    const charterUrl = charter?.draft_status === "ratified" ? (contact.charter_url || family?.charter_document_url) : null;
    const fullName = `${contact.first_name || ""} ${contact.last_name || ""}`.trim();

    const dashboardSidebar = (
      <>
        {charterUrl ? <PortalCharter charterUrl={charterUrl} /> : null}
        {renderConciergeCard()}
        <PortalYourTeam professionals={professionals} engagements={engagements} onSelect={professionals.length > 0 ? () => setTab("team") : undefined} />
      </>
    );

    // Financials sidebar: totals by category; each row opens to its accounts and balances.
    const totalsCard = (
      <PortalTotalsCard
        title="Totals"
        rows={totalsRowsFor({ vineyard: indVineyardAccounts, store: indAumStorehouses, tank: isSelf ? (holding_tank || []) : [], ins: ind.insurancePolicies })}
      />
    );

    const tabTrigger = "flex-1 gap-1.5 data-[state=active]:bg-accent/10 data-[state=active]:text-accent";
    const sidebarTabs = isSelf && (effectiveTab === "tasks" || effectiveTab === "meetings" || effectiveTab === "financials" || effectiveTab === "vault");

    return (
      <Tabs value={effectiveTab} onValueChange={setTab} className="w-full space-y-4">
        <TabsList className="w-full bg-muted/30 border border-accent/15 flex-wrap h-auto">
          {isSelf && (
            <TabsTrigger value="dashboard" className={tabTrigger}><Home className="h-4 w-4" />Dashboard</TabsTrigger>
          )}
          <TabsTrigger value="tasks" className={tabTrigger}><CheckSquare className="h-4 w-4" />Action Items</TabsTrigger>
          <TabsTrigger value="meetings" className={tabTrigger}><Calendar className="h-4 w-4" />Meetings</TabsTrigger>
          {hasFinancials && (
            <TabsTrigger value="financials" className={tabTrigger}><Landmark className="h-4 w-4" />Financials</TabsTrigger>
          )}
          {isSelf && (
            <TabsTrigger value="vault" className={tabTrigger}><FolderLock className="h-4 w-4" />Documents</TabsTrigger>
          )}
          {professionals.length > 0 && (
            <TabsTrigger value="team" className={tabTrigger}><Briefcase className="h-4 w-4" />Professionals</TabsTrigger>
          )}
        </TabsList>

        <div className={sidebarTabs ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]" : "grid gap-6"}>
          <div className="min-w-0 space-y-4">
            {isSelf && (
              <TabsContent value="dashboard" className="mt-0">
                <PortalDashboard
                  totals={dashTotals}
                  meetings={meetings}
                  taskCounts={{ newCount: taskNewCount, ongoingCount: taskOngoingCount }}
                  onGo={setTab}
                  sidebar={dashboardSidebar}
                  links={<PortalDynamicLinks layout="grid" />}
                />
              </TabsContent>
            )}

            <TabsContent value="tasks" className="mt-0">
              {isSelf ? (
                <PortalTasks portalToken={portalToken} clientName={ind.name} contactId={contact.id} completedTarget={completedEl} />
              ) : (
                <div className="rounded-lg border border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
                  Task view is only available on your own profile.
                </div>
              )}
            </TabsContent>

            <TabsContent value="meetings" className="mt-0">
              {isSelf && embeddedBooking ? (
                <div className="space-y-3">
                  <button onClick={() => setEmbeddedBooking(null)} className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-accent">
                    <ChevronLeft className="h-3.5 w-3.5" />
                    Back to Meetings
                  </button>
                  <div className="overflow-hidden rounded-lg border border-border bg-card">
                    <div className="border-b border-border px-4 py-2.5 font-serif text-sm text-foreground">{embeddedBooking.label}</div>
                    <iframe src={embeddedBooking.embedUrl} style={{ border: 0 }} width="100%" height={700} title={embeddedBooking.label} />
                  </div>
                </div>
              ) : isSelf ? (
                <PortalMeetings meetings={meetings} />
              ) : (
                <div className="rounded-lg border border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
                  Meeting schedule is only visible on your own view.
                </div>
              )}
            </TabsContent>

            {hasFinancials && (
              <TabsContent value="financials" className="mt-0 space-y-6">
                {hasHolding && <PortalHoldingTank accounts={holding_tank} />}
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
                    onScopeChange={refreshData}
                    corporations={corporations}
                    section="all"
                    defaultCollapsed
                  />
                )}
                {hasInsurance && <PortalInsurance policies={ind.insurancePolicies} defaultCollapsed />}
              </TabsContent>
            )}

            {isSelf && (
              <TabsContent value="vault" className="mt-0">
                <PortalVault portalToken={portalToken} householdId={household?.id} />
              </TabsContent>
            )}

            {professionals.length > 0 && (
              <TabsContent value="team" className="mt-0">
                <PortalProfessionals professionals={professionals} engagements={engagements} />
              </TabsContent>
            )}
          </div>

          {/* Sidebar (Action Items): what is finished */}
          {effectiveTab === "tasks" && isSelf && (
            <div className="min-w-0 space-y-4">
              <div ref={setCompletedEl} />
              {(portal_requests || []).some((r: any) => r.status === "resolved") && (
                <Card>
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-center gap-2">
                      <ClipboardList className="h-4 w-4 text-accent" />
                      <h3 className="font-serif text-sm font-semibold text-foreground">Completed requests</h3>
                    </div>
                    <PortalRequests show="resolved" requests={portal_requests || []} contactId={contact.id} contactName={fullName} portalToken={portalToken} onUpdate={refreshData} />
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Sidebar (Meetings): book a meeting, from the types marked for clients */}
          {effectiveTab === "meetings" && isSelf && meetingTypes.length > 0 && (
            <div className="min-w-0 space-y-4">
              <Card>
                <CardContent className="space-y-1 p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-accent" />
                    <h3 className="font-serif text-sm font-semibold text-foreground">Book a meeting</h3>
                  </div>
                  {meetingTypes.map((m) => (
                    <button
                      key={m.url}
                      onClick={() => (m.embedUrl && m.embedUrl !== m.url ? setEmbeddedBooking({ label: m.label, embedUrl: m.embedUrl }) : window.open(m.url, "_blank", "noopener,noreferrer"))}
                      className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted/50"
                    >
                      {m.label}
                      <ArrowRight className="h-3.5 w-3.5 text-accent" />
                    </button>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Sidebar (Financials): My Accounts, always open */}
          {effectiveTab === "financials" && isSelf && (
            <div className="min-w-0 space-y-4">
              {totalsCard}
              <PortalDynamicLinks groupsOnly alwaysOpen />
            </div>
          )}

          {/* Sidebar (Documents): send a document to the Shoebox */}
          {effectiveTab === "vault" && isSelf && (
            <div className="min-w-0 space-y-4">
              <Card>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-center gap-2">
                    <FolderLock className="h-4 w-4 text-accent" />
                    <h3 className="font-serif text-sm font-semibold text-foreground">Send a document</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Statements, tax slips, anything your Personal CFO should have. Files go to your Shoebox and are filed for you.
                  </p>
                  <PortalShoeboxUpload portalToken={portalToken} householdId={household?.id} />
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </Tabs>
    );
  };

  const renderContent = () => {
    if (drilldown.level === "family" && hierarchyLevel === "family") return renderFamilyView();
    if (drilldown.level === "household") return renderHouseholdView();
    return renderIndividualView();
  };

  // ── Up-level back affordance ──
  const upLevel = () => {
    if (drilldown.level === "individual" && (drilldown.householdId || household)) {
      setDrilldown({ level: "household", householdId: drilldown.householdId || household?.id });
    } else if (drilldown.level === "household" && hierarchyLevel === "family") {
      setDrilldown({ level: "family" });
    }
  };
  const canUp = !isSolo && (
    (drilldown.level === "individual" && (drilldown.householdId || household)) ||
    (drilldown.level === "household" && hierarchyLevel === "family"));

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Premium Header */}
      <header className="border-b border-primary-foreground/10 bg-primary">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="flex items-center gap-4 min-w-0">
              <img src={prosperwiseIconPaper} alt="" className="h-10 w-10 opacity-90" />
              <div className="min-w-0">
                <h1 className="font-serif text-3xl md:text-4xl text-primary-foreground leading-tight truncate">
                  {familyName} Family Office
                </h1>
                <p className="text-sm text-primary-foreground/70 mt-1">{subtitle}</p>
              </div>
            </div>
            <div className="flex items-center gap-6 border-l border-primary-foreground/15 pl-6">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-primary-foreground/60">{headerAumLabel}</p>
                <p className="font-serif text-2xl text-primary-foreground">{fmt(totalAum)}</p>
              </div>
              {viewerRole === "head_of_family" && !isSolo && (
                <>
                  <div className="hidden sm:block">
                    <p className="text-[10px] uppercase tracking-wider text-primary-foreground/60">Households</p>
                    <p className="font-serif text-2xl text-primary-foreground">{householdCount}</p>
                  </div>
                  <div className="hidden md:block">
                    <p className="text-[10px] uppercase tracking-wider text-primary-foreground/60">Members</p>
                    <p className="font-serif text-2xl text-primary-foreground">{memberCount}</p>
                  </div>
                </>
              )}
              {viewerRole === "head_of_household" && (
                <div className="hidden sm:block">
                  <p className="text-[10px] uppercase tracking-wider text-primary-foreground/60">Members</p>
                  <p className="font-serif text-2xl text-primary-foreground">{otherHouseholdMembers.length + 1}</p>
                </div>
              )}
            </div>
          </div>
          <div className="mt-6 h-px bg-gradient-to-r from-transparent via-primary-foreground/30 to-transparent" />
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between gap-4 mb-1">
          {renderBreadcrumb()}
          {canUp && (
            <button
              onClick={upLevel}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-accent transition-colors mb-5"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Back
            </button>
          )}
        </div>
        {renderContent()}

        <div className="text-center text-[10px] uppercase tracking-[0.25em] text-muted-foreground/60 pt-12 pb-2">
          ProsperWise · Private Family Office
        </div>
        <div className="text-center pb-4">
          <Link
            to="/portal/privacy"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
          >
            Privacy & Security Policy
          </Link>
        </div>
      </main>

      <PortalGeorgiaChat
        open={georgiaOpen}
        onOpenChange={setGeorgiaOpen}
        contactName={`${contact?.first_name || ""} ${contact?.last_name || ""}`.trim()}
        contactId={contact?.id}
        portalToken={portalToken}
        onRequestSubmitted={refreshData}
      />

      <Dialog open={requestsOpen} onOpenChange={setRequestsOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-accent" />
              Your Requests
            </DialogTitle>
          </DialogHeader>
          <PortalRequests
            requests={portal_requests}
            contactId={contact.id}
            contactName={`${contact.first_name || ""} ${contact.last_name || ""}`.trim()}
            portalToken={portalToken}
            onUpdate={refreshData}
          />
        </DialogContent>
      </Dialog>
    </div>

  );
};

export default VfoPortal;
