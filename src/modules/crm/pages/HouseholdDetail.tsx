import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { supabase } from "@/shared/integrations/supabase/client";
import { AppLayout } from "@/shared/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Switch } from "@/shared/components/ui/switch";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/shared/components/ui/dropdown-menu";
import { toast } from "sonner";
import { PageBreadcrumbs } from "@/shared/components/PageBreadcrumbs";
import { policyTypeLabel } from "@/shared/lib/insurance";
import { CollapsibleCard } from "@/shared/components/CollapsibleCard";
import { Progress } from "@/shared/components/ui/progress";
import { HouseholdTaskRollup } from "@/modules/crm/components/HouseholdTaskRollup";
import { HouseholdRequestsRollup } from "@/modules/crm/components/HouseholdRequestsRollup";
import { HouseholdStatementIngestion } from "@/modules/crm/components/HouseholdStatementIngestion";
import { HoldingTank } from "@/modules/crm/components/HoldingTank";
import { VaultView } from "@/modules/crm/pages/Vault";
import { CharterRatificationTile, StabilizationMapButton, GovernanceAuditButton, HouseholdAuditTrailRollup } from "@/modules/audit";
import { ProsPanel } from "@/modules/crm/components/ProsPanel";
import { AddCompanyDialog } from "@/modules/crm/components/AddCompanyDialog";
import {
  Home,
  User,
  Crown,
  Shield,
  Baby,
  Loader2,
  Grape,
  Landmark,
  Castle,
  Sword,
  Wheat,
  Lock,
  ArrowLeft,
  MapPin,
  Building2,
  BarChart3,
  ChevronDown,
  ShieldCheck,
  ExternalLink,
  ListChecks,
  Users,
  Anchor,
  Briefcase,
  CalendarOff,
  RotateCcw,
  UserCheck,
  ScanSearch,
  TrendingDown,
  HeartHandshake,
  Wallet,
} from "lucide-react";
import { ContactAnalytics } from "@/modules/crm/components/ContactAnalytics";

const ROLE_ICONS: Record<string, typeof Crown> = {
  head_of_family: Crown,
  head_of_household: Home,
  spouse: Shield,
  beneficiary: User,
  minor: Baby,
};

const ROLE_LABELS: Record<string, string> = {
  head_of_family: "Head of Family",
  head_of_household: "Head of Household",
  spouse: "Spouse",
  beneficiary: "Beneficiary",
  minor: "Minor",
};

const STOREHOUSE_CONFIG = [
  { num: 1, name: "Liquidity Reserve", icon: Castle },
  { num: 2, name: "Strategic Reserve", icon: Sword },
  { num: 3, name: "Philanthropic Trust", icon: Wheat },
  { num: 4, name: "Legacy Trust", icon: Lock },
];

const TYPE_LABELS: Record<string, string> = {
  opco: "OpCo",
  holdco: "HoldCo",
  trust: "Trust",
  partnership: "Partnership",
  other: "Entity",
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

const HouseholdDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [household, setHousehold] = useState<any>(null);
  const [familyName, setFamilyName] = useState("");
  const [members, setMembers] = useState<any[]>([]);
  const [vineyardAccounts, setVineyardAccounts] = useState<any[]>([]);
  const [storehouses, setStorehouses] = useState<any[]>([]);
  const [corporations, setCorporations] = useState<any[]>([]);
  const [holdingTank, setHoldingTank] = useState<any[]>([]);
  const [liabilities, setLiabilities] = useState<any[]>([]);
  const [insurancePolicies, setInsurancePolicies] = useState<any[]>([]);
  const [endRelationshipOpen, setEndRelationshipOpen] = useState(false);
  const [endReason, setEndReason] = useState("");
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reopenRelationshipOpen, setReopenRelationshipOpen] = useState(false);
  const [vaultScanning, setVaultScanning] = useState(false);

  // Guard against setState after unmount when fetchData reruns via mutation callbacks.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchData = useCallback(async () => {
    if (!id) return;

    const { data: hh } = await supabase
      .from("households")
      .select("*")
      .eq("id", id)
      .single();

    if (!mountedRef.current) return;
    if (!hh) {
      setLoading(false);
      return;
    }

    setHousehold(hh);

    const [
      { data: family },
      { data: contacts },
    ] = await Promise.all([
      supabase.from("families").select("name").eq("id", hh.family_id).single(),
      supabase.from("contacts").select("id, first_name, last_name, family_role, email, phone, address, is_minor, asana_url, lawyer_name, lawyer_firm, accountant_name, accountant_firm, executor_name, executor_firm, poa_name, poa_firm").eq("household_id", id),
    ]);
    if (!mountedRef.current) return;

    setFamilyName(family?.name || "Unknown");
    const roleRank = (r: string | null | undefined) => {
      const v = (r || "").toLowerCase();
      if (v === "hof" || v === "head_of_family" || v.includes("head of family")) return 0;
      if (v === "hoh" || v === "head_of_household" || v.includes("head of household")) return 1;
      return 2;
    };
    const sorted = [...(contacts || [])].sort((a: any, b: any) => roleRank(a.family_role) - roleRank(b.family_role));
    setMembers(sorted);

    const memberIds = (contacts || []).map((c: any) => c.id);
    if (memberIds.length > 0) {
      const [{ data: vine }, { data: store }, { data: shareholders }, { data: tank }, { data: personalLiab }] = await Promise.all([
        supabase.from("vineyard_accounts").select("*").in("contact_id", memberIds),
        supabase.from("storehouses").select("*").in("contact_id", memberIds),
        supabase.from("shareholders").select("contact_id, corporation_id, ownership_percentage, share_class, role_title").in("contact_id", memberIds).eq("is_active", true),
        supabase.from("holding_tank").select("contact_id, current_value").in("contact_id", memberIds).neq("status", "moved"),
        (supabase.from("liabilities" as any) as any).select("*").eq("holder_type", "contact").in("contact_id", memberIds),
      ]);
      if (!mountedRef.current) return;
      setVineyardAccounts(vine || []);
      setStorehouses(store || []);
      setHoldingTank(tank || []);

      let corpIds: string[] = [];
      let corpLiabilities: any[] = [];
      if (shareholders && shareholders.length > 0) {
        corpIds = [...new Set(shareholders.map((s: any) => s.corporation_id))];
        const [{ data: corps }, { data: corpVineyard }, { data: corpLiab }] = await Promise.all([
          supabase.from("corporations").select("id, name, corporation_type, jurisdiction").in("id", corpIds),
          supabase.from("corporate_vineyard_accounts").select("*").in("corporation_id", corpIds),
          (supabase.from("liabilities" as any) as any).select("*").eq("holder_type", "corporation").in("corporation_id", corpIds),
        ]);
        if (!mountedRef.current) return;
        corpLiabilities = corpLiab || [];

        const enrichedCorps = (corps || []).map((corp: any) => ({
          ...corp,
          shareholders: shareholders.filter((s: any) => s.corporation_id === corp.id),
          vineyard_accounts: (corpVineyard || []).filter((v: any) => v.corporation_id === corp.id),
          total_assets: (corpVineyard || [])
            .filter((v: any) => v.corporation_id === corp.id)
            .reduce((sum: number, v: any) => sum + (Number(v.current_value) || 0), 0),
        }));
        setCorporations(enrichedCorps);
      }
      setLiabilities([...(personalLiab || []), ...corpLiabilities]);

      // Insurance policies for members + related corporations
      const { data: ins } = await (supabase.from("insurance_policies" as any) as any)
        .select("*")
        .or(`contact_id.in.(${memberIds.join(",")})${corpIds.length ? `,corporation_id.in.(${corpIds.join(",")})` : ""}`);
      if (!mountedRef.current) return;
      setInsurancePolicies((ins as any[]) || []);
    }


    if (mountedRef.current) setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const [enrollingIntake, setEnrollingIntake] = useState(false);
  const enrollExistingClientInIntake = useCallback(async () => {
    if (!id || members.length === 0) return;
    setEnrollingIntake(true);
    try {
      const memberIds = members.map((m: any) => m.id);

      // Already enrolled? (a qualifying booking already exists for someone in this household)
      const { data: existing } = await supabase
        .from("service_bookings")
        .select("id")
        .in("contact_id", memberIds)
        .in("payment_status", ["paid", "not_required"])
        .limit(1);

      if (!existing?.length) {
        // Best-effort link to the real "Sovereignty Audit" service catalog entry, if one exists.
        const { data: service } = await supabase
          .from("services")
          .select("id")
          .ilike("name", "%sovereignty%audit%")
          .limit(1)
          .maybeSingle();

        const { error: bookingError } = await supabase.from("service_bookings").insert({
          contact_id: members[0].id,
          service_id: (service as any)?.id ?? null,
          status: "confirmed",
          payment_status: "not_required",
          amount: 0,
          total: 0,
          currency: "CAD",
          paid_at: new Date().toISOString(),
          notes: "Enrolled by staff — existing client formalizing their Sovereignty Operating System. No payment required.",
        });
        if (bookingError) {
          toast.error("Couldn't enroll this household in guided intake.");
          return;
        }
      }

      // Always mark this as a legacy upgrade — even on a repeat click, so a
      // household that got flagged onboarding_enabled some other way still
      // gets the vision/values Step 3 framing instead of the wealth-event one.
      const flagPatch: Record<string, boolean> = { legacy_intake_upgrade: true };
      if (household.onboarding_enabled === false) flagPatch.onboarding_enabled = true;
      const { error: flagError } = await supabase.from("households").update(flagPatch).eq("id", id);
      if (flagError) {
        toast.error("Booking recorded, but couldn't update this household's onboarding settings — check the switch above manually.");
        return;
      }
      setHousehold((prev: any) => ({ ...prev, ...flagPatch }));

      toast.success("Enrolled — the Sovereignty Survey intake will now appear in this household's portal.");
    } finally {
      setEnrollingIntake(false);
    }
  }, [id, members, household]);

  const [pushingIntake, setPushingIntake] = useState(false);
  const pushToIntakeAgent = useCallback(async () => {
    if (!id) return;
    setPushingIntake(true);
    try {
      const { data, error } = await supabase.functions.invoke("crm-intake-push", {
        body: { household_id: id },
      });
      if (error) {
        const details =
          (error as any)?.context && typeof (error as any).context.text === "function"
            ? await (error as any).context.text()
            : error.message;
        console.error("crm-intake-push failed:", details);
        toast.error("Vault provisioning failed — see console for details");
        return;
      }
      toast.success(
        data?.vaultRootFolderId
          ? "Vault provisioned — Drive folders created and linked"
          : "Vault already provisioned",
      );
      fetchData();
    } finally {
      setPushingIntake(false);
    }
  }, [id, fetchData]);


  if (loading) {
    return (
      <AppLayout>
        <div className="flex justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!household) {
    return (
      <AppLayout>
        <div className="text-center py-24">
          <p className="text-muted-foreground">Household not found.</p>
          <Button variant="link" onClick={() => navigate("/households")}>Back to Households</Button>
        </div>
      </AppLayout>
    );
  }

  const totalVineyard = vineyardAccounts.reduce(
    (sum, a) => sum + (Number(a.current_value) || 0),
    0
  );
  // Cash value always belongs to Strategic Reserve, by policy — not linked to a specific
  // storehouse account row, so it can't be broken by deleting a manual account.
  const totalInsuranceInStorehouses = insurancePolicies.reduce(
    (sum, p) => sum + (Number(p.cash_value) || 0),
    0
  );
  const totalStorehouses =
    storehouses
      .filter((s: any) => s.asset_type !== 'Primary Residence & Protected Legacy Accounts')
      .reduce((sum, s) => sum + (Number(s.current_value) || 0), 0) +
    totalInsuranceInStorehouses;
  const totalCorpAssets = corporations.reduce(
    (sum, c) => sum + (c.total_assets || 0),
    0
  );
  const totalHoldingTank = holdingTank.reduce(
    (sum, h) => sum + (Number(h.current_value) || 0),
    0
  );
  const totalLiabilities = liabilities.reduce(
    (sum, l) => sum + (Number(l.current_balance) || 0),
    0
  );
  const netWorth = totalVineyard + totalStorehouses + totalCorpAssets + totalHoldingTank - totalLiabilities;

  // Group vineyard by type
  const byType: Record<string, { accounts: any[]; total: number }> = {};
  vineyardAccounts.forEach((a) => {
    const t = a.account_type || "Other";
    if (!byType[t]) byType[t] = { accounts: [], total: 0 };
    byType[t].accounts.push(a);
    byType[t].total += Number(a.current_value) || 0;
  });

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageBreadcrumbs
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Households", href: "/households" },
            { label: household.label },
          ]}
        />

        {/* Header Card */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => navigate("/households")}
                  className="shrink-0 -ml-2"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="h-12 w-12 shrink-0 rounded-full bg-sanctuary-green text-sanctuary-bronze flex items-center justify-center">
                  <Home className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="text-xl font-bold truncate">{household.label}</h1>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Link
                      to={household.family_id ? `/families/${household.family_id}` : "/families"}
                      className="flex items-center gap-1.5 text-sm text-sanctuary-bronze hover:underline"
                    >
                      <Users className="h-3.5 w-3.5" />
                      {familyName} Family
                    </Link>
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {household.fiduciary_entity}
                    </Badge>
                    {household.governance_status !== "none" && (
                      <Badge
                        className={
                          household.governance_status === "stabilization"
                            ? "bg-sanctuary-green/20 text-sanctuary-green border-sanctuary-green/30"
                            : "bg-sanctuary-bronze/20 text-sanctuary-bronze border-sanctuary-bronze/30"
                        }
                      >
                        {household.governance_status === "stabilization"
                          ? "Stabilization Phase"
                          : household.governance_status === "sovereign"
                            ? "Sovereign Phase"
                            : "Core"}
                      </Badge>
                    )}
                    {household.relationship_ended_at && (
                      <Badge variant="outline" className="text-[10px] uppercase gap-1">
                        <CalendarOff className="h-3 w-3" />
                        Relationship Ended {format(new Date(household.relationship_ended_at), "MMM yyyy")}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="flex items-center gap-2 mr-2">
                  <Label htmlFor="hof-visible" className="text-xs text-muted-foreground cursor-pointer">
                    HoF Visible
                  </Label>
                  <Switch
                    id="hof-visible"
                    checked={household.hof_visible ?? true}
                    onCheckedChange={async (checked) => {
                      await supabase.from("households").update({ hof_visible: checked }).eq("id", household.id);
                      setHousehold({ ...household, hof_visible: checked });
                    }}
                  />
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline">
                      More Actions
                      <ChevronDown className="ml-1.5 h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem asChild>
                      <Link to={`/vault/household/${id}`}>
                        <ShieldCheck className="mr-2 h-4 w-4" /> Open Vault
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to={`/workbench?household=${id}`}>
                        <BarChart3 className="mr-2 h-4 w-4" /> Cashflow Analyst
                      </Link>
                    </DropdownMenuItem>
                    {household.relationship_ended_at ? (
                      <DropdownMenuItem onClick={() => setReopenRelationshipOpen(true)}>
                        <RotateCcw className="mr-2 h-4 w-4" /> Reopen Relationship
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onClick={() => setEndRelationshipOpen(true)}>
                        <CalendarOff className="mr-2 h-4 w-4" /> End Advisory Relationship
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <AlertDialog open={endRelationshipOpen} onOpenChange={setEndRelationshipOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>End Advisory Relationship</AlertDialogTitle>
                  <AlertDialogDescription>
                    This starts ProsperWise's 7-year recordkeeping retention clock for this household. It
                    does not delete or hide any data — it only marks when retention review becomes
                    eligible.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="end-date" className="text-xs text-muted-foreground">
                      Relationship end date
                    </Label>
                    <Input
                      id="end-date"
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="end-reason" className="text-xs text-muted-foreground">
                      Reason (optional, for internal audit context)
                    </Label>
                    <Textarea
                      id="end-reason"
                      value={endReason}
                      onChange={(e) => setEndReason(e.target.value)}
                      placeholder="e.g. Client transferred to another advisor"
                      className="mt-1"
                    />
                  </div>
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => {
                      const relationship_ended_at = new Date(endDate).toISOString();
                      await supabase
                        .from("households")
                        .update({
                          relationship_ended_at,
                          relationship_end_reason: endReason || null,
                        } as any)
                        .eq("id", household.id);
                      setHousehold({
                        ...household,
                        relationship_ended_at,
                        relationship_end_reason: endReason || null,
                      });
                      setEndReason("");
                      toast.success("Advisory relationship marked as ended");
                    }}
                  >
                    Confirm
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={reopenRelationshipOpen} onOpenChange={setReopenRelationshipOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reopen Relationship</AlertDialogTitle>
                  <AlertDialogDescription>
                    This clears the relationship-ended date and resets retention tracking for this
                    household. Use this if the relationship end was recorded in error or the client has
                    returned.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => {
                      await supabase
                        .from("households")
                        .update({
                          relationship_ended_at: null,
                          relationship_end_reason: null,
                          retention_flagged_at: null,
                        } as any)
                        .eq("id", household.id);
                      setHousehold({
                        ...household,
                        relationship_ended_at: null,
                        relationship_end_reason: null,
                        retention_flagged_at: null,
                      });
                      toast.success("Advisory relationship reopened");
                    }}
                  >
                    Confirm
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {/* Info grid */}
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Address</p>
                {household.address ? (
                  <div className="flex items-start gap-2 text-sm font-medium">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <span>{household.address}</span>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">—</p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Governance Status</p>
                <Select
                  value={household.governance_status || "stabilization"}
                  onValueChange={async (v) => {
                    await supabase.from("households").update({ governance_status: v as any }).eq("id", household.id);
                    setHousehold({ ...household, governance_status: v });
                    toast.success("Governance status updated for household");
                  }}
                >
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    <SelectItem value="core">Core</SelectItem>
                    <SelectItem value="stabilization">Stabilization Phase</SelectItem>
                    <SelectItem value="sovereign">Sovereign Phase</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Fiduciary Entity</p>
                <Select
                  value={household.fiduciary_entity || "pws"}
                  onValueChange={async (v) => {
                    await supabase.from("households").update({ fiduciary_entity: v as any }).eq("id", household.id);
                    setHousehold({ ...household, fiduciary_entity: v });
                    toast.success("Fiduciary entity updated for household");
                  }}
                >
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pws">PWS — Strategy / Architect</SelectItem>
                    <SelectItem value="pwa">PWA — Advisors / Builder</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Quiet Period Start</p>
                <Input
                  type="date"
                  value={household.quiet_period_start_date || ""}
                  onChange={async (e) => {
                    const val = e.target.value || null;
                    await supabase.from("households").update({ quiet_period_start_date: val }).eq("id", household.id);
                    const memberIds = members.map((m: any) => m.id);
                    if (memberIds.length > 0) {
                      await supabase.from("contacts").update({ quiet_period_start_date: val }).in("id", memberIds);
                    }
                    setHousehold({ ...household, quiet_period_start_date: val });
                    toast.success("Quiet period updated for household");
                  }}
                  className="h-8"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="overview" className="flex-1">Overview</TabsTrigger>
            <TabsTrigger value="vault" className="flex-1">
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
              Vault
            </TabsTrigger>
            <TabsTrigger value="actions" className="flex-1">
              <ListChecks className="mr-1.5 h-3.5 w-3.5" />
              Action Items
            </TabsTrigger>
            <TabsTrigger value="vineyard" className="flex-1">
              <Grape className="mr-1.5 h-3.5 w-3.5" />
              The Vineyard
            </TabsTrigger>
            <TabsTrigger value="pros" className="flex-1">
              <Briefcase className="mr-1.5 h-3.5 w-3.5" />
              Pros
            </TabsTrigger>
            <TabsTrigger value="analytics" className="flex-1">
              <BarChart3 className="mr-1.5 h-3.5 w-3.5" />
              Analytics
            </TabsTrigger>
          </TabsList>

          {/* Overview */}
          <TabsContent value="overview" className="mt-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                {/* Household Registered Members Directory */}
                <Card>
                  <CardHeader className="pb-4">
                    <CardTitle className="text-lg">Members Directory</CardTitle>
                  </CardHeader>
                  <CardContent className="px-0 pb-0">
                    {members.length === 0 ? (
                      <p className="px-6 pb-6 text-sm text-muted-foreground">No members in this household.</p>
                    ) : (
                      <div className="overflow-x-auto border-t border-border">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground">
                              <th className="text-left font-medium px-6 py-3">Member Name</th>
                              <th className="text-left font-medium px-3 py-3">Email</th>
                              <th className="text-left font-medium px-3 py-3">Contact Phone</th>
                              <th className="text-right font-medium px-3 py-3">Holding Tank</th>
                              <th className="text-right font-medium px-3 py-3">Vineyard</th>
                              <th className="text-right font-medium px-6 py-3">Storehouses</th>
                            </tr>
                          </thead>
                          <tbody>
                            {members.map((m) => {
                              const initials = `${(m.first_name?.[0] || "").toUpperCase()}${(m.last_name?.[0] || "").toUpperCase()}` || "—";
                              const tankTotal = holdingTank
                                .filter((t) => t.contact_id === m.id)
                                .reduce((s, t) => s + (Number(t.current_value) || 0), 0);
                              const vineTotal = vineyardAccounts
                                .filter((v) => v.contact_id === m.id)
                                .reduce((s, v) => s + (Number(v.current_value) || 0), 0);
                              const storeTotal = storehouses
                                .filter((s) => s.contact_id === m.id && s.asset_type !== 'Primary Residence & Protected Legacy Accounts')
                                .reduce((sum, s) => sum + (Number(s.current_value) || 0), 0);
                              return (
                                <tr
                                  key={m.id}
                                  onClick={() => navigate(`/contacts/${m.id}`)}
                                  className="border-b border-border last:border-0 cursor-pointer hover:bg-muted/40 transition-colors"
                                >
                                  <td className="px-6 py-4">
                                    <div className="flex items-center gap-3 min-w-0">
                                      <div className="h-8 w-8 shrink-0 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-[11px] font-medium">
                                        {initials}
                                      </div>
                                      <span className="font-semibold text-foreground truncate">
                                        {m.first_name} {m.last_name || ""}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="px-3 py-4 text-foreground/80">{m.email || "—"}</td>
                                  <td className="px-3 py-4 text-foreground/80">{m.phone || "—"}</td>
                                  <td className="px-3 py-4 text-right font-medium text-foreground">
                                    {formatCurrency(tankTotal)}
                                  </td>
                                  <td className="px-3 py-4 text-right font-medium text-primary">
                                    {formatCurrency(vineTotal)}
                                  </td>
                                  <td className="px-6 py-4 text-right font-medium text-accent">
                                    {formatCurrency(storeTotal)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Corporations Directory */}
                <Card>
                  <CardHeader className="pb-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <CardTitle className="text-lg">Corporations Directory</CardTitle>
                        <p className="text-xs text-muted-foreground mt-1">
                          {corporations.length} entit{corporations.length === 1 ? "y" : "ies"} · {formatCurrency(totalCorpAssets)}
                        </p>
                      </div>
                      <AddCompanyDialog
                        members={members
                          .filter((m: any) => !m.is_minor)
                          .map((m: any) => ({
                            id: m.id,
                            name: `${m.first_name} ${m.last_name || ""}`.trim(),
                          }))}
                        existingCorpIds={corporations.map((c: any) => c.id)}
                        onCreated={fetchData}
                      />
                    </div>
                  </CardHeader>
                  <CardContent className="px-0 pb-0">
                    {corporations.length === 0 ? (
                      <p className="px-6 pb-6 text-sm text-muted-foreground">
                        No corporate entities linked to this household yet.
                      </p>
                    ) : (
                      <div className="overflow-x-auto border-t border-border">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground">
                              <th className="text-left font-medium px-6 py-3">Entity</th>
                              <th className="text-left font-medium px-3 py-3">Type</th>
                              <th className="text-left font-medium px-3 py-3">Jurisdiction</th>
                              <th className="text-left font-medium px-3 py-3">Shareholders</th>
                              <th className="text-right font-medium px-6 py-3">Assets</th>
                            </tr>
                          </thead>
                          <tbody>
                            {corporations.map((corp: any) => {
                              const shareholderNames = (corp.shareholders || [])
                                .map((sh: any) => {
                                  const member = members.find((m: any) => m.id === sh.contact_id);
                                  const name = member ? `${member.first_name} ${member.last_name || ""}`.trim() : "Member";
                                  return `${name} (${sh.ownership_percentage}%)`;
                                })
                                .join(", ");
                              return (
                                <tr
                                  key={corp.id}
                                  onClick={() => navigate(`/corporations/${corp.id}`)}
                                  className="border-b border-border last:border-0 cursor-pointer hover:bg-muted/40 transition-colors"
                                >
                                  <td className="px-6 py-4">
                                    <div className="flex items-center gap-3 min-w-0">
                                      <div className="h-8 w-8 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center">
                                        <Building2 className="h-4 w-4 text-primary" />
                                      </div>
                                      <span className="font-semibold text-foreground truncate">{corp.name}</span>
                                    </div>
                                  </td>
                                  <td className="px-3 py-4">
                                    <Badge variant="outline" className="text-[9px] uppercase">
                                      {TYPE_LABELS[corp.corporation_type] || corp.corporation_type}
                                    </Badge>
                                  </td>
                                  <td className="px-3 py-4 text-foreground/80">{corp.jurisdiction || "—"}</td>
                                  <td className="px-3 py-4 text-foreground/80 truncate max-w-[240px]">
                                    {shareholderNames || "—"}
                                  </td>
                                  <td className="px-6 py-4 text-right font-medium text-foreground">
                                    {formatCurrency(corp.total_assets || 0)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>


              {/* Right rail: AUM Stats */}
              <div className="space-y-4">
                <CollapsibleCard
                  icon={Wallet}
                  iconBgClassName="bg-sanctuary-bronze/10"
                  iconColorClassName="text-sanctuary-bronze"
                  title="Assets Under Management"
                  headerRight={
                    <p className="text-xl font-bold text-sanctuary-bronze">
                      {formatCurrency(totalVineyard + totalStorehouses + totalCorpAssets + totalHoldingTank)}
                    </p>
                  }
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Grape className="h-3.5 w-3.5" /> Portfolio
                      </span>
                      <span className="font-semibold text-primary">{formatCurrency(totalVineyard)}</span>
                    </div>
                    {[
                      { num: 1, label: "Liquidity Reserve" },
                      { num: 2, label: "Strategic Reserve" },
                      { num: 3, label: "Philanthropic Trust" },
                      { num: 4, label: "Legacy Trust" },
                    ].map(({ num, label }) => {
                      const shForNum = storehouses.filter((s: any) => s.storehouse_number === num);
                      const shIds = new Set(shForNum.map((s: any) => s.id));
                      const isLegacy = num === 4;
                      const shTotal = shForNum
                        .filter((s: any) => isLegacy || s.asset_type !== 'Primary Residence & Protected Legacy Accounts')
                        .reduce((sum: number, s: any) => sum + (Number(s.current_value) || 0), 0);
                      const cashTotal = num === 2
                        ? insurancePolicies.reduce((sum: number, p: any) => sum + (Number(p.cash_value) || 0), 0)
                        : 0;
                      const coverageTotal = isLegacy
                        ? insurancePolicies
                            .filter((p: any) => p.coverage_storehouse_id && shIds.has(p.coverage_storehouse_id))
                            .reduce((sum: number, p: any) => sum + (Number(p.coverage_amount) || 0), 0)
                        : 0;
                      const rowTotal = shTotal + cashTotal + coverageTotal;
                      if (rowTotal === 0 && shForNum.length === 0) return null;
                      return (
                        <div key={num} className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2 text-muted-foreground">
                            <Landmark className="h-3.5 w-3.5" /> {label}
                          </span>
                          <span className="font-semibold text-accent">{formatCurrency(rowTotal)}</span>
                        </div>
                      );
                    })}
                    {totalHoldingTank > 0 && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <Anchor className="h-3.5 w-3.5" /> Holding Tank
                        </span>
                        <span className="font-semibold text-amber-600">{formatCurrency(totalHoldingTank)}</span>
                      </div>
                    )}
                    {corporations.length > 0 && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <Building2 className="h-3.5 w-3.5" /> Corp Assets
                        </span>
                        <span className="font-semibold text-foreground">{formatCurrency(totalCorpAssets)}</span>
                      </div>
                    )}
                    {totalLiabilities > 0 && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <TrendingDown className="h-3.5 w-3.5" /> Liabilities
                        </span>
                        <span className="font-semibold text-destructive">-{formatCurrency(totalLiabilities)}</span>
                      </div>
                    )}
                  </div>
                  <div className="pt-3 border-t border-border">
                    <p className="text-xs text-muted-foreground">Net Worth</p>
                    <p className="text-2xl font-bold text-foreground mb-2">{formatCurrency(netWorth)}</p>
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <User className="h-3.5 w-3.5" /> Members
                      </span>
                      <span className="font-semibold text-foreground">{members.length}</span>
                    </div>
                  </div>
                </CollapsibleCard>

                {insurancePolicies.length > 0 && (() => {
                  const totalCoverage = insurancePolicies.reduce((s: number, p: any) => s + (Number(p.coverage_amount) || 0), 0);
                  const memberById = new Map(members.map((m: any) => [m.id, m]));
                  const corpById = new Map(corporations.map((c: any) => [c.id, c]));
                  const ownerName = (p: any) => {
                    if (p.corporation_id) return corpById.get(p.corporation_id)?.name ?? "Corporation";
                    const m = memberById.get(p.contact_id);
                    return m ? `${m.first_name} ${m.last_name}` : "Household";
                  };
                  return (
                    <CollapsibleCard
                      icon={Shield}
                      iconBgClassName="bg-sanctuary-bronze/10"
                      iconColorClassName="text-sanctuary-bronze"
                      title="Insurance"
                      headerRight={
                        <p className="text-xl font-bold text-sanctuary-bronze">{formatCurrency(totalCoverage)}</p>
                      }
                      contentClassName="space-y-2"
                    >
                      {insurancePolicies.map((p: any) => (
                        <div key={p.id} className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2 text-muted-foreground">
                            <Shield className="h-3.5 w-3.5" /> {policyTypeLabel(p.policy_type)} — {ownerName(p)}
                          </span>
                          <span className="font-semibold text-foreground">{formatCurrency(p.coverage_amount)}</span>
                        </div>
                      ))}
                    </CollapsibleCard>
                  );
                })()}

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">AI Workbench</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      The household workflow, in order.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Step 1 — Scan for Update */}
                    <div className="flex items-start gap-3">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-xs font-semibold text-muted-foreground">
                        1
                      </div>
                      <div className="flex-1 space-y-1.5">
                        <p className="text-sm font-medium text-foreground">Scan for updates</p>
                        <p className="text-xs text-muted-foreground">
                          Parse new investment statements and insurance policies filed in the Vault.
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={vaultScanning}
                          onClick={async () => {
                            if (!id) return;
                            setVaultScanning(true);
                            try {
                              const { data, error } = await supabase.functions.invoke("vault-statement-scan", {
                                body: { householdId: id },
                              });
                              if (error) throw error;
                              if (data?.error) throw new Error(data.error);
                              const parts: string[] = [];
                              if (data.investmentFilesParsed) {
                                const bits = [];
                                if (data.investmentAccountsMatched) bits.push(`${data.investmentAccountsMatched} account${data.investmentAccountsMatched === 1 ? "" : "s"} updated`);
                                if (data.investmentHoldingTankUpdated) bits.push(`${data.investmentHoldingTankUpdated} Holding Tank entr${data.investmentHoldingTankUpdated === 1 ? "y" : "ies"} updated`);
                                if (data.investmentAccountsUnmatched) bits.push(`${data.investmentAccountsUnmatched} new → Holding Tank`);
                                parts.push(bits.length ? bits.join(", ") : "no changes");
                              }
                              if (data.insuranceFilesParsed) {
                                parts.push(
                                  `${data.insurancePoliciesMatched} polic${data.insurancePoliciesMatched === 1 ? "y" : "ies"} updated` +
                                    (data.insurancePoliciesCreated ? `, ${data.insurancePoliciesCreated} new` : ""),
                                );
                              }
                              if (!data.investmentsFolderFound && !data.insuranceFolderFound) {
                                toast.error("Couldn't find the Investment Statements or Insurance Vault folders for this household.");
                              } else if (parts.length === 0) {
                                toast.info("Scanned the Vault — no statement or policy files found to parse.");
                              } else {
                                toast.success(`Vault scan complete: ${parts.join("; ")}.`);
                              }
                              if (data.errors?.length) {
                                console.error("vault-statement-scan file errors:", data.errors);
                                toast.warning(`${data.errors.length} file(s) couldn't be parsed: ${data.errors.slice(0, 3).join("; ")}${data.errors.length > 3 ? ` (+${data.errors.length - 3} more, see console)` : ""}`, { duration: 15000 });
                              }
                              fetchData();
                            } catch (e: any) {
                              toast.error(`Vault scan failed: ${e.message || "Unknown error"}`);
                            } finally {
                              setVaultScanning(false);
                            }
                          }}
                        >
                          {vaultScanning ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <ScanSearch className="h-4 w-4 mr-1.5" />}
                          Scan Vault for Updates
                        </Button>
                      </div>
                    </div>

                    {/* Step 2 — Stabilization Map */}
                    <div className="flex items-start gap-3">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-xs font-semibold text-muted-foreground">
                        2
                      </div>
                      <div className="flex-1 space-y-1.5">
                        <p className="text-sm font-medium text-foreground">Stabilization Map</p>
                        <p className="text-xs text-muted-foreground">
                          Generate or review the household's one-page Sovereignty Survey.
                        </p>
                        <StabilizationMapButton householdId={id} />
                      </div>
                    </div>

                    {/* Step 3 — Quarterly Governance Audit */}
                    <div className="flex items-start gap-3">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-xs font-semibold text-muted-foreground">
                        3
                      </div>
                      <div className="flex-1 space-y-1.5">
                        <p className="text-sm font-medium text-foreground">Quarterly Governance Audit</p>
                        <p className="text-xs text-muted-foreground">
                          Generate or review the household's full Sovereignty Governance Audit.
                        </p>
                        <GovernanceAuditButton householdId={id} />
                      </div>
                    </div>

                    {/* Step 4 — Enroll in Guided Intake. Hidden once the
                        household has actually finished onboarding — nothing
                        left to enroll them into at that point. */}
                    {!household.onboarding_completed_at && (
                      <div className="flex items-start gap-3">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-xs font-semibold text-muted-foreground">
                          4
                        </div>
                        <div className="flex-1 space-y-1.5">
                          <p className="text-sm font-medium text-foreground">Enroll in guided intake</p>
                          <p className="text-xs text-muted-foreground">
                            Send an existing client through the same guided wizard as a new client — no
                            payment required.
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={enrollExistingClientInIntake}
                            disabled={enrollingIntake || members.length === 0}
                          >
                            {enrollingIntake ? (
                              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                            ) : (
                              <UserCheck className="h-3.5 w-3.5 mr-1.5" />
                            )}
                            Enroll in Guided Intake
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
                {(household?.vision_notes || household?.values_notes || household?.purpose_notes ||
                  household?.anchor_transfer_amount != null || household?.spousal_alignment_score != null ||
                  household?.pressure_types?.length > 0 || household?.pending_capex_amount != null ||
                  household?.legacy_advisor_friction_notes) && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <HeartHandshake className="h-4 w-4 text-sanctuary-bronze" />
                        Household Context
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">
                        Captured during guided intake — read-only.
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      {household?.vision_notes && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">Vision</p>
                          <p className="text-foreground">{household.vision_notes}</p>
                        </div>
                      )}
                      {household?.values_notes && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">Values</p>
                          <p className="text-foreground">{household.values_notes}</p>
                        </div>
                      )}
                      {household?.purpose_notes && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">Purpose for their capital</p>
                          <p className="text-foreground">{household.purpose_notes}</p>
                        </div>
                      )}
                      {household?.anchor_transfer_amount != null && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">Anchor transfer amount</p>
                          <p className="text-foreground">
                            {formatCurrency(household.anchor_transfer_amount)}
                            {household.anchor_transfer_amount_note ? ` — ${household.anchor_transfer_amount_note}` : ""}
                          </p>
                        </div>
                      )}
                      {household?.spousal_alignment_score != null && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">Spousal/partner alignment</p>
                          <p className="text-foreground">
                            {household.spousal_alignment_score}/5
                            {household.spousal_alignment_note ? ` — ${household.spousal_alignment_note}` : ""}
                          </p>
                        </div>
                      )}
                      {household?.pressure_types?.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">Outside pressure</p>
                          <p className="text-foreground">
                            {household.pressure_types.join(", ")}
                            {household.pressure_note ? ` — ${household.pressure_note}` : ""}
                          </p>
                        </div>
                      )}
                      {household?.pending_capex_amount != null && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">Pending capital expenditure</p>
                          <p className="text-foreground">
                            {formatCurrency(household.pending_capex_amount)}
                            {household.pending_capex_date ? ` — planned for ${household.pending_capex_date}` : ""}
                            {household.pending_capex_description ? ` — ${household.pending_capex_description}` : ""}
                          </p>
                        </div>
                      )}
                      {household?.legacy_advisor_friction_notes && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">Friction with a previous advisor</p>
                          <p className="text-foreground">{household.legacy_advisor_friction_notes}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
                <CharterRatificationTile householdId={id} />

                <Card>
                  <CardContent className="py-4">
                    <Link
                      to={`/workbench?household=${id}`}
                      className="flex items-center gap-3 rounded-lg border border-dashed border-primary/30 bg-primary/5 px-4 py-3 hover:bg-primary/10 transition-colors"
                    >
                      <BarChart3 className="h-5 w-5 text-primary" />
                      <div>
                        <p className="text-sm font-medium text-foreground">Cashflow Analyst</p>
                        <p className="text-xs text-muted-foreground">Analyze the True Burn Rate</p>
                      </div>
                    </Link>
                  </CardContent>
                </Card>

                {/* Professional Team — household roll-up */}
                {(() => {
                  const rows: { member: any; role: string; name: string; firm: string | null }[] = [];
                  members.forEach((m: any) => {
                    [
                      { role: "Lawyer", name: m.lawyer_name, firm: m.lawyer_firm },
                      { role: "Accountant", name: m.accountant_name, firm: m.accountant_firm },
                      { role: "Executor", name: m.executor_name, firm: m.executor_firm },
                      { role: "Power of Attorney", name: m.poa_name, firm: m.poa_firm },
                    ].forEach((p) => {
                      if (p.name) rows.push({ member: m, role: p.role, name: p.name, firm: p.firm });
                    });
                  });
                  return (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base">Professional Team</CardTitle>
                      </CardHeader>
                      <CardContent>
                        {rows.length > 0 ? (
                          <ul className="space-y-1.5 text-sm">
                            {rows.map((r, i) => (
                              <li key={i} className="rounded-md bg-muted/50 px-3 py-2">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-medium truncate">{r.name}{r.firm ? ` — ${r.firm}` : ""}</span>
                                  <span className="text-xs text-muted-foreground shrink-0">{r.role}</span>
                                </div>
                                <Link
                                  to={`/contacts/${r.member.id}`}
                                  className="text-[11px] text-muted-foreground hover:underline"
                                >
                                  for {`${r.member.first_name} ${r.member.last_name || ""}`.trim()}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-muted-foreground">No professionals linked.</p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })()}
              </div>
            </div>
          </TabsContent>


          {/* Vault */}
          <TabsContent value="vault" className="space-y-4 mt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-accent" />
                Household document vault — manage visibility and share with collaborators.
              </div>
              <div className="flex items-center gap-3">
                {/* New clients get the guided Audit onboarding; legacy clients don't. */}
                <div className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5">
                  <Switch
                    id="onboarding-enabled"
                    checked={household.onboarding_enabled !== false}
                    onCheckedChange={async (checked) => {
                      setHousehold((prev: any) => ({ ...prev, onboarding_enabled: checked }));
                      const { error } = await supabase
                        .from("households")
                        .update({ onboarding_enabled: checked })
                        .eq("id", id);
                      if (error) {
                        setHousehold((prev: any) => ({ ...prev, onboarding_enabled: !checked }));
                        toast.error("Couldn't update the Audit onboarding setting");
                      } else {
                        toast.success(
                          checked
                            ? "Audit onboarding enabled for this household"
                            : "Audit onboarding hidden from this household's portal",
                        );
                      }
                    }}
                  />
                  <Label htmlFor="onboarding-enabled" className="text-xs whitespace-nowrap">
                    Audit onboarding
                  </Label>
                </div>

                <Button size="sm" variant="outline" onClick={pushToIntakeAgent} disabled={pushingIntake}>
                  {pushingIntake ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Provision Vault
                </Button>
                {household.vault_root_folder_id ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const url = `https://drive.google.com/drive/folders/${household.vault_root_folder_id}`;
                      const w = window.open(url, "_blank", "noopener,noreferrer");
                      if (!w) {
                        navigator.clipboard?.writeText(url);
                        toast.success("Drive link copied — paste in a new tab");
                      }
                    }}
                  >
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                    Open in Drive
                  </Button>
                ) : (
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/vault/household/${id}`}>
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                      Open Full Page
                    </Link>
                  </Button>
                )}
              </div>

            </div>
            <VaultView forcedHouseholdId={id!} embedded />
          </TabsContent>

          {/* Action Items */}
          <TabsContent value="actions" className="space-y-6 mt-4">
            <HouseholdStatementIngestion householdId={id!} members={members} onIngested={fetchData} />
            <HouseholdTaskRollup householdId={id!} members={members} />
            <HouseholdRequestsRollup members={members} />
            <HouseholdAuditTrailRollup members={members} />
            <HoldingTank householdId={id!} onAccountMoved={() => fetchData()} />
          </TabsContent>

          {/* Vineyard / Financials */}
          <TabsContent value="vineyard" className="space-y-6 mt-4">
            <HoldingTank householdId={id!} onAccountMoved={() => fetchData()} />

            {/* The Vineyard */}
            <CollapsibleCard
              icon={Grape}
              iconBgClassName="bg-primary/10"
              iconColorClassName="text-primary"
              title="The Vineyard"
              subtitle="Total Asset Portfolio"
              headerRight={<p className="text-2xl font-bold text-primary">{formatCurrency(totalVineyard)}</p>}
            >
                {Object.entries(byType).length > 0 ? (
                  Object.entries(byType).map(([type, { accounts, total }]) => (
                    <div key={type} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium text-foreground">{type}</h4>
                        <span className="text-sm font-semibold text-foreground">{formatCurrency(total)}</span>
                      </div>
                      {accounts.map((acc) => (
                        <div
                          key={acc.id}
                          className="rounded-lg bg-muted/50 px-4 py-2.5 border border-border"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-foreground/80">{acc.account_name}</span>
                            <span className="text-sm font-medium text-foreground">
                              {formatCurrency(Number(acc.current_value) || 0)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No vineyard accounts configured.</p>
                )}
            </CollapsibleCard>

            {/* Corporate Holdings */}
            <CollapsibleCard
              icon={Building2}
              iconBgClassName="bg-primary/10"
              iconColorClassName="text-primary"
              title="Corporate Holdings"
              subtitle={`${corporations.length} entit${corporations.length === 1 ? "y" : "ies"}`}
              headerRight={
                <div className="flex items-center gap-3">
                  <p className="text-2xl font-bold text-foreground">{formatCurrency(totalCorpAssets)}</p>
                  <AddCompanyDialog
                    members={members
                      .filter((m: any) => !m.is_minor)
                      .map((m: any) => ({
                        id: m.id,
                        name: `${m.first_name} ${m.last_name || ""}`.trim(),
                      }))}
                    existingCorpIds={corporations.map((c: any) => c.id)}
                    onCreated={fetchData}
                  />
                </div>
              }
            >
                {corporations.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No corporate entities linked to this household yet.
                  </p>
                )}
                  {corporations.map((corp: any) => (
                    <div key={corp.id} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Link
                            to={`/corporations/${corp.id}`}
                            className="text-sm font-medium text-foreground hover:underline flex items-center gap-1.5"
                          >
                            {corp.name}
                            <Badge variant="outline" className="text-[9px] uppercase">
                              {TYPE_LABELS[corp.corporation_type] || corp.corporation_type}
                            </Badge>
                          </Link>
                          {corp.jurisdiction && (
                            <span className="text-xs text-muted-foreground">· {corp.jurisdiction}</span>
                          )}
                        </div>
                        <span className="text-sm font-semibold text-foreground">
                          {formatCurrency(corp.total_assets || 0)}
                        </span>
                      </div>
                      <div className="pl-6 space-y-0.5">
                        {corp.shareholders.map((sh: any) => {
                          const member = members.find((m: any) => m.id === sh.contact_id);
                          const name = member ? `${member.first_name} ${member.last_name || ""}`.trim() : "Member";
                          return (
                            <p key={sh.contact_id} className="text-xs text-muted-foreground">
                              {name} — {sh.ownership_percentage}% {sh.share_class || "Common"}
                              {sh.role_title ? ` · ${sh.role_title}` : ""}
                            </p>
                          );
                        })}
                      </div>
                      {(corp.vineyard_accounts || []).map((acc: any) => (
                        <div
                          key={acc.id}
                          className="rounded-lg bg-muted/50 px-4 py-2.5 border border-border"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-foreground/80">{acc.account_name}</span>
                            <span className="text-sm font-medium text-foreground">
                              {formatCurrency(Number(acc.current_value) || 0)}
                            </span>
                          </div>
                        </div>
                      ))}
                      {(corp.vineyard_accounts || []).length === 0 && (
                        <p className="text-xs text-muted-foreground pl-6">No corporate accounts configured</p>
                      )}
                    </div>
                  ))}
            </CollapsibleCard>

            {/* The Storehouses */}
            <CollapsibleCard
              icon={Landmark}
              iconBgClassName="bg-accent/10"
              iconColorClassName="text-accent"
              title="The Storehouses"
              subtitle="Strategic Asset Allocation"
              headerRight={<p className="text-2xl font-bold text-accent">{formatCurrency(totalStorehouses)}</p>}
            >
                {STOREHOUSE_CONFIG.map(({ num, name, icon: Icon }) => {
                  const accounts = storehouses.filter((s) => s.storehouse_number === num);
                  const insuranceHere = num === 2
                    ? insurancePolicies.reduce((sum, p: any) => sum + (Number(p.cash_value) || 0), 0)
                    : 0;
                  const total = accounts.reduce((sum, s) => sum + (Number(s.current_value) || 0), 0) + insuranceHere;
                  const targetTotal = accounts.reduce((sum, s) => sum + (Number(s.target_value) || 0), 0);
                  const pct = targetTotal > 0 ? Math.min((total / targetTotal) * 100, 100) : 0;

                  return (
                    <div key={num} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 text-accent" />
                          <h4 className="text-sm font-medium text-foreground">{name}</h4>
                        </div>
                        <span className="text-sm font-semibold text-foreground">{formatCurrency(total)}</span>
                      </div>
                      {accounts.length > 0 ? (
                        <>
                          {targetTotal > 0 && (
                            <div className="space-y-1">
                              <Progress value={pct} className="h-1.5 bg-muted [&>div]:bg-accent" />
                              <div className="flex justify-between text-xs text-muted-foreground">
                                <span>{Math.round(pct)}% funded</span>
                                <span>Target: {formatCurrency(targetTotal)}</span>
                              </div>
                            </div>
                          )}
                          {accounts.map((acc: any) => (
                            <div
                              key={acc.id}
                              className="rounded-lg bg-muted/50 px-4 py-2.5 border border-border"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-foreground/80">
                                  {acc.label || acc.asset_type || acc.notes || "Account"}
                                </span>
                                <span className="text-sm font-medium text-foreground">
                                  {formatCurrency(Number(acc.current_value) || 0)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground pl-6">No accounts configured</p>
                      )}
                    </div>
                  );
                })}
            </CollapsibleCard>

            {/* Insurance */}
            {insurancePolicies.length > 0 && (() => {
              const totalCoverage = insurancePolicies.reduce((sum: number, p: any) => sum + (Number(p.coverage_amount) || 0), 0);
              const memberById = new Map(members.map((m: any) => [m.id, m]));
              const corpById = new Map(corporations.map((c: any) => [c.id, c]));
              const ownerName = (p: any) => {
                if (p.corporation_id) return corpById.get(p.corporation_id)?.name ?? "Corporation";
                const m = memberById.get(p.contact_id);
                return m ? `${m.first_name} ${m.last_name || ""}`.trim() : "Household";
              };
              return (
                <CollapsibleCard
                  icon={Shield}
                  iconBgClassName="bg-accent/10"
                  iconColorClassName="text-accent"
                  title="Insurance"
                  subtitle="Asset Protection"
                  headerRight={<p className="text-2xl font-bold text-accent">{formatCurrency(totalCoverage)}</p>}
                >
                  {insurancePolicies.map((p: any) => (
                    <div key={p.id} className="rounded-lg bg-muted/50 px-4 py-2.5 border border-border">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-foreground/80">
                          {policyTypeLabel(p.policy_type)} — {p.carrier} — {ownerName(p)}
                        </span>
                        <span className="text-sm font-medium text-foreground">
                          {formatCurrency(Number(p.coverage_amount) || 0)}
                        </span>
                      </div>
                      {p.cash_value > 0 && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Cash Value: {formatCurrency(Number(p.cash_value) || 0)}
                        </p>
                      )}
                    </div>
                  ))}
                </CollapsibleCard>
              );
            })()}
          </TabsContent>

          {/* Analytics */}
          <TabsContent value="analytics" className="space-y-6 mt-4">
            <ContactAnalytics contactIds={members.map((m) => m.id)} />
          </TabsContent>

          {/* Pros */}
          <TabsContent value="pros" className="space-y-6 mt-4">
            <ProsPanel
              scope="household"
              scopeId={id!}
              memberContactIds={members.map((m: any) => m.id)}
              title="Household Pros"
            />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
};

export default HouseholdDetail;
