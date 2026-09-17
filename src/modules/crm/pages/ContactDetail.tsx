import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/shared/integrations/supabase/client";
import { AppLayout } from "@/shared/components/AppLayout";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
import { Progress } from "@/shared/components/ui/progress";
import { Switch } from "@/shared/components/ui/switch";
import { Label } from "@/shared/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import {
  ArrowLeft, Bell, BellOff, Trash2, Clock, AlertCircle, Shield,
  ExternalLink, Bot, Grape, FileUp, Loader2, Building2, Users, Plus, X,
  Folder, FolderOpen, CheckSquare, ShieldCheck, Landmark, ChevronDown, ChevronRight, ListChecks,
  Mail, Phone, MapPin, Home, Calendar, Pencil, Eye, Merge, Link2, BarChart3, Anchor,
  ArrowRight, ChevronLeft, Wallet
} from "lucide-react";
import { ContactAnalytics } from "@/modules/crm/components/ContactAnalytics";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator
} from "@/shared/components/ui/dropdown-menu";
import { CollapsibleCard } from "@/shared/components/CollapsibleCard";
import { toast } from "sonner";
import { format, differenceInDays, addDays } from "date-fns";
import { PageBreadcrumbs } from "@/shared/components/PageBreadcrumbs";
import { policyTypeLabel } from "@/shared/lib/insurance";
import { ContactMerge } from "@/modules/crm/components/ContactMerge";
import { getOrCreateToken } from "@/modules/portal";

async function resolvePortalBase(contactId: string): Promise<"portal" | "vfo"> {
  // Single round-trip: fetch contact + family via nested join on both direct and household paths.
  const { data: contact } = await supabase
    .from("contacts")
    .select("family:family_id(vfo_enabled), households:household_id(family:family_id(vfo_enabled))")
    .eq("id", contactId)
    .maybeSingle();
  const vfoEnabled =
    (contact as any)?.family?.vfo_enabled ??
    (contact as any)?.households?.family?.vfo_enabled ??
    false;
  return vfoEnabled ? "vfo" : "portal";
}
import { useAuth } from "@/shared/hooks/useAuth";
import { ContactTaskList } from "@/modules/crm/components/ContactTaskList";
import { ContactRequests } from "@/modules/crm/components/ContactRequests";
import { ContactCalendar } from "@/modules/crm/components/ContactCalendar";
import QuoCommunications from "@/modules/crm/components/QuoCommunications";
import ManualActivityLog from "@/modules/crm/components/ManualActivityLog";
import { ContactEmails } from "@/modules/crm/components/ContactEmails";
import { AuditTrail } from "@/modules/audit";
import { StatementUpload } from "@/modules/crm";
import { HoldingTank } from "@/modules/crm/components/HoldingTank";
import { LiabilitiesCard } from "@/modules/crm/components/LiabilitiesCard";
import { AssetContainer, type MoveTarget } from "@/modules/crm/components/AssetContainer";
import type { WebFormRecord } from "@/modules/crm/components/WebFormEditorDialog";
import { InsurancePanel } from "@/modules/crm/components/InsurancePanel";
import { StabilizationMapButton } from "@/modules/audit";
import { QuarterlySystemReviewButton } from "@/modules/audit";
import { SovereigntyCharterButton } from "@/modules/audit";
import { GenerateCharterDraftButton } from "@/modules/audit";
import { VaultView } from "@/modules/crm/pages/Vault";
import { dialViaQuo } from "@/shared/lib/quo-dial";
import { MEETING_BOOKING_LINKS } from "@/shared/lib/meetingBookingLinks";
import { SERVICE_TIER_LABEL, type ServiceTier } from "@/shared/lib/serviceTier";
import { 
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, 
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, 
  AlertDialogTitle, AlertDialogTrigger 
} from "@/shared/components/ui/alert-dialog";

const STOREHOUSE_NAMES = ["Liquidity Reserve", "Strategic Reserve", "Philanthropic Trust", "Legacy Trust"];

interface Storehouse {
  id: string;
  storehouse_number: number;
  label: string;
  asset_type: string | null;
  risk_cap: string | null;
  charter_alignment: string;
  notes: string | null;
  visibility_scope: string;
  current_value: number | null;
  target_value: number | null;
  book_value: number | null;
  account_number?: string | null;
  custodian?: string | null;
  beneficiary_designation?: string | null;
}

interface HouseholdMember {
  id: string;
  first_name: string;
  last_name: string | null;
  family_role: string;
}

interface EngagedProfessional {
  id: string;
  full_name: string;
  firm: string | null;
  professional_type: string;
}

interface VineyardAccount {
  id: string;
  account_name: string;
  account_number?: string | null;
  account_type: string;
  book_value: number | null;
  current_value: number | null;
  notes: string | null;
  visibility_scope: string;
  custodian?: string | null;
  beneficiary_designation?: string | null;
}

interface HarvestSnapshot {
  id: string;
  snapshot_date: string;
  reporting_year: number;
  boy_value: number;
  current_harvest: number;
  current_value: number;
  notes: string | null;
  vineyard_account_id: string | null;
  storehouse_id: string | null;
}

interface HarvestDraft {
  id?: string;
  snapshot_date: string;
  boy_value: string;
  current_harvest: string;
  current_value: string;
  notes: string;
}

const formatCurrency = (value: number | null | undefined) =>
  value == null || Number.isNaN(value)
    ? "—"
    : new Intl.NumberFormat("en-CA", {
        style: "currency",
        currency: "CAD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(value);

const toInputValue = (value: number | null | undefined) =>
  value == null || Number.isNaN(value) ? "" : String(value);

const parseMoney = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const getHarvestKey = (kind: "vineyard" | "storehouse", id: string) => `${kind}:${id}`;

const ContactDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [corpHoldingsCollapsed, setCorpHoldingsCollapsed] = useState(true);
  const [contact, setContact] = useState<any>(null);
  const [storehouses, setStorehouses] = useState<Storehouse[]>([]);
  const [householdMembers, setHouseholdMembers] = useState<HouseholdMember[]>([]);
  const [engagedProfessionals, setEngagedProfessionals] = useState<EngagedProfessional[]>([]);
  const [familyName, setFamilyName] = useState<string | null>(null);
  const [familyServiceTier, setFamilyServiceTier] = useState<string | null>(null);
  const [householdLabel, setHouseholdLabel] = useState<string | null>(null);
  const [householdVaultRootId, setHouseholdVaultRootId] = useState<string | null>(null);
  const [householdGovernanceStatus, setHouseholdGovernanceStatus] = useState<string | null>(null);
  const [vineyardAccounts, setVineyardAccounts] = useState<VineyardAccount[]>([]);
  const [professionalContacts, setProfessionalContacts] = useState<Record<string, { id: string; full_name: string } | null>>({});
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountType, setNewAccountType] = useState("Portfolio");
  const [newAccountValue, setNewAccountValue] = useState("");
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [loading, setLoading] = useState(true);
  const [statementFiles, setStatementFiles] = useState<File[]>([]);
  const [isIngesting, setIsIngesting] = useState(false);
  const [harvestSnapshots, setHarvestSnapshots] = useState<HarvestSnapshot[]>([]);
  const [harvestDrafts, setHarvestDrafts] = useState<Record<string, HarvestDraft>>({});
  const [savingHarvestKey, setSavingHarvestKey] = useState<string | null>(null);
  const [corporateStakes, setCorporateStakes] = useState<Array<{
    corporation_id: string;
    corporation_name: string;
    corporation_type: string;
    ownership_percentage: number;
    share_class: string | null;
    role_title: string | null;
    total_assets: number;
    pro_rata: number;
    subsidiaries: Array<{
      child_id: string;
      child_name: string;
      child_type: string;
      parent_ownership_pct: number;
      child_total_assets: number;
      indirect_pro_rata: number;
    }>;
  }>>([]);
  const [holdingTankAccounts, setHoldingTankAccounts] = useState<any[]>([]);
  const [insurancePolicies, setInsurancePolicies] = useState<any[]>([]);
  const [webforms, setWebforms] = useState<WebFormRecord[]>([]);

  useEffect(() => {
    (supabase.from("adobe_webforms" as any) as any)
      .select("*")
      .eq("is_active", true)
      .then(({ data }: any) => setWebforms((data as WebFormRecord[]) || []));
  }, []);

  const { user } = useAuth();
  const [viewPortalLoading, setViewPortalLoading] = useState(false);
  const [copyLoading, setCopyLoading] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [bookMeetingOpen, setBookMeetingOpen] = useState(false);
  const [embeddedBooking, setEmbeddedBooking] = useState<{ label: string; embedUrl: string } | null>(null);

  // Guard against setState after unmount when fetchData is triggered by
  // mutation callbacks or route changes racing with async Supabase queries.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchData = useCallback(async () => {
    if (!id) return;
    // Batch 1 — all queries that only depend on `id` fire in parallel.
    const [contactRes, storehouseRes, holdingRes, , accountsRes, harvestRes, insRes, shareholdingsRes] = await Promise.all([
      supabase.from("contacts").select("*").eq("id", id).maybeSingle(),
      supabase.from("storehouses").select("*").eq("contact_id", id).order("storehouse_number"),
      supabase.from("holding_tank").select("*").eq("contact_id", id).neq("status", "moved").order("created_at"),
      supabase.from("family_relationships").select("id, member_contact_id, relationship_label, contact:contacts!family_relationships_member_contact_id_fkey(id, first_name, last_name)").eq("contact_id", id),
      supabase.from("vineyard_accounts" as any).select("*").eq("contact_id", id).order("created_at"),
      supabase.from("account_harvest_snapshots").select("*").eq("contact_id", id).order("snapshot_date", { ascending: false }),
      supabase.from("insurance_policies" as any).select("*").eq("contact_id", id),
      supabase.from("shareholders").select("corporation_id, ownership_percentage, share_class, role_title").eq("contact_id", id).eq("is_active", true),
    ]);
    if (!mountedRef.current) return;
    setContact(contactRes.data);
    setStorehouses(storehouseRes.data || []);
    setHoldingTankAccounts((holdingRes.data as any) || []);
    setVineyardAccounts((accountsRes.data as any) || []);
    setHarvestSnapshots((harvestRes.data as any) || []);
    setInsurancePolicies((insRes.data as any) || []);

    // Batch 2 — all queries that depend on contactRes fields fire in parallel.
    const contactData = contactRes.data;
    const names = [contactData?.lawyer_name, contactData?.accountant_name, contactData?.executor_name, contactData?.poa_name].filter(Boolean) as string[];
    const engagementScopeIds = [id, contactData?.household_id, contactData?.family_id].filter(Boolean) as string[];
    const [hhMembersRes, famRes, hhRes, profRes, engagedProRes] = await Promise.all([
      contactData?.household_id
        ? supabase.from("contacts").select("id, first_name, last_name, family_role").eq("household_id", contactData.household_id).neq("id", id).order("first_name")
        : Promise.resolve({ data: [] as any[] }),
      contactData?.family_id
        ? supabase.from("families").select("name, service_tier").eq("id", contactData.family_id).maybeSingle()
        : Promise.resolve({ data: null as any }),
      contactData?.household_id
        ? supabase.from("households").select("label, vault_root_folder_id, governance_status").eq("id", contactData.household_id).maybeSingle()
        : Promise.resolve({ data: null as any }),
      names.length > 0
        ? supabase.from("contacts").select("id, first_name, last_name, full_name").in("full_name", names)
        : Promise.resolve({ data: [] as any[] }),
      supabase
        .from("professional_engagements")
        .select("professional:professionals(id, full_name, firm, professional_type)")
        .in("scope_id", engagementScopeIds)
        .in("status", ["invited", "active", "completed"]),
    ]);
    if (!mountedRef.current) return;
    setHouseholdMembers((hhMembersRes.data as any) || []);
    setFamilyName((famRes.data as any)?.name || null);
    setFamilyServiceTier((famRes.data as any)?.service_tier || null);
    setHouseholdLabel((hhRes.data as any)?.label || null);
    setHouseholdVaultRootId((hhRes.data as any)?.vault_root_folder_id || null);
    setHouseholdGovernanceStatus((hhRes.data as any)?.governance_status || null);
    const proMap = new Map<string, EngagedProfessional>();
    ((engagedProRes.data as any[]) || []).forEach((row) => {
      const p = row.professional;
      if (p && !proMap.has(p.id)) proMap.set(p.id, p);
    });
    setEngagedProfessionals(Array.from(proMap.values()));
    if (names.length > 0) {
      const matchedContacts = (profRes.data as any[]) || [];
      const map: Record<string, { id: string; full_name: string } | null> = {};
      names.forEach((name) => {
        const match = matchedContacts.find((c) => c.full_name === name) || null;
        map[name] = match ? { id: match.id, full_name: match.full_name } : null;
      });
      setProfessionalContacts(map);
    }


    try {
      const shareholdings = (shareholdingsRes.data as any[]) || [];

      if (shareholdings.length > 0) {
        const corpIds = shareholdings.map((s) => s.corporation_id);
        const [corpsRes, assetsRes, subsRes] = await Promise.all([
          supabase.from("corporations").select("id, name, corporation_type").in("id", corpIds),
          supabase.from("corporate_vineyard_accounts").select("corporation_id, current_value").in("corporation_id", corpIds),
          supabase.from("corporate_shareholders").select("parent_corporation_id, child_corporation_id, ownership_percentage").in("parent_corporation_id", corpIds),
        ]);
        if (!mountedRef.current) return;
        const childIds = (subsRes.data || []).map((s) => s.child_corporation_id);
        let childCorps: any[] = [];
        let childAssets: any[] = [];
        if (childIds.length > 0) {
          const [cc, ca] = await Promise.all([
            supabase.from("corporations").select("id, name, corporation_type").in("id", childIds),
            supabase.from("corporate_vineyard_accounts").select("corporation_id, current_value").in("corporation_id", childIds),
          ]);
          if (!mountedRef.current) return;
          childCorps = cc.data || [];
          childAssets = ca.data || [];
        }
        const stakes = shareholdings.map((sh) => {
          const corp = (corpsRes.data || []).find((c) => c.id === sh.corporation_id);
          const totalAssets = (assetsRes.data || []).filter((a) => a.corporation_id === sh.corporation_id).reduce((sum, a) => sum + (Number(a.current_value) || 0), 0);
          const proRata = totalAssets * (sh.ownership_percentage / 100);
          const subs = (subsRes.data || []).filter((s) => s.parent_corporation_id === sh.corporation_id).map((s) => {
            const child = childCorps.find((c: any) => c.id === s.child_corporation_id);
            const childTotal = childAssets.filter((a: any) => a.corporation_id === s.child_corporation_id).reduce((sum: number, a: any) => sum + (Number(a.current_value) || 0), 0);
            const indirectPct = (sh.ownership_percentage / 100) * (s.ownership_percentage / 100);
            return { child_id: s.child_corporation_id, child_name: child?.name || "Unknown", child_type: child?.corporation_type || "other", parent_ownership_pct: s.ownership_percentage, child_total_assets: childTotal, indirect_pro_rata: childTotal * indirectPct };
          });
          return { corporation_id: sh.corporation_id, corporation_name: corp?.name || "Unknown", corporation_type: corp?.corporation_type || "other", ownership_percentage: sh.ownership_percentage, share_class: sh.share_class, role_title: sh.role_title, total_assets: totalAssets, pro_rata: proRata, subsidiaries: subs };
        });
        setCorporateStakes(stakes);
      } else {
        setCorporateStakes([]);
      }
    } finally {
      // Also fixes M16: guarantee spinner clears even if a downstream branch throws.
      if (mountedRef.current) setLoading(false);
    }
  }, [id]);

  const handleViewPortal = async () => {
    if (!user || !id) return;
    setViewPortalLoading(true);
    const newWindow = window.open("about:blank", "_blank");
    try {
      const [token, base] = await Promise.all([getOrCreateToken(id, user.id), resolvePortalBase(id)]);
      if (newWindow) newWindow.location.href = `/${base}/${token}`;
      else window.location.href = `/${base}/${token}`;
    } catch {
      if (newWindow) newWindow.close();
      toast.error("Failed to open portal.");
    } finally {
      setViewPortalLoading(false);
    }
  };

  const handleCopyPortalLink = async () => {
    if (!user || !id) return;
    setCopyLoading(true);
    try {
      const [token, base] = await Promise.all([getOrCreateToken(id, user.id), resolvePortalBase(id)]);
      const url = `${window.location.origin}/${base}/${token}`;
      await navigator.clipboard.writeText(url);
      toast.success(`${base === "vfo" ? "VFO" : "Portal"} link copied to clipboard — valid for 7 days.`);
    } catch {
      toast.error("Failed to generate portal link.");
    } finally {
      setCopyLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const latestByKey = harvestSnapshots.reduce<Record<string, HarvestSnapshot>>((acc, snapshot) => {
      const key = snapshot.vineyard_account_id
        ? getHarvestKey("vineyard", snapshot.vineyard_account_id)
        : snapshot.storehouse_id
          ? getHarvestKey("storehouse", snapshot.storehouse_id)
          : null;

      if (!key) return acc;

      const current = acc[key];
      if (!current || new Date(snapshot.snapshot_date) > new Date(current.snapshot_date)) {
        acc[key] = snapshot;
      }
      return acc;
    }, {});

    const today = new Date().toISOString().slice(0, 10);
    const nextDrafts: Record<string, HarvestDraft> = {};

    vineyardAccounts.forEach((account) => {
      const key = getHarvestKey("vineyard", account.id);
      const snapshot = latestByKey[key];
      nextDrafts[key] = {
        id: snapshot?.id,
        snapshot_date: snapshot?.snapshot_date ?? today,
        boy_value: toInputValue(snapshot?.boy_value ?? account.book_value),
        current_harvest: toInputValue(snapshot?.current_harvest),
        current_value: toInputValue(snapshot?.current_value ?? account.current_value),
        notes: snapshot?.notes ?? "",
      };
    });

    storehouses.forEach((storehouse) => {
      const key = getHarvestKey("storehouse", storehouse.id);
      const snapshot = latestByKey[key];
      nextDrafts[key] = {
        id: snapshot?.id,
        snapshot_date: snapshot?.snapshot_date ?? today,
        boy_value: toInputValue(snapshot?.boy_value ?? storehouse.book_value),
        current_harvest: toInputValue(snapshot?.current_harvest),
        current_value: toInputValue(snapshot?.current_value ?? storehouse.current_value),
        notes: snapshot?.notes ?? "",
      };
    });

    setHarvestDrafts(nextDrafts);
  }, [harvestSnapshots, vineyardAccounts, storehouses]);

  const handleIngestStatements = async () => {
    if (!statementFiles.length || !contact) return;
    setIsIngesting(true);
    try {
      for (const file of statementFiles) {
        const filePath = `${id}/${Date.now()}_${file.name}`;
        const { error: upErr } = await supabase.storage.from("statement-uploads").upload(filePath, file);
        if (upErr) { toast.error(`Upload failed: ${upErr.message}`); continue; }
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ingest-statement`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({ contactId: id, householdId: contact.household_id, filePath, contactName: contact.full_name }),
        });
        const result = await res.json();
        if (result.error) { toast.error(result.error); }
        else { toast.success(`Extracted ${result.accountsExtracted} account(s) from ${file.name}`); }
      }
      setStatementFiles([]);
      fetchData();
    } catch (err: any) {
      toast.error(err.message || "Ingestion failed");
    } finally {
      setIsIngesting(false);
    }
  };

  const updateHarvestDraft = (key: string, field: keyof HarvestDraft, value: string) => {
    setHarvestDrafts((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        [field]: value,
      },
    }));
  };

  const saveHarvestSnapshot = async (
    key: string,
    account: { id: string; name: string; kind: "vineyard" | "storehouse" }
  ) => {
    const draft = harvestDrafts[key];
    if (!draft) return;

    const boyValue = parseMoney(draft.boy_value) ?? 0;
    const currentValue = parseMoney(draft.current_value) ?? 0;
    const calculatedHarvest = currentValue - boyValue;
    const currentHarvest = parseMoney(draft.current_harvest) ?? calculatedHarvest;

    const payload = {
      contact_id: id!,
      snapshot_date: draft.snapshot_date,
      boy_value: boyValue,
      ytd_value: currentValue,
      current_harvest: currentHarvest,
      current_value: currentValue,
      notes: draft.notes.trim() || null,
      vineyard_account_id: account.kind === "vineyard" ? account.id : null,
      storehouse_id: account.kind === "storehouse" ? account.id : null,
    };

    setSavingHarvestKey(key);
    try {
      if (draft.id) {
        const { error } = await supabase
          .from("account_harvest_snapshots")
          .update(payload)
          .eq("id", draft.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("account_harvest_snapshots").insert(payload);
        if (error) throw error;
      }

      const sourceTable = account.kind === "vineyard" ? "vineyard_accounts" : "storehouses";
      const { error: sourceError } = await supabase
        .from(sourceTable as any)
        .update({
          book_value: boyValue,
          current_value: currentValue,
        } as any)
        .eq("id", account.id);
      if (sourceError) throw sourceError;

      toast.success(`${account.name} harvest tracking saved.`);
      fetchData();
    } catch (error: any) {
      toast.error(error.message || "Failed to save harvest tracking.");
    } finally {
      setSavingHarvestKey(null);
    }
  };

  // Memoize props passed to InsurancePanel. MUST be declared before any early returns
  // so hook order stays stable across renders.
  const insuranceScope = useMemo(() => ({ kind: "contact" as const, contactId: id! }), [id]);
  const insuranceStorehouses = useMemo(
    () => storehouses.map((s) => ({ id: s.id, storehouse_number: s.storehouse_number, label: s.label })),
    [storehouses],
  );

  if (loading) {
    return (<AppLayout><p className="text-muted-foreground">Loading...</p></AppLayout>);
  }
  if (!contact) {
    return (<AppLayout><p className="text-muted-foreground">Contact not found.</p></AppLayout>);
  }

  const isStabilization = householdGovernanceStatus === "stabilization";
  const quietStart = contact.quiet_period_start_date ? new Date(contact.quiet_period_start_date) : null;
  const quietEnd = quietStart ? addDays(quietStart, 90) : null;
  const daysElapsed = quietStart ? Math.min(differenceInDays(new Date(), quietStart), 90) : 0;
  const daysLeft = quietEnd ? Math.max(differenceInDays(quietEnd, new Date()), 0) : null;
  const progressPct = quietStart ? Math.min((daysElapsed / 90) * 100, 100) : 0;

  const resourceLinks = [
    { label: "Google Drive", url: contact.google_drive_url, icon: FolderOpen },
    { label: "Asana", url: contact.asana_url, icon: CheckSquare },
    { label: "IA Financial", url: contact.ia_financial_url, icon: ShieldCheck },
    { label: "Just Wealth", url: (contact as any).just_wealth_url, icon: Landmark },
  ];

  const PHASES = [
    { num: 1, label: "Discovery" },
    { num: 2, label: "Charter Drafting" },
    { num: 3, label: "Quiet Period" },
    { num: 4, label: "Ratification" },
    { num: 5, label: "Sovereign" },
  ];


  return (
    <AppLayout>
      <div className="space-y-6">
        <PageBreadcrumbs items={[
          { label: "Dashboard", href: "/dashboard" },
          ...(familyName ? [{ label: familyName, href: "/families" }] : []),
          ...(householdLabel && contact.household_id ? [{ label: householdLabel, href: `/households/${contact.household_id}` }] : []),
          { label: "Contacts", href: "/contacts" },
          { label: `${contact.first_name} ${contact.last_name || ""}`.trim() },
        ]} />
        {/* Header Card */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <Button variant="ghost" size="icon" onClick={() => navigate("/contacts")} className="shrink-0 -ml-2">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="h-12 w-12 shrink-0 rounded-full bg-sanctuary-green text-sanctuary-bronze flex items-center justify-center text-base font-semibold">
                  {(contact.first_name?.[0] || "").toUpperCase()}{(contact.last_name?.[0] || "").toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="text-xl font-bold truncate">
                    {contact.first_name} {contact.last_name}
                  </h1>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {householdLabel && contact.household_id ? (
                      <Link
                        to={`/households/${contact.household_id}`}
                        className="flex items-center gap-1.5 text-sm text-sanctuary-bronze hover:underline"
                      >
                        <Home className="h-3.5 w-3.5" />
                        Household: {householdLabel}
                      </Link>
                    ) : (
                      <span className="flex items-center gap-1.5 text-sm text-sanctuary-bronze">
                        <Home className="h-3.5 w-3.5" />
                        Household: —
                      </span>
                    )}
                    {familyServiceTier ? (
                      <Badge
                        variant="outline"
                        className="text-[10px]"
                        title="Staff-only — not visible to clients"
                      >
                        {SERVICE_TIER_LABEL[familyServiceTier as ServiceTier]}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        Tier not classified
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button asChild variant="ghost" size="icon" title="Edit contact">
                  <Link to={`/contacts/${id}/edit`}>
                    <Pencil className="h-4 w-4" />
                  </Link>
                </Button>
                <Button
                  className="bg-sanctuary-green text-sanctuary-bronze hover:bg-sanctuary-green/90 gap-1.5"
                  onClick={handleViewPortal}
                  disabled={viewPortalLoading}
                >
                  {viewPortalLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                  View Portal
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline">
                      More Actions
                      <ChevronDown className="ml-1.5 h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    {contact.asana_url && (
                      <DropdownMenuItem asChild>
                        <a href={contact.asana_url} target="_blank" rel="noopener noreferrer">
                          <CheckSquare className="mr-2 h-4 w-4" /> Open Asana
                        </a>
                      </DropdownMenuItem>
                    )}
                    {contact.google_drive_url && (
                      <DropdownMenuItem asChild>
                        <a href={contact.google_drive_url} target="_blank" rel="noopener noreferrer">
                          <FolderOpen className="mr-2 h-4 w-4" /> Open Drive
                        </a>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem asChild>
                      <Link to={`/vault/${contact.id}`}>
                        <ShieldCheck className="mr-2 h-4 w-4" /> Open Vault
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {contact.phone && (
                      <DropdownMenuItem onSelect={() => dialViaQuo(contact.phone!)}>
                        <Phone className="mr-2 h-4 w-4" /> Call via Quo
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onSelect={() => { setEmbeddedBooking(null); setBookMeetingOpen(true); }}>
                      <Calendar className="mr-2 h-4 w-4" /> Book a Meeting
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={handleCopyPortalLink} disabled={copyLoading}>
                      {copyLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
                      Copy Portal Link
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setMergeOpen(true)}>
                      <Merge className="mr-2 h-4 w-4" /> Merge Contact
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link to={`/contacts/${id}/edit`}>
                        <Pencil className="mr-2 h-4 w-4" /> Edit Contact
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Contact info grid */}
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Primary email</p>
                {contact.email ? (
                  <a href={`mailto:${contact.email}`} className="flex items-center gap-2 text-sm font-medium hover:underline break-all">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    {contact.email}
                  </a>
                ) : (
                  <p className="text-sm text-muted-foreground">—</p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Primary phone</p>
                {contact.phone ? (
                  <button
                    type="button"
                    onClick={() => dialViaQuo(contact.phone!)}
                    className="flex items-center gap-2 text-sm font-medium hover:underline"
                  >
                    <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    {contact.phone}
                  </button>
                ) : (
                  <p className="text-sm text-muted-foreground">—</p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Address</p>
                {contact.address ? (
                  <div className="flex items-start gap-2 text-sm font-medium">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <span>{contact.address}</span>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">—</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        <ContactMerge
          contactId={id!}
          contactName={`${contact.first_name} ${contact.last_name || ""}`.trim()}
          onMerged={fetchData}
          open={mergeOpen}
          onOpenChange={setMergeOpen}
        />

        <Dialog
          open={bookMeetingOpen}
          onOpenChange={(open) => {
            setBookMeetingOpen(open);
            if (!open) setEmbeddedBooking(null);
          }}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Book a Meeting</DialogTitle>
            </DialogHeader>
            {embeddedBooking ? (
              <div className="space-y-3">
                <button
                  onClick={() => setEmbeddedBooking(null)}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-accent transition-colors"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Back to meeting types
                </button>
                <div className="rounded-lg border border-border overflow-hidden bg-card">
                  <iframe
                    src={embeddedBooking.embedUrl}
                    style={{ border: 0 }}
                    width="100%"
                    height={650}
                    title={embeddedBooking.label}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                {MEETING_BOOKING_LINKS.map((link) => (
                  <button
                    key={link.url}
                    onClick={() => setEmbeddedBooking(link)}
                    className="w-full flex items-center justify-between rounded-md border border-border bg-card px-3 py-2.5 text-sm text-foreground hover:border-accent/40 hover:bg-accent/[0.03] transition-colors text-left"
                  >
                    {link.label}
                    <ArrowRight className="h-4 w-4 text-accent" />
                  </button>
                ))}
              </div>
            )}
          </DialogContent>
        </Dialog>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main Content */}
          <div className="space-y-6 lg:col-span-2">
            {/* Quiet Period Timer */}
            {isStabilization && quietStart && (
               <Card className="border-sanctuary-green/30">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <Clock className="h-5 w-5 text-sanctuary-green" />
                    <h3 className="font-semibold">Quiet Period</h3>
                    <Badge className="ml-auto bg-sanctuary-green/10 text-sanctuary-green border-sanctuary-green/20">
                      <AlertCircle className="mr-1 h-3 w-3" />
                      Zero Sales Pressure
                    </Badge>
                  </div>
                  <Progress value={progressPct} className="mb-3 h-2" />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Started {format(quietStart, "MMM d, yyyy")}</span>
                    <span className="font-medium text-foreground">
                      {daysLeft !== null && daysLeft > 0
                        ? `${daysLeft} days remaining`
                        : "Quiet Period Complete"}
                    </span>
                    <span>Ends {quietEnd && format(quietEnd, "MMM d, yyyy")}</span>
                  </div>
                  {daysLeft === 0 && (
                    <div className="mt-4 rounded-md bg-sanctuary-bronze/10 p-3 text-center text-sm text-sanctuary-bronze">
                      <Shield className="mr-1 inline h-4 w-4" />
                      Ready for Charter Ratification
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Main Tabs */}
            <Tabs defaultValue="comms" className="w-full">
              <TabsList className="w-full">
                <TabsTrigger value="comms" className="flex-1">Communications</TabsTrigger>
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
                <TabsTrigger value="analytics" className="flex-1">
                  <BarChart3 className="mr-1.5 h-3.5 w-3.5" />
                  Analytics
                </TabsTrigger>
              </TabsList>

              {/* Communications Tab — Messaging first, above the fold */}
              <TabsContent value="comms" className="space-y-6 mt-4">
                <ContactRequests contactId={id!} />
                <QuoCommunications
                  contactId={contact.id}
                  contactPhone={contact.phone}
                  contactName={`${contact.first_name} ${contact.last_name || ""}`.trim()}
                />
                <ManualActivityLog
                  contactId={contact.id}
                  contactName={`${contact.first_name} ${contact.last_name || ""}`.trim()}
                />
                <ContactEmails
                  contactId={contact.id}
                  contactEmail={contact.email}
                  contactName={`${contact.first_name} ${contact.last_name || ""}`.trim()}
                />
              </TabsContent>

              {/* Vault Tab */}
              <TabsContent value="vault" className="space-y-4 mt-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <ShieldCheck className="h-4 w-4 text-accent" />
                    Household document vault — manage visibility and share with collaborators.
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-1.5">
                      <Switch
                        id="shoebox-only"
                        checked={!!(contact as any).vault_shoebox_only}
                        onCheckedChange={async (checked) => {
                          const { error } = await supabase
                            .from("contacts")
                            .update({ vault_shoebox_only: checked } as any)
                            .eq("id", contact.id);
                          if (error) {
                            toast.error("Failed to update vault visibility");
                            return;
                          }
                          setContact((c: any) => c ? { ...c, vault_shoebox_only: checked } : c);
                          toast.success(checked ? "Client now sees Shoebox only" : "Full vault restored");
                        }}
                      />
                      <Label htmlFor="shoebox-only" className="text-xs cursor-pointer whitespace-nowrap">
                        Shoebox only (portal)
                      </Label>
                    </div>
                  {householdVaultRootId ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const url = `https://drive.google.com/drive/folders/${householdVaultRootId}`;
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
                      <Link to={`/vault/${contact.id}`}>
                        <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                        Open Full Page
                      </Link>
                    </Button>
                  )}
                  </div>
                </div>
                {contact.household_id ? (
                  <VaultView forcedHouseholdId={contact.household_id} embedded />
                ) : (
                  <Card>
                    <CardContent className="py-8 text-center text-sm text-muted-foreground">
                      This contact is not assigned to a household yet.
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* Action Items Tab */}
              <TabsContent value="actions" className="space-y-6 mt-4">
                <ContactCalendar contactEmail={contact.email} contactName={contact.full_name} />
                <ContactTaskList contactId={contact.id} />
                <AuditTrail contactId={id!} />
              </TabsContent>

              {/* The Vineyard Tab */}
              <TabsContent value="vineyard" className="space-y-4 mt-4">
                {/* Holding Tank */}
                <HoldingTank contactId={id!} onAccountMoved={() => fetchData()} />

                {/* Insurance */}
                <InsurancePanel
                  scope={insuranceScope}
                  storehouses={insuranceStorehouses}
                  onStorehousesChanged={() => fetchData()}
                />

                {/* Liabilities */}
                <LiabilitiesCard holderType="contact" holderId={id!} />


                {/* The Vineyard Accounts */}
                <AssetContainer
                  title="The Vineyard"
                  icon={<Grape className="h-3.5 w-3.5 text-sanctuary-green" />}
                  containerKey="vineyard"
                  contactId={id!}
                  webforms={webforms}
                  accounts={vineyardAccounts.map((acc) => ({
                    id: acc.id,
                    name: acc.account_name,
                    type: acc.account_type,
                    currentValue: acc.current_value,
                    notes: acc.notes,
                    visibilityScope: acc.visibility_scope,
                    accountNumber: acc.account_number,
                    custodian: acc.custodian,
                    beneficiaryDesignation: acc.beneficiary_designation,
                    sourceTable: "vineyard_accounts" as const,
                  }))}
                  moveTargets={[
                    { label: "Liquidity Reserve", key: "storehouse-1" },
                    { label: "Strategic Reserve", key: "storehouse-2" },
                    { label: "Philanthropic Trust", key: "storehouse-3" },
                    { label: "Legacy Trust", key: "storehouse-4" },
                  ]}
                  onMoveAccount={async (account, targetKey) => {
                    const storehouseNum = parseInt(targetKey.split("-")[1]);
                    const { error: insertErr } = await supabase.from("storehouses").insert({
                      contact_id: id,
                      storehouse_number: storehouseNum,
                      label: account.name,
                      current_value: account.currentValue,
                      notes: account.notes,
                      visibility_scope: account.visibilityScope,
                      account_number: account.accountNumber,
                      custodian: account.custodian,
                      beneficiary_designation: account.beneficiaryDesignation,
                    } as any);
                    if (insertErr) { toast.error("Failed to move account."); return; }
                    await supabase.from("vineyard_accounts" as any).delete().eq("id", account.id);
                    toast.success(`Moved "${account.name}" to ${STOREHOUSE_NAMES[storehouseNum - 1]}.`);
                    fetchData();
                  }}
                  onRefresh={fetchData}
                  showAddForm={showAddAccount}
                  onAddAccount={() => setShowAddAccount(true)}
                  addFormContent={
                    <div className="mt-2 space-y-2 rounded-md border p-3">
                      <Input
                        placeholder="Account name (e.g. Fidelity Portfolio)"
                        value={newAccountName}
                        onChange={(e) => setNewAccountName(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <select
                          value={newAccountType}
                          onChange={(e) => setNewAccountType(e.target.value)}
                          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                        >
                          <option value="Portfolio">Portfolio</option>
                          <option value="Business Venture">Business Venture</option>
                          <option value="Real Estate">Real Estate</option>
                          <option value="Insurance">Insurance</option>
                          <option value="Retirement">Retirement</option>
                          <option value="Other">Other</option>
                        </select>
                        <Input
                          type="number"
                          placeholder="Value ($)"
                          value={newAccountValue}
                          onChange={(e) => setNewAccountValue(e.target.value)}
                          className="w-28"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={!newAccountName.trim()}
                          onClick={async () => {
                            const { error } = await supabase.from("vineyard_accounts" as any).insert({
                              contact_id: id,
                              account_name: newAccountName.trim(),
                              account_type: newAccountType,
                              current_value: newAccountValue ? Number(newAccountValue) : null,
                            } as any);
                            if (error) {
                              toast.error("Failed to add account.");
                            } else {
                              toast.success("Account added.");
                              setNewAccountName("");
                              setNewAccountType("Portfolio");
                              setNewAccountValue("");
                              setShowAddAccount(false);
                              fetchData();
                            }
                          }}
                        >
                          Add
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setShowAddAccount(false)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  }
                />

                {/* Corporate Stakes */}
                {corporateStakes.length > 0 && (
                  <div className="rounded-lg border border-border bg-card">
                    <div
                      className="flex items-center justify-between px-3 py-2 border-b border-border/50 cursor-pointer select-none"
                      onClick={() => setCorpHoldingsCollapsed((c) => !c)}
                    >
                      <div className="flex items-center gap-2">
                        <Building2 className="h-3.5 w-3.5 text-sanctuary-bronze" />
                        <h4 className="text-xs font-semibold uppercase tracking-wider">Corporate Holdings</h4>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold tabular-nums">
                          ${corporateStakes.reduce((sum, s) => {
                            const indirect = s.subsidiaries.reduce((si: any, sub: any) => si + sub.indirect_pro_rata, 0);
                            return sum + s.pro_rata + indirect;
                          }, 0).toLocaleString()}
                        </span>
                        {corpHoldingsCollapsed ? (
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </div>
                    </div>
                    {!corpHoldingsCollapsed && (
                    <div className="p-2 space-y-1">
                      {corporateStakes.map((stake) => {
                        const totalIndirect = stake.subsidiaries.reduce((s: any, sub: any) => s + sub.indirect_pro_rata, 0);
                        const totalStake = stake.pro_rata + totalIndirect;
                        return (
                          <div key={stake.corporation_id} className="rounded-md bg-muted/40 px-3 py-2 space-y-1.5">
                            <div className="flex items-center justify-between">
                              <Link
                                to={`/corporations/${stake.corporation_id}`}
                                className="font-medium text-sm hover:underline flex items-center gap-1.5"
                              >
                                {stake.corporation_name}
                                <Badge variant="outline" className="text-[9px] uppercase">{stake.corporation_type}</Badge>
                              </Link>
                              <span className="text-xs font-medium tabular-nums">${totalStake.toLocaleString()}</span>
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                              <span>{stake.ownership_percentage}% {stake.share_class || "Common"}</span>
                              {stake.role_title && <span>· {stake.role_title}</span>}
                              <span className="ml-auto">Direct: ${stake.pro_rata.toLocaleString()}</span>
                            </div>
                            {stake.subsidiaries.map((sub: any) => (
                              <div key={sub.child_id} className="flex justify-between text-[10px] pl-3 border-l-2 border-border">
                                <Link to={`/corporations/${sub.child_id}`} className="text-muted-foreground hover:underline">
                                  via {sub.child_name} ({stake.ownership_percentage}% × {sub.parent_ownership_pct}%)
                                </Link>
                                <span className="font-medium">${sub.indirect_pro_rata.toLocaleString()}</span>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                    )}
                  </div>
                )}

                {/* Storehouse Containers */}
                {[1, 2, 3, 4].map((num) => {
                  const accounts = storehouses.filter((s) => s.storehouse_number === num);
                  const storehouseName = STOREHOUSE_NAMES[num - 1];
                  const shIds = accounts.map((a) => a.id);
                  const coveragePolicies = insurancePolicies.filter((p) => shIds.includes(p.coverage_storehouse_id));
                  // Cash value always belongs to Strategic Reserve, by policy — not linked to a
                  // specific account row, so it can't be broken by deleting a manual account.
                  const cashValuePolicies = num === 2 ? insurancePolicies : [];
                  const otherTargets = [
                    { label: "The Vineyard", key: "vineyard" },
                    ...[1, 2, 3, 4]
                      .filter((n) => n !== num)
                      .map((n) => ({ label: STOREHOUSE_NAMES[n - 1], key: `storehouse-${n}` })),
                  ];
                  return (
                    <div key={num} className="space-y-2">
                    <AssetContainer
                      title={storehouseName}
                      icon={
                        <span className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold bg-sanctuary-bronze/20 text-sanctuary-bronze">
                          {num}
                        </span>
                      }
                      containerKey={`storehouse-${num}`}
                      contactId={id!}
                      webforms={webforms}
                      accounts={accounts.map((sh) => ({
                        id: sh.id,
                        name: sh.asset_type || sh.label || "Account",
                        type: "",
                        currentValue: sh.current_value,
                        targetValue: sh.target_value,
                        notes: sh.notes,
                        visibilityScope: sh.visibility_scope,
                        charterAlignment: sh.charter_alignment,
                        accountNumber: sh.account_number,
                        custodian: sh.custodian,
                        beneficiaryDesignation: sh.beneficiary_designation,
                        sourceTable: "storehouses" as const,
                      }))}
                      extraTotal={
                        cashValuePolicies.reduce((s, p) => s + (Number(p.cash_value) || 0), 0)
                        + coveragePolicies.reduce((s, p) => s + (Number(p.coverage_amount) || 0), 0)
                      }
                      moveTargets={otherTargets}
                      onMoveAccount={async (account, targetKey) => {
                        if (targetKey === "vineyard") {
                          const { error: insertErr } = await supabase.from("vineyard_accounts" as any).insert({
                            contact_id: id,
                            account_name: account.name,
                            account_type: account.type || "Portfolio",
                            current_value: account.currentValue,
                            notes: account.notes,
                            visibility_scope: account.visibilityScope,
                            account_number: account.accountNumber,
                            custodian: account.custodian,
                            beneficiary_designation: account.beneficiaryDesignation,
                          } as any);
                          if (insertErr) { toast.error("Failed to move account."); return; }
                          await supabase.from("storehouses").delete().eq("id", account.id);
                          toast.success(`Moved "${account.name}" to The Vineyard.`);
                        } else {
                          const targetNum = parseInt(targetKey.split("-")[1]);
                          const { error } = await supabase
                            .from("storehouses")
                            .update({ storehouse_number: targetNum } as any)
                            .eq("id", account.id);
                          if (error) { toast.error("Failed to move account."); return; }
                          toast.success(`Moved "${account.name}" to ${STOREHOUSE_NAMES[targetNum - 1]}.`);
                        }
                        fetchData();
                      }}
                      onRefresh={fetchData}
                      onAddAccount={async () => {
                        const { error } = await supabase.from("storehouses").insert({
                          contact_id: id,
                          storehouse_number: num,
                          label: "",
                        } as any);
                        if (error) {
                          toast.error("Failed to add account.");
                        } else {
                          toast.success("Account added.");
                          fetchData();
                        }
                      }}
                    />
                    </div>
                  );
                })}
              </TabsContent>

              {/* Analytics Tab */}
              <TabsContent value="analytics" className="space-y-4 mt-4">
                <ContactAnalytics contactId={contact.id} />
              </TabsContent>
            </Tabs>
          </div>

          {/* Right Sidebar — Individual AUM */}
          <div className="space-y-4">
            {(() => {
              const totalVineyard = vineyardAccounts.reduce((s, a) => s + (Number(a.current_value) || 0), 0);
              const nonRealEstateStorehouses = storehouses.filter((s: any) => s.asset_type !== 'Primary Residence & Protected Legacy Accounts');
              // Cash value always belongs to Strategic Reserve, by policy.
              const insuranceCashInStorehouses = insurancePolicies
                .reduce((sum: number, p: any) => sum + (Number(p.cash_value) || 0), 0);
              const totalStorehouses = nonRealEstateStorehouses.reduce((s, a) => s + (Number(a.current_value) || 0), 0) + insuranceCashInStorehouses;
              const totalHoldingTank = holdingTankAccounts.reduce((s, a) => s + (Number(a.current_value) || 0), 0);
              const totalCorpAssets = corporateStakes.reduce((s, st) =>
                s + (Number(st.pro_rata) || 0) + st.subsidiaries.reduce((ss, sub) => ss + (Number(sub.indirect_pro_rata) || 0), 0)
              , 0);
              const total = totalVineyard + totalStorehouses + totalHoldingTank + totalCorpAssets;
              return (
                <CollapsibleCard
                  icon={Wallet}
                  iconBgClassName="bg-sanctuary-bronze/10"
                  iconColorClassName="text-sanctuary-bronze"
                  title="Assets Under Management"
                  headerRight={
                    <p className="text-xl font-bold text-sanctuary-bronze">{formatCurrency(total)}</p>
                  }
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Grape className="h-3.5 w-3.5" /> Portfolio
                      </span>
                      <span className="font-semibold text-primary">{formatCurrency(totalVineyard)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Anchor className="h-3.5 w-3.5" /> Holding Tank
                      </span>
                      <span className="font-semibold text-accent">{formatCurrency(totalHoldingTank)}</span>
                    </div>
                    {[
                      { num: 1, label: "Liquidity Reserve" },
                      { num: 2, label: "Strategic Reserve" },
                      { num: 3, label: "Philanthropic Trust" },
                      { num: 4, label: "Legacy Trust" },
                    ].map(({ num, label }) => {
                      const shForNum = storehouses.filter((s: any) => s.storehouse_number === num);
                      const shIds = new Set(shForNum.map((s: any) => s.id));
                      // Legacy Trust displays full container total (incl. real estate + coverage);
                      // other rows follow AUM rules (exclude real estate, exclude coverage).
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
                    {corporateStakes.length > 0 && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <Building2 className="h-3.5 w-3.5" /> Corp Assets
                        </span>
                        <span className="font-semibold text-foreground">{formatCurrency(totalCorpAssets)}</span>
                      </div>
                    )}
                  </div>
                </CollapsibleCard>
              );
            })()}
            {insurancePolicies.length > 0 && (() => {
              const totalCoverage = insurancePolicies.reduce((s: number, p: any) => s + (Number(p.coverage_amount) || 0), 0);
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
                        <Shield className="h-3.5 w-3.5" /> {policyTypeLabel(p.policy_type)} — {p.carrier}
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
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <SovereigntyCharterButton contactId={id!} className="w-full justify-start" />
                <GenerateCharterDraftButton contactId={id!} className="w-full justify-start" />
                <StabilizationMapButton contactId={id!} className="w-full justify-start" />
                <QuarterlySystemReviewButton contactId={id!} className="w-full justify-start" />
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => navigate(`/workbench/governance-review?scope_id=${contact.household_id ?? ""}`)}
                  disabled={!contact.household_id}
                >
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  Governance Review
                </Button>

                <div className="pt-2 mt-1 border-t border-border space-y-2">
                  <StatementUpload
                    files={statementFiles}
                    onFilesChange={setStatementFiles}
                    isIngesting={isIngesting}
                  />
                  {statementFiles.length > 0 && !isIngesting && (
                    <Button onClick={handleIngestStatements} size="sm" className="w-full">
                      <FileUp className="h-4 w-4 mr-2" />
                      Ingest {statementFiles.length} Statement{statementFiles.length !== 1 ? "s" : ""}
                    </Button>
                  )}
                  {isIngesting && (
                    <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      AI is parsing statements…
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

        </div>
      </div>
    </AppLayout>
  );
};

export default ContactDetail;
