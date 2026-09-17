import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Bot, CheckCircle2, ExternalLink, FileText, FolderSync, Loader2, Pencil, Plus, Printer, Save, ScrollText, Sparkles, Trash2, Upload, WandSparkles, XCircle } from "lucide-react";
import { format } from "date-fns";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { supabase } from "@/shared/integrations/supabase/client";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import { useAuth } from "@/shared/hooks/useAuth";
import { useGoogleStatus, useSyncCharterDriveSources } from "@/shared/hooks/useGoogle";
import { useAutoSave, AutoSaveIndicator } from "@/shared/hooks/useAutoSave";
import { draftSovereigntyCharter, isValidSourceUrl, sanitizeSourceText, sanitizeSourceTitle, sanitizeSourceUrl, uploadCharterSourceFile, type CharterDraftStatus, type CharterSourceInputMode, type CharterSourceKind, type CharterSourceRecord } from "@/modules/audit/lib/charter";
import pwLogoWhite from "@/assets/prosperwise-logo-white.png";

type ContactRecord = {
  id: string;
  first_name: string;
  last_name: string | null;
  full_name: string;
  family_id: string | null;
  household_id: string | null;
  google_drive_url: string | null;
  charter_url: string | null;
  quiet_period_start_date: string | null;
  households: { governance_status: string | null } | null;
  lawyer_name: string | null;
  accountant_name: string | null;
  executor_name: string | null;
  poa_name: string | null;
  email: string | null;
  phone: string | null;
};

type FamilyRecord = {
  id: string;
  name: string;
  charter_document_url: string | null;
  total_family_assets: number;
  annual_savings: number;
  fee_tier: string;
};

type VineyardAccount = {
  id: string;
  account_name: string;
  account_number: string | null;
  account_type: string;
  current_value: number | null;
  book_value: number | null;
  notes: string | null;
};

type Storehouse = {
  id: string;
  label: string;
  storehouse_number: number;
  current_value: number | null;
  book_value: number | null;
  target_value: number | null;
  asset_type: string | null;
  notes: string | null;
  risk_cap: string | null;
};

type StorehouseRule = {
  id: string;
  storehouse_label: string;
  storehouse_number: number;
  rule_type: string;
  rule_description: string;
  rule_value: number | null;
};

type WaterfallPriority = {
  id: string;
  priority_order: number;
  priority_label: string;
  priority_description: string | null;
  target_amount: number | null;
  is_active: boolean;
};

type CustomContainer = {
  id: string;
  title: string;
  meta: string;
  body: string;
};

type CustomSectionGroups = {
  pageOne: CustomContainer[];
  pageTwo: CustomContainer[];
};

type Signatory = {
  name: string;
  role: string;
  signed_at?: string | null;
};

type CharterRecord = {
  id?: string;
  contact_id: string;
  title: string;
  subtitle: string;
  intro_heading: string;
  intro_callout: string;
  intro_note: string;
  mission_of_capital: string;
  vision_20_year: string;
  governance_authority: string;
  conflict_resolution: string;
  fiduciary_alliance: string;
  quiet_period: string;
  architecture_intro: string;
  protected_assets_note: string;
  harvest_accounts_note: string;
  appendix_note: string;
  footer_status: string;
  footer_date_label: string;
  full_markdown: string;
  custom_sections: CustomSectionGroups;
  // ── Phase 2 structured fields ───────────────────────────────────────────
  transition_summary: string;
  primary_goal: string;
  long_term_strategy: string;
  monitoring_cadence: string;
  withdrawal_safeguards: string;
  roles_responsibilities: string;
  professional_coordination: string;
  secondary_quiet_period_rule: string;
  // Growth (Vineyard) detail
  growth_primary_label: string;
  growth_primary_value: number | null;
  growth_primary_detail: string;
  growth_secondary_label: string;
  growth_secondary_value: number | null;
  growth_secondary_detail: string;
  // Storehouse detail
  storehouse_liquidity_value: number | null;
  storehouse_liquidity_detail: string;
  storehouse_strategic_value: number | null;
  storehouse_strategic_detail: string;
  storehouse_philanthropic_detail: string;
  storehouse_legacy_detail: string;
  // Harvest
  harvest_target_income: number | null;
  harvest_yield_protocol: string;
  harvest_spending_categories: string;
  harvest_review_date: string | null;
  // Succession & ratification
  executor_primary: string;
  executor_alternate: string;
  succession_terms: string;
  ratification_signatories: Signatory[];
  // Lifecycle
  draft_status?: CharterDraftStatus;
  ratified_at?: string | null;
  ratified_by?: string | null;
  generation_summary?: string | null;
  last_generated_at?: string | null;
  // E-signature
  esign_status?: string | null;
  esign_doc_id?: string | null;
  esign_doc_url?: string | null;
  esign_sent_at?: string | null;
  esign_signed_at?: string | null;
  esign_error?: string | null;
};

type CharterSourceDraft = {
  id: string;
  sourceKind: CharterSourceKind;
  title: string;
  inputMode: CharterSourceInputMode;
  contentText: string;
  sourceUrl: string;
  file: File | null;
  storedPath: string | null;
  fileName: string | null;
  mimeType: string | null;
  importOrigin?: string;
  externalFileId?: string | null;
  externalModifiedAt?: string | null;
  externalFolderId?: string | null;
  syncError?: string | null;
};

const formatCurrency = (value: number | null | undefined) =>
  value == null || Number.isNaN(value)
    ? "—"
    : new Intl.NumberFormat("en-CA", {
        style: "currency",
        currency: "CAD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(value);

const formatDate = (value: string | null | undefined, fallback = "To be ratified") => {
  if (!value) return fallback;
  try {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const [, year, month, day] = match;
      return format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))), "MMMM d, yyyy");
    }
    return format(new Date(value), "MMMM d, yyyy");
  } catch {
    return value;
  }
};

const isProtectedAccount = (account: VineyardAccount) =>
  /(rrsp|tfsa|lira|rrif|pension|locked)/i.test(account.account_type) ||
  /(protected|legacy|locked)/i.test(account.notes || "");

const pageWrap = "stab-doc bg-white shadow-lg print:shadow-none";

const STOREHOUSE_CONFIG = [
  { num: 1, name: "Liquidity Reserve" },
  { num: 2, name: "Strategic Reserve" },
  { num: 3, name: "Philanthropic Trust" },
  { num: 4, name: "Legacy Trust" },
];

const newCustomContainer = (): CustomContainer => ({
  id: crypto.randomUUID(),
  title: "Additional Container",
  meta: "Current — · Target —",
  body: "Describe the purpose, constraints, and operating rules for this container.",
});

const newSourceDraft = (kind: CharterSourceKind = "note", mode: CharterSourceInputMode = "text"): CharterSourceDraft => ({
  id: crypto.randomUUID(),
  sourceKind: kind,
  title:
    kind === "statement"
      ? "Account statement"
      : kind === "stabilization_session"
        ? "Stabilization Session"
        : kind === "meeting_transcript"
          ? "Gemini meeting transcript"
          : kind === "link"
            ? "Reference link"
            : "Advisor note",
  inputMode: mode,
  contentText: "",
  sourceUrl: "",
  file: null,
  storedPath: null,
  fileName: null,
  mimeType: null,
});

export default function SovereigntyCharter() {
  const { contactId } = useParams<{ contactId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const googleStatus = useGoogleStatus();
  const syncDriveSources = useSyncCharterDriveSources();
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [ratifying, setRatifying] = useState(false);
  const [sendingForESign, setSendingForESign] = useState(false);
  const [refreshingESign, setRefreshingESign] = useState(false);
  const [cancellingESign, setCancellingESign] = useState(false);
  const [contact, setContact] = useState<ContactRecord | null>(null);
  const [family, setFamily] = useState<FamilyRecord | null>(null);
  const [vineyardAccounts, setVineyardAccounts] = useState<VineyardAccount[]>([]);
  const [storehouses, setStorehouses] = useState<Storehouse[]>([]);
  const [storehouseRules, setStorehouseRules] = useState<StorehouseRule[]>([]);
  const [waterfallPriorities, setWaterfallPriorities] = useState<WaterfallPriority[]>([]);
  const [charter, setCharter] = useState<CharterRecord | null>(null);
  const [charterSources, setCharterSources] = useState<CharterSourceDraft[]>([newSourceDraft("statement", "upload"), newSourceDraft("meeting_transcript", "text")]);
  const [charterSyncStatus, setCharterSyncStatus] = useState<{ lastCheckedAt?: string | null; lastSyncedAt?: string | null; folderId?: string | null; status?: string | null }>({});

  const fullName = useMemo(() => {
    if (!contact) return "";
    return [contact.first_name, contact.last_name].filter(Boolean).join(" ");
  }, [contact]);

  const sourceCharterUrl = contact?.charter_url || family?.charter_document_url || null;

  const protectedAccounts = useMemo(() => vineyardAccounts.filter(isProtectedAccount), [vineyardAccounts]);
  const harvestAccounts = useMemo(() => vineyardAccounts.filter((account) => !isProtectedAccount(account)), [vineyardAccounts]);

  const groupedRules = useMemo(() => {
    return storehouseRules.reduce<Record<string, StorehouseRule[]>>((acc, rule) => {
      const key = rule.storehouse_label || `Storehouse ${rule.storehouse_number}`;
      acc[key] = [...(acc[key] || []), rule];
      return acc;
    }, {});
  }, [storehouseRules]);

  const stewardshipValue = useMemo(() => {
    const vineyard = vineyardAccounts.reduce((sum, account) => sum + (account.current_value || 0), 0);
    const storehouseTotal = storehouses.reduce((sum, storehouse) => sum + (storehouse.current_value || 0), 0);
    return vineyard + storehouseTotal;
  }, [storehouses, vineyardAccounts]);

  const buildDefaultCharter = (
    contactRecord: ContactRecord,
    familyRecord: FamilyRecord | null,
    totalStewardship: number
  ): CharterRecord => {
    const resolvedFullName = [contactRecord.first_name, contactRecord.last_name].filter(Boolean).join(" ");

    return {
      contact_id: contactRecord.id,
      title: `${familyRecord?.name || resolvedFullName} Sovereignty Charter`,
      subtitle: "A constitutional framework for financial governance",
      intro_heading: "Constitutional Framework\nfor Financial Governance",
      intro_callout: `The assets of ${resolvedFullName} are to be governed as a Vineyard designed to serve stability, legacy, and disciplined decision-making rather than short-term reaction.`,
      intro_note: "This portrait format mirrors the Stabilization Map and Quarterly Review so the Charter reads like one unified governance system.",
      mission_of_capital: `The current territory is stewarded toward durable household stability, tax-aware growth, and long-horizon legacy transfer. ${familyRecord?.annual_savings ? `The family is currently tracking approximately ${formatCurrency(familyRecord.annual_savings)} in annual savings capacity.` : "The strategy should define a target after-tax cash flow threshold and a reinvestment discipline."}`,
      vision_20_year: `${familyRecord?.total_family_assets ? `Current tracked family assets are ${formatCurrency(familyRecord.total_family_assets)}.` : `Current tracked stewardship value is ${formatCurrency(totalStewardship)}.`} The long-range objective is to compound core Vineyard assets, protect key reserves, and preserve intergenerational optionality through a deliberate governance structure.`,
      governance_authority: `${resolvedFullName} remains the sovereign decision-maker. ProsperWise serves as Personal CFO, coordinating structure, sequencing, and the architectural integrity of the Charter.`,
      conflict_resolution: `${contactRecord.poa_name ? `Powers of Attorney currently noted: ${contactRecord.poa_name}.` : "Powers of Attorney should be named explicitly."} In incapacity events, this Charter operates as an interpretive guide for aligned decision-making.`,
      fiduciary_alliance: `${contactRecord.lawyer_name || contactRecord.accountant_name ? `Current professionals include ${[contactRecord.lawyer_name, contactRecord.accountant_name].filter(Boolean).join(" and ")}.` : "Legal and tax professionals should be linked to this Charter."} All structural and tax actions remain subject to professional review.`,
      quiet_period: contactRecord.quiet_period_start_date
        ? `A quiet period anchor exists from ${formatDate(contactRecord.quiet_period_start_date)}. New capital events should pause for structured integration before deployment.`
        : "Capital inflows above the family threshold should trigger a quiet period before new deployment decisions are finalized.",
      architecture_intro: "The Vineyard serves as the master container for income-generating assets. Principal is protected by design; only designated harvest should move into storehouse allocation.",
      protected_assets_note: "No protected accounts have been explicitly classified yet.",
      harvest_accounts_note: "No eligible harvest accounts are currently defined.",
      appendix_note: "This appendix condenses the current territory into a printable schedule so the Charter, Stabilization Map, and Quarterly Review all reference the same canonical structure.",
      footer_status: contactRecord.households?.governance_status === "sovereign" ? "Ratified / Sovereign phase" : "Draft / review in progress",
      footer_date_label: formatDate(contactRecord.quiet_period_start_date, "Ratification date to be confirmed"),
      full_markdown: "",
      custom_sections: { pageOne: [], pageTwo: [] },
      // ── Phase 2 structured defaults ──────────────────────────────────────
      transition_summary: "",
      primary_goal: "",
      long_term_strategy: "",
      monitoring_cadence: "Quarterly Governance Review with the ProsperWise Personal CFO.",
      withdrawal_safeguards: "Withdrawals from protected accounts require a documented review against this Charter before execution.",
      roles_responsibilities: `${resolvedFullName} acts as Sovereign. ProsperWise serves as Personal CFO and architectural steward.`,
      professional_coordination: [contactRecord.lawyer_name, contactRecord.accountant_name, contactRecord.executor_name, contactRecord.poa_name].filter(Boolean).join("; ") || "Professional team to be confirmed.",
      secondary_quiet_period_rule: "Material new capital events trigger a 30-day quiet period before deployment decisions.",
      growth_primary_label: "Vineyard — Primary Growth",
      growth_primary_value: null,
      growth_primary_detail: "",
      growth_secondary_label: "Vineyard — Secondary Growth",
      growth_secondary_value: null,
      growth_secondary_detail: "",
      storehouse_liquidity_value: null,
      storehouse_liquidity_detail: "",
      storehouse_strategic_value: null,
      storehouse_strategic_detail: "",
      storehouse_philanthropic_detail: "",
      storehouse_legacy_detail: "",
      harvest_target_income: null,
      harvest_yield_protocol: "",
      harvest_spending_categories: "",
      harvest_review_date: null,
      executor_primary: contactRecord.executor_name || "",
      executor_alternate: "",
      succession_terms: "",
      ratification_signatories: [],
    };
  };

  const normalizeContainerList = (value: unknown): CustomContainer[] => {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const record = item as Record<string, unknown>;
        return {
          id: typeof record.id === "string" && record.id ? record.id : crypto.randomUUID(),
          title: typeof record.title === "string" ? record.title : "Additional Container",
          meta: typeof record.meta === "string" ? record.meta : "",
          body: typeof record.body === "string" ? record.body : "",
        };
      })
      .filter(Boolean) as CustomContainer[];
  };

  const normalizeSignatories = (value: unknown): Signatory[] => {
    if (!Array.isArray(value)) return [];
    return value
      .map((item): Signatory | null => {
        if (!item || typeof item !== "object") return null;
        const record = item as Record<string, unknown>;
        return {
          name: typeof record.name === "string" ? record.name : "",
          role: typeof record.role === "string" ? record.role : "",
          signed_at: typeof record.signed_at === "string" ? record.signed_at : null,
        };
      })
      .filter((s): s is Signatory => s !== null);
  };

  const normalizeCustomSections = (value: unknown): CustomSectionGroups => {
    if (Array.isArray(value)) {
      return {
        pageOne: normalizeContainerList(value),
        pageTwo: [],
      };
    }

    if (!value || typeof value !== "object") {
      return { pageOne: [], pageTwo: [] };
    }

    const record = value as Record<string, unknown>;
    return {
      pageOne: normalizeContainerList(record.pageOne),
      pageTwo: normalizeContainerList(record.pageTwo),
    };
  };

  const load = async () => {
    if (!contactId) return;

    setLoading(true);
    const { data: contactData, error: contactError } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, full_name, family_id, household_id, google_drive_url, charter_url, quiet_period_start_date, households(governance_status), lawyer_name, accountant_name, executor_name, poa_name, email, phone")
      .eq("id", contactId)
      .maybeSingle();

    if (contactError || !contactData) {
      toast.error(contactError?.message || "Charter contact not found");
      setLoading(false);
      return;
    }

    const resolvedContact = contactData as ContactRecord;
    setContact(resolvedContact);

    const familyId = resolvedContact.family_id;
    const [familyRes, vineyardRes, storehousesRes, rulesRes, waterfallRes, charterRes, sourceRes, syncRes] = await Promise.all([
      familyId
        ? supabase.from("families").select("id, name, charter_document_url, total_family_assets, annual_savings, fee_tier").eq("id", familyId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase.from("vineyard_accounts").select("id, account_name, account_number, account_type, current_value, book_value, notes").eq("contact_id", contactId).order("created_at"),
      supabase.from("storehouses").select("id, label, storehouse_number, current_value, book_value, target_value, asset_type, notes, risk_cap").eq("contact_id", contactId).order("storehouse_number"),
      familyId
        ? supabase.from("storehouse_rules").select("id, storehouse_label, storehouse_number, rule_type, rule_description, rule_value").eq("family_id", familyId).order("storehouse_number")
        : Promise.resolve({ data: [], error: null }),
      familyId
        ? supabase.from("waterfall_priorities").select("id, priority_order, priority_label, priority_description, target_amount, is_active").eq("family_id", familyId).order("priority_order")
        : Promise.resolve({ data: [], error: null }),
      supabase.from("sovereignty_charters" as any).select("*").eq("contact_id", contactId).maybeSingle(),
      supabase.from("sovereignty_charter_sources" as any).select("*").eq("contact_id", contactId).order("sort_order"),
      supabase.from("drive_watch_state").select("charter_last_checked_at, charter_last_synced_at, charter_folder_id, charter_sync_status").eq("contact_id", contactId).maybeSingle(),
    ]);

    if (familyRes.error) toast.error(familyRes.error.message);
    if (vineyardRes.error) toast.error(vineyardRes.error.message);
    if (storehousesRes.error) toast.error(storehousesRes.error.message);
    if (rulesRes.error) toast.error(rulesRes.error.message);
    if (waterfallRes.error) toast.error(waterfallRes.error.message);
    if (charterRes.error) toast.error(charterRes.error.message);
    if (sourceRes.error) toast.error(sourceRes.error.message);
    if (syncRes.error) toast.error(syncRes.error.message);

    const resolvedFamily = (familyRes.data as FamilyRecord | null) || null;
    const resolvedVineyard = (vineyardRes.data as VineyardAccount[] | null) || [];
    const resolvedStorehouses = (storehousesRes.data as Storehouse[] | null) || [];
    const resolvedRules = (rulesRes.data as StorehouseRule[] | null) || [];
    const resolvedWaterfalls = ((waterfallRes.data as WaterfallPriority[] | null) || []).filter((item) => item.is_active);

    setFamily(resolvedFamily);
    setVineyardAccounts(resolvedVineyard);
    setStorehouses(resolvedStorehouses);
    setStorehouseRules(resolvedRules);
    setWaterfallPriorities(resolvedWaterfalls);

    const resolvedSources = (((sourceRes.data as unknown) as CharterSourceRecord[] | null) || []).map((source) => ({
      id: source.id,
      sourceKind: source.source_kind,
      title: source.title,
      inputMode: source.input_mode,
      contentText: source.content_text || source.extracted_text || "",
      sourceUrl: source.source_url || "",
      file: null,
      storedPath: source.storage_path,
      fileName: source.file_name,
      mimeType: source.mime_type,
      importOrigin: source.import_origin,
      externalFileId: source.external_file_id,
      externalModifiedAt: source.external_modified_at,
      externalFolderId: source.external_folder_id,
      syncError: source.sync_error,
    }));
    setCharterSources(resolvedSources.length ? resolvedSources : [newSourceDraft("statement", "upload"), newSourceDraft("meeting_transcript", "text")]);
    setCharterSyncStatus({
      lastCheckedAt: syncRes.data?.charter_last_checked_at || null,
      lastSyncedAt: syncRes.data?.charter_last_synced_at || null,
      folderId: syncRes.data?.charter_folder_id || null,
      status: syncRes.data?.charter_sync_status || null,
    });

    const totalStewardship =
      resolvedVineyard.reduce((sum, account) => sum + (account.current_value || 0), 0) +
      resolvedStorehouses.reduce((sum, storehouse) => sum + (storehouse.current_value || 0), 0);

    const baseCharter = buildDefaultCharter(resolvedContact, resolvedFamily, totalStewardship);
    const savedCharter = charterRes.data as unknown as Record<string, unknown> | null;

    if (savedCharter) {
      setCharter({
        ...baseCharter,
        ...savedCharter,
        id: typeof savedCharter.id === "string" ? savedCharter.id : undefined,
        contact_id: resolvedContact.id,
        custom_sections: normalizeCustomSections(savedCharter.custom_sections),
        ratification_signatories: normalizeSignatories(savedCharter.ratification_signatories),
      });
    } else {
      setCharter(baseCharter);
    }

    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [contactId]);

  const updateField = (key: keyof CharterRecord, value: string) => {
    setCharter((current) => (current ? { ...current, [key]: value } : current));
  };

  const updateNumericField = (key: keyof CharterRecord, value: string) => {
    const parsed = value.trim() === "" ? null : Number(value);
    setCharter((current) => (current ? { ...current, [key]: Number.isNaN(parsed as number) ? null : parsed } : current));
  };

  const addSignatory = () => {
    setCharter((current) => current ? {
      ...current,
      ratification_signatories: [...current.ratification_signatories, { name: "", role: "", signed_at: null }],
    } : current);
  };

  const removeSignatory = (index: number) => {
    setCharter((current) => current ? {
      ...current,
      ratification_signatories: current.ratification_signatories.filter((_, i) => i !== index),
    } : current);
  };

  const updateSignatory = (index: number, key: keyof Signatory, value: string) => {
    setCharter((current) => current ? {
      ...current,
      ratification_signatories: current.ratification_signatories.map((s, i) =>
        i === index ? { ...s, [key]: value } : s
      ),
    } : current);
  };

  const updateCustomContainer = (page: keyof CustomSectionGroups, id: string, key: keyof CustomContainer, value: string) => {
    setCharter((current) => {
      if (!current) return current;
      return {
        ...current,
        custom_sections: {
          ...current.custom_sections,
          [page]: current.custom_sections[page].map((section) =>
            section.id === id ? { ...section, [key]: value } : section
          ),
        },
      };
    });
  };

  const addCustomContainer = (page: keyof CustomSectionGroups) => {
    setCharter((current) => {
      if (!current) return current;
      return {
        ...current,
        custom_sections: {
          ...current.custom_sections,
          [page]: [...current.custom_sections[page], newCustomContainer()],
        },
      };
    });
  };

  const removeCustomContainer = (page: keyof CustomSectionGroups, id: string) => {
    setCharter((current) => {
      if (!current) return current;
      return {
        ...current,
        custom_sections: {
          ...current.custom_sections,
          [page]: current.custom_sections[page].filter((section) => section.id !== id),
        },
      };
    });
  };

  const updateSource = (id: string, patch: Partial<CharterSourceDraft>) => {
    setCharterSources((current) => current.map((source) => (source.id === id ? { ...source, ...patch } : source)));
  };

  const addSource = (kind: CharterSourceKind = "note", mode: CharterSourceInputMode = kind === "link" ? "url" : "text") => {
    setCharterSources((current) => [...current, newSourceDraft(kind, mode)]);
  };

  const removeSource = (id: string) => {
    setCharterSources((current) => (current.length > 1 ? current.filter((source) => source.id !== id) : current));
  };

  const handleSourceFileChange = (id: string) => async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    updateSource(id, {
      file,
      storedPath: null,
      fileName: file?.name || null,
      mimeType: file?.type || null,
    });
  };

  const buildDraftPayload = async () => {
    if (!contactId) throw new Error("Contact not found");

    const preparedSources = await Promise.all(
      charterSources.map(async (source) => {
        const title = sanitizeSourceTitle(source.title);
        const inputMode = source.inputMode;

        if (inputMode === "text") {
          const contentText = sanitizeSourceText(source.contentText);
          if (!contentText) throw new Error(`Add text for ${title}`);
          return {
            sourceKind: source.sourceKind,
            title,
            inputMode,
            contentText,
          importOrigin: source.importOrigin,
          externalFileId: source.externalFileId || undefined,
          externalModifiedAt: source.externalModifiedAt || undefined,
          externalFolderId: source.externalFolderId || undefined,
          syncError: source.syncError || undefined,
          };
        }

        if (inputMode === "url") {
          const sourceUrl = sanitizeSourceUrl(source.sourceUrl);
          if (!sourceUrl || !isValidSourceUrl(sourceUrl)) {
            throw new Error(`Enter a valid HTTPS link for ${title}`);
          }
          return {
            sourceKind: source.sourceKind,
            title,
            inputMode,
            sourceUrl,
            importOrigin: source.importOrigin,
            externalFileId: source.externalFileId || undefined,
            externalModifiedAt: source.externalModifiedAt || undefined,
            externalFolderId: source.externalFolderId || undefined,
            syncError: source.syncError || undefined,
          };
        }

        let storagePath = source.storedPath;
        let fileName = source.fileName;
        let mimeType = source.mimeType;

        if (source.file) {
          storagePath = await uploadCharterSourceFile(contactId, source.file);
          fileName = source.file.name;
          mimeType = source.file.type || source.mimeType || undefined;
          updateSource(source.id, { storedPath: storagePath, fileName, mimeType });
        }

        if (!storagePath) throw new Error(`Upload a file for ${title}`);

        return {
          sourceKind: source.sourceKind,
          title,
          inputMode,
          storagePath,
          fileName,
          mimeType,
          importOrigin: source.importOrigin,
          externalFileId: source.externalFileId || undefined,
          externalModifiedAt: source.externalModifiedAt || undefined,
          externalFolderId: source.externalFolderId || undefined,
          syncError: source.syncError || undefined,
        };
      })
    );

    return {
      contactId,
      charterId: charter?.id,
      sources: preparedSources,
    };
  };

  const generateDraft = async () => {
    if (!contactId) return;
    setDrafting(true);
    try {
      const payload = await buildDraftPayload();
      const data = await draftSovereigntyCharter(payload);

      if (data?.charter) {
        const savedCharter = data.charter as Record<string, unknown>;
        setCharter((current) => current ? {
          ...current,
          ...savedCharter,
          id: typeof savedCharter.id === "string" ? savedCharter.id : current.id,
          full_markdown: typeof savedCharter.full_markdown === "string" ? savedCharter.full_markdown : current.full_markdown,
          custom_sections: normalizeCustomSections(savedCharter.custom_sections),
          ratification_signatories: normalizeSignatories(savedCharter.ratification_signatories),
        } : current);
      }

      if (Array.isArray(data?.sources)) {
        setCharterSources((data.sources as CharterSourceRecord[]).map((source) => ({
          id: source.id,
          sourceKind: source.source_kind,
          title: source.title,
          inputMode: source.input_mode,
          contentText: source.content_text || source.extracted_text || "",
          sourceUrl: source.source_url || "",
          file: null,
          storedPath: source.storage_path,
          fileName: source.file_name,
          mimeType: source.mime_type,
          importOrigin: source.import_origin,
          externalFileId: source.external_file_id,
          externalModifiedAt: source.external_modified_at,
          externalFolderId: source.external_folder_id,
          syncError: source.sync_error,
        })));
      }

      toast.success(data?.summary || "Initial charter draft generated");
      setEditing(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to generate charter draft");
    } finally {
      setDrafting(false);
    }
  };

  const syncCharterFolder = async () => {
    if (!contactId) return;
    try {
      const data = await syncDriveSources.mutateAsync(contactId);
      if (Array.isArray(data?.sources)) {
        setCharterSources((data.sources as CharterSourceRecord[]).map((source) => ({
          id: source.id,
          sourceKind: source.source_kind,
          title: source.title,
          inputMode: source.input_mode,
          contentText: source.content_text || source.extracted_text || "",
          sourceUrl: source.source_url || "",
          file: null,
          storedPath: source.storage_path,
          fileName: source.file_name,
          mimeType: source.mime_type,
          importOrigin: source.import_origin,
          externalFileId: source.external_file_id,
          externalModifiedAt: source.external_modified_at,
          externalFolderId: source.external_folder_id,
          syncError: source.sync_error,
        })));
      }

      setCharterSyncStatus({
        lastCheckedAt: data?.charterLastCheckedAt || new Date().toISOString(),
        lastSyncedAt: data?.charterLastSyncedAt || (data?.importedCount > 0 ? new Date().toISOString() : charterSyncStatus.lastSyncedAt),
        folderId: data?.folderId || charterSyncStatus.folderId || null,
        status: data?.status || "idle",
      });

      toast.success(data?.message || "Charter Drive folder synced");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to sync charter folder");
    }
  };

  const sendCharterForESign = async () => {
    if (!charter?.id) {
      toast.error("Save the charter before marking it sent for signature");
      return;
    }
    if (!user?.id) {
      toast.error("You must be signed in");
      return;
    }
    setSendingForESign(true);
    try {
      const { error } = await supabase
        .from("sovereignty_charters" as any)
        .update({
          esign_status: "sent",
          esign_sent_at: new Date().toISOString(),
          esign_initiated_by: user.id,
          esign_doc_id: null,
          esign_doc_url: null,
          esign_error: null,
        })
        .eq("id", charter.id);
      if (error) throw error;
      toast.success(
        "Marked as sent for signature. Use Print / PDF to save the charter to the contact's Drive 'Sovereignty Charter Sources' folder, then send it via Adobe Sign. The signed PDF (filename containing 'Completed-Adobe Sign') will auto-ratify the charter when it lands back in that folder.",
        { duration: 12000 },
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to mark as sent for signature");
    } finally {
      setSendingForESign(false);
    }
  };

  const refreshESignStatus = async () => {
    if (!charter?.id) return;
    setRefreshingESign(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/charter-esign-poll`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ charter_id: charter.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to check signature status");
      const result = data.results?.[0];
      if (result?.status === "ratified") toast.success("Signatures complete — charter ratified");
      else if (result?.status === "pending") toast.info("Still awaiting signatures");
      else if (result?.status === "error") toast.error(result.note || "Status check error");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to refresh status");
    } finally {
      setRefreshingESign(false);
    }
  };

  const cancelESignRequest = async () => {
    if (!charter?.id) return;
    if (!confirm("Cancel this e-signature request? The PDF already in Google Drive will not be deleted — remove it manually if needed. You can then re-send for signature.")) return;
    setCancellingESign(true);
    try {
      const { error } = await supabase
        .from("sovereignty_charters" as any)
        .update({
          esign_status: "not_sent",
          esign_doc_id: null,
          esign_doc_url: null,
          esign_initiated_by: null,
          esign_last_checked_at: null,
          esign_error: null,
        })
        .eq("id", charter.id);
      if (error) throw error;
      toast.success("E-signature request cancelled");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to cancel e-signature request");
    } finally {
      setCancellingESign(false);
    }
  };

  const ratifyCharter = async () => {
    if (!charter?.id || !contactId) {
      toast.error("Save or generate the charter before ratifying it");
      return;
    }

    setRatifying(true);
    const ratifiedAt = new Date().toISOString();
    const footerDateLabel = formatDate(ratifiedAt);
    const footerStatus = "Ratified / Sovereign phase";

    const { error: charterError } = await supabase
      .from("sovereignty_charters" as any)
      .update({
        draft_status: "ratified",
        ratified_at: ratifiedAt,
        ratified_by: user?.id || null,
        footer_status: footerStatus,
        footer_date_label: footerDateLabel,
      })
      .eq("id", charter.id);

    if (charterError) {
      setRatifying(false);
      toast.error(charterError.message);
      return;
    }

    const { error: contactError } = await supabase
      .from("contacts")
      .update({ charter_url: `/sovereignty-charter/contact/${contactId}` })
      .eq("id", contactId);

    setRatifying(false);

    if (contactError) {
      toast.error(contactError.message);
      return;
    }

    toast.success("Charter ratified and linked to the portal");
    await load();
  };

  const persistCharter = async (current: CharterRecord): Promise<boolean> => {
    if (!contactId) return false;

    const payload = {
      contact_id: contactId,
      title: current.title,
      subtitle: current.subtitle,
      intro_heading: current.intro_heading,
      intro_callout: current.intro_callout,
      intro_note: current.intro_note,
      mission_of_capital: current.mission_of_capital,
      vision_20_year: current.vision_20_year,
      governance_authority: current.governance_authority,
      conflict_resolution: current.conflict_resolution,
      fiduciary_alliance: current.fiduciary_alliance,
      quiet_period: current.quiet_period,
      architecture_intro: current.architecture_intro,
      protected_assets_note: current.protected_assets_note,
      harvest_accounts_note: current.harvest_accounts_note,
      appendix_note: current.appendix_note,
      footer_status: current.footer_status,
      footer_date_label: current.footer_date_label,
      full_markdown: current.full_markdown,
      custom_sections: current.custom_sections,
      transition_summary: current.transition_summary,
      primary_goal: current.primary_goal,
      long_term_strategy: current.long_term_strategy,
      monitoring_cadence: current.monitoring_cadence,
      withdrawal_safeguards: current.withdrawal_safeguards,
      roles_responsibilities: current.roles_responsibilities,
      professional_coordination: current.professional_coordination,
      secondary_quiet_period_rule: current.secondary_quiet_period_rule,
      growth_primary_label: current.growth_primary_label,
      growth_primary_value: current.growth_primary_value,
      growth_primary_detail: current.growth_primary_detail,
      growth_secondary_label: current.growth_secondary_label,
      growth_secondary_value: current.growth_secondary_value,
      growth_secondary_detail: current.growth_secondary_detail,
      storehouse_liquidity_value: current.storehouse_liquidity_value,
      storehouse_liquidity_detail: current.storehouse_liquidity_detail,
      storehouse_strategic_value: current.storehouse_strategic_value,
      storehouse_strategic_detail: current.storehouse_strategic_detail,
      storehouse_philanthropic_detail: current.storehouse_philanthropic_detail,
      storehouse_legacy_detail: current.storehouse_legacy_detail,
      harvest_target_income: current.harvest_target_income,
      harvest_yield_protocol: current.harvest_yield_protocol,
      harvest_spending_categories: current.harvest_spending_categories,
      harvest_review_date: current.harvest_review_date,
      executor_primary: current.executor_primary,
      executor_alternate: current.executor_alternate,
      succession_terms: current.succession_terms,
      ratification_signatories: current.ratification_signatories,
    };

    const query = current.id
      ? supabase.from("sovereignty_charters" as any).update(payload).eq("id", current.id)
      : supabase.from("sovereignty_charters" as any).insert(payload).select("id").single();

    const { data, error } = await query;
    if (error) {
      toast.error(error.message);
      return false;
    }

    const insertedCharter = data as { id?: string } | null;
    if (!current.id && insertedCharter?.id) {
      setCharter((c) => (c ? { ...c, id: insertedCharter.id } : c));
    }
    return true;
  };

  const autoSave = useAutoSave<CharterRecord>({
    data: charter,
    enabled: editing,
    autoDetectDirty: true,
    onSave: persistCharter,
  });

  const save = async () => {
    const ok = await autoSave.flush();
    if (ok) {
      toast.success("Sovereignty Charter saved");
      setEditing(false);
      load();
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!contact || !charter) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Charter contact not found.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/contacts")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Contacts
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fafafa]">
      <div className="print:hidden sticky top-0 z-20 border-b border-[#e2e8f0] bg-[#fafafa]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <div className="text-sm text-[#334155]">
              <span className="font-semibold">Sovereignty Charter</span>
              <span className="ml-2 text-xs uppercase tracking-wider text-[#a37c58]">Portrait template</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {editing && <AutoSaveIndicator status={autoSave} />}
            {editing ? (
              <>
                <Button size="sm" variant="outline" onClick={async () => {
                  if (autoSave.isDirty) await autoSave.flush();
                  setEditing(false);
                  load();
                }}>
                  Done
                </Button>
                <Button size="sm" variant="outline" onClick={generateDraft} disabled={autoSave.saving || drafting}>
                  {drafting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <WandSparkles className="mr-2 h-4 w-4" />}
                  Generate draft
                </Button>
                <Button size="sm" onClick={save} disabled={autoSave.saving}>
                  {autoSave.saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save & Close
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  <Pencil className="mr-2 h-4 w-4" /> Edit
                </Button>
                <Button size="sm" variant="outline" onClick={generateDraft} disabled={drafting}>
                  {drafting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  Refresh with AI
                </Button>
                <Button size="sm" variant="outline" onClick={syncCharterFolder} disabled={syncDriveSources.isPending || !contact.google_drive_url || !googleStatus.data?.connected}>
                  {syncDriveSources.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderSync className="mr-2 h-4 w-4" />}
                  Sync Drive folder
                </Button>
                {charter.draft_status === "ratified" || charter.esign_status === "ratified" ? (
                  <Button size="sm" disabled variant="outline">
                    <CheckCircle2 className="mr-2 h-4 w-4 text-success" />
                    Ratified {charter.esign_signed_at ? `· ${formatDate(charter.esign_signed_at, "")}` : ""}
                  </Button>
                ) : charter.esign_status === "sent" ? (
                  <>
                    <Button size="sm" variant="outline" disabled>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Awaiting signed PDF in Drive
                    </Button>
                    <Button size="sm" variant="outline" onClick={refreshESignStatus} disabled={refreshingESign}>
                      {refreshingESign ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                      Check status
                    </Button>
                    <Button size="sm" variant="outline" onClick={cancelESignRequest} disabled={cancellingESign}>
                      {cancellingESign ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                      Cancel request
                    </Button>
                  </>
                ) : (
                  <Button size="sm" onClick={sendCharterForESign} disabled={sendingForESign}>
                    {sendingForESign ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                    Mark as Sent for Signature
                  </Button>
                )}
                {sourceCharterUrl && (
                  <Button size="sm" variant="outline" asChild>
                    <a href={sourceCharterUrl} target="_blank" rel="noreferrer noopener">
                      <ExternalLink className="mr-2 h-4 w-4" /> Open source
                    </a>
                  </Button>
                )}
                <Button size="sm" onClick={() => window.print()}>
                  <Printer className="mr-2 h-4 w-4" /> Print / PDF
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {editing && (
        <div className="mx-auto max-w-[1100px] px-6 py-6 print:hidden">
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-6 rounded-lg border border-border bg-card p-5 shadow-sm">
              <div className="rounded-lg border border-border bg-muted/20 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">AI drafting workflow</p>
                    <p className="text-sm text-muted-foreground">Upload statements, paste Stabilization Session notes, or add Gemini transcript links before generating the first charter draft.</p>
                  </div>
                  <div className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
                    Status: {charter.draft_status || "draft"}
                  </div>
                </div>
                {charter.generation_summary ? (
                  <p className="mt-3 text-sm text-muted-foreground">{charter.generation_summary}</p>
                ) : null}
              </div>

              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Drive intake folder</p>
                    <p className="text-sm text-muted-foreground">Auto-syncs the fixed <span className="font-medium text-foreground">Sovereignty Charter Sources</span> subfolder inside this contact’s Drive folder.</p>
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={syncCharterFolder} disabled={syncDriveSources.isPending || !contact.google_drive_url || !googleStatus.data?.connected}>
                    {syncDriveSources.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderSync className="mr-2 h-4 w-4" />}
                    Sync now
                  </Button>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">Connection</p>
                    <p className="mt-1">{googleStatus.data?.connected ? "Google Drive connected" : "Connect Google Drive to enable folder sync"}</p>
                    <p className="mt-2 break-all text-xs">{contact.google_drive_url || "No contact Drive folder linked yet."}</p>
                  </div>
                  <div className="rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">Sync activity</p>
                    <p className="mt-1">Status: {charterSyncStatus.status || "idle"}</p>
                    <p className="mt-1">Last checked: {formatDate(charterSyncStatus.lastCheckedAt, "Not yet checked")}</p>
                    <p className="mt-1">Last import: {formatDate(charterSyncStatus.lastSyncedAt, "No imports yet")}</p>
                  </div>
                </div>
              </div>

              <CharterSourceEditor
                sources={charterSources}
                onAdd={addSource}
                onRemove={removeSource}
                onUpdate={updateSource}
                onFileChange={handleSourceFileChange}
              />

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Document Title">
                  <Input value={charter.title} onChange={(e) => updateField("title", e.target.value)} />
                </Field>
                <Field label="Subtitle">
                  <Input value={charter.subtitle} onChange={(e) => updateField("subtitle", e.target.value)} />
                </Field>
              </div>

              <Field label="Intro Heading">
                <Textarea value={charter.intro_heading} onChange={(e) => updateField("intro_heading", e.target.value)} rows={2} />
              </Field>
              <Field label="Intro Callout">
                <Textarea value={charter.intro_callout} onChange={(e) => updateField("intro_callout", e.target.value)} rows={4} />
              </Field>
              <Field label="Intro Note">
                <Textarea value={charter.intro_note} onChange={(e) => updateField("intro_note", e.target.value)} rows={3} />
              </Field>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Mission of Capital">
                  <Textarea value={charter.mission_of_capital} onChange={(e) => updateField("mission_of_capital", e.target.value)} rows={5} />
                </Field>
                <Field label="20-Year Vision">
                  <Textarea value={charter.vision_20_year} onChange={(e) => updateField("vision_20_year", e.target.value)} rows={5} />
                </Field>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Governance & Authority">
                  <Textarea value={charter.governance_authority} onChange={(e) => updateField("governance_authority", e.target.value)} rows={5} />
                </Field>
                <Field label="Conflict Resolution & Representation">
                  <Textarea value={charter.conflict_resolution} onChange={(e) => updateField("conflict_resolution", e.target.value)} rows={5} />
                </Field>
                <Field label="Fiduciary Alliance">
                  <Textarea value={charter.fiduciary_alliance} onChange={(e) => updateField("fiduciary_alliance", e.target.value)} rows={5} />
                </Field>
                <Field label="Secondary Quiet Period">
                  <Textarea value={charter.quiet_period} onChange={(e) => updateField("quiet_period", e.target.value)} rows={5} />
                </Field>
              </div>
            </div>

            <div className="space-y-6 rounded-lg border border-border bg-card p-5 shadow-sm">
              <Field label="Architecture Intro">
                <Textarea value={charter.architecture_intro} onChange={(e) => updateField("architecture_intro", e.target.value)} rows={4} />
              </Field>
              <Field label="Protected Assets Empty State">
                <Textarea value={charter.protected_assets_note} onChange={(e) => updateField("protected_assets_note", e.target.value)} rows={3} />
              </Field>
              <Field label="Harvest Accounts Empty State">
                <Textarea value={charter.harvest_accounts_note} onChange={(e) => updateField("harvest_accounts_note", e.target.value)} rows={3} />
              </Field>
              <Field label="Appendix Note">
                <Textarea value={charter.appendix_note} onChange={(e) => updateField("appendix_note", e.target.value)} rows={3} />
              </Field>
              <Field label="Footer Status">
                <Input value={charter.footer_status} onChange={(e) => updateField("footer_status", e.target.value)} />
              </Field>
              <Field label="Footer Date Label">
                <Input value={charter.footer_date_label} onChange={(e) => updateField("footer_date_label", e.target.value)} />
              </Field>
            </div>
          </div>

          {/* ── Phase 2: Structured Charter Fields (AI-populated) ──────────── */}
          <div className="mt-6 space-y-6 rounded-lg border border-border bg-card p-5 shadow-sm">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Strategic Narrative</h3>
              <p className="text-sm text-muted-foreground">AI-extracted strategic context from the Charter sources. Edit freely.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Transition Summary">
                <Textarea value={charter.transition_summary} onChange={(e) => updateField("transition_summary", e.target.value)} rows={4} />
              </Field>
              <Field label="Primary Goal">
                <Textarea value={charter.primary_goal} onChange={(e) => updateField("primary_goal", e.target.value)} rows={4} />
              </Field>
              <Field label="Long-Term Strategy">
                <Textarea value={charter.long_term_strategy} onChange={(e) => updateField("long_term_strategy", e.target.value)} rows={4} />
              </Field>
              <Field label="Monitoring Cadence">
                <Textarea value={charter.monitoring_cadence} onChange={(e) => updateField("monitoring_cadence", e.target.value)} rows={4} />
              </Field>
              <Field label="Withdrawal Safeguards">
                <Textarea value={charter.withdrawal_safeguards} onChange={(e) => updateField("withdrawal_safeguards", e.target.value)} rows={4} />
              </Field>
              <Field label="Roles & Responsibilities">
                <Textarea value={charter.roles_responsibilities} onChange={(e) => updateField("roles_responsibilities", e.target.value)} rows={4} />
              </Field>
              <Field label="Professional Coordination">
                <Textarea value={charter.professional_coordination} onChange={(e) => updateField("professional_coordination", e.target.value)} rows={4} />
              </Field>
              <Field label="Secondary Quiet Period Rule">
                <Textarea value={charter.secondary_quiet_period_rule} onChange={(e) => updateField("secondary_quiet_period_rule", e.target.value)} rows={4} />
              </Field>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-foreground">Vineyard — Growth Allocations</h3>
              <p className="text-sm text-muted-foreground">Primary and secondary growth pillars within the Vineyard.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Primary Growth Label">
                <Input value={charter.growth_primary_label} onChange={(e) => updateField("growth_primary_label", e.target.value)} />
              </Field>
              <Field label="Primary Growth Value (CAD)">
                <Input type="number" value={charter.growth_primary_value ?? ""} onChange={(e) => updateNumericField("growth_primary_value", e.target.value)} />
              </Field>
              <Field label="Primary Growth Detail">
                <Textarea value={charter.growth_primary_detail} onChange={(e) => updateField("growth_primary_detail", e.target.value)} rows={3} />
              </Field>
              <Field label="Secondary Growth Label">
                <Input value={charter.growth_secondary_label} onChange={(e) => updateField("growth_secondary_label", e.target.value)} />
              </Field>
              <Field label="Secondary Growth Value (CAD)">
                <Input type="number" value={charter.growth_secondary_value ?? ""} onChange={(e) => updateNumericField("growth_secondary_value", e.target.value)} />
              </Field>
              <Field label="Secondary Growth Detail">
                <Textarea value={charter.growth_secondary_detail} onChange={(e) => updateField("growth_secondary_detail", e.target.value)} rows={3} />
              </Field>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-foreground">Storehouse Allocations</h3>
              <p className="text-sm text-muted-foreground">Targeted reserves for liquidity, strategic, philanthropic, and legacy purposes.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Liquidity Reserve Value (CAD)">
                <Input type="number" value={charter.storehouse_liquidity_value ?? ""} onChange={(e) => updateNumericField("storehouse_liquidity_value", e.target.value)} />
              </Field>
              <Field label="Liquidity Reserve Detail">
                <Textarea value={charter.storehouse_liquidity_detail} onChange={(e) => updateField("storehouse_liquidity_detail", e.target.value)} rows={3} />
              </Field>
              <Field label="Strategic Reserve Value (CAD)">
                <Input type="number" value={charter.storehouse_strategic_value ?? ""} onChange={(e) => updateNumericField("storehouse_strategic_value", e.target.value)} />
              </Field>
              <Field label="Strategic Reserve Detail">
                <Textarea value={charter.storehouse_strategic_detail} onChange={(e) => updateField("storehouse_strategic_detail", e.target.value)} rows={3} />
              </Field>
              <Field label="Philanthropic Trust Detail">
                <Textarea value={charter.storehouse_philanthropic_detail} onChange={(e) => updateField("storehouse_philanthropic_detail", e.target.value)} rows={3} />
              </Field>
              <Field label="Legacy Trust Detail">
                <Textarea value={charter.storehouse_legacy_detail} onChange={(e) => updateField("storehouse_legacy_detail", e.target.value)} rows={3} />
              </Field>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-foreground">Harvest Protocol</h3>
              <p className="text-sm text-muted-foreground">Income drawn from protected accounts and the rules around it.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Annual Harvest Target Income (CAD)">
                <Input type="number" value={charter.harvest_target_income ?? ""} onChange={(e) => updateNumericField("harvest_target_income", e.target.value)} />
              </Field>
              <Field label="Harvest Review Date">
                <Input type="date" value={charter.harvest_review_date ?? ""} onChange={(e) => updateField("harvest_review_date", e.target.value)} />
              </Field>
              <Field label="Harvest Yield Protocol">
                <Textarea value={charter.harvest_yield_protocol} onChange={(e) => updateField("harvest_yield_protocol", e.target.value)} rows={3} />
              </Field>
              <Field label="Harvest Spending Categories">
                <Textarea value={charter.harvest_spending_categories} onChange={(e) => updateField("harvest_spending_categories", e.target.value)} rows={3} />
              </Field>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-foreground">Succession & Ratification</h3>
              <p className="text-sm text-muted-foreground">Executor lineage, succession terms, and signatories.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Primary Executor">
                <Input value={charter.executor_primary} onChange={(e) => updateField("executor_primary", e.target.value)} />
              </Field>
              <Field label="Alternate Executor">
                <Input value={charter.executor_alternate} onChange={(e) => updateField("executor_alternate", e.target.value)} />
              </Field>
            </div>
            <Field label="Succession Terms">
              <Textarea value={charter.succession_terms} onChange={(e) => updateField("succession_terms", e.target.value)} rows={4} />
            </Field>

            <SignatoriesEditor
              signatories={charter.ratification_signatories}
              onAdd={addSignatory}
              onRemove={removeSignatory}
              onUpdate={updateSignatory}
            />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <CustomContainerEditor
              title="Page 1 Additional Containers"
              description="These render as constitutional article cards on Page 1."
              emptyLabel="No Page 1 containers yet."
              sections={charter.custom_sections.pageOne}
              onAdd={() => addCustomContainer("pageOne")}
              onRemove={(id) => removeCustomContainer("pageOne", id)}
              onUpdate={(id, key, value) => updateCustomContainer("pageOne", id, key, value)}
            />
            <CustomContainerEditor
              title="Page 2 Additional Containers"
              description="These render as architecture containers on Page 2."
              emptyLabel="No Page 2 containers yet."
              sections={charter.custom_sections.pageTwo}
              onAdd={() => addCustomContainer("pageTwo")}
              onRemove={(id) => removeCustomContainer("pageTwo", id)}
              onUpdate={(id, key, value) => updateCustomContainer("pageTwo", id, key, value)}
            />
          </div>
        </div>
      )}

      <div id="charter-printable-root" className="mx-auto max-w-[210mm] px-6 py-6 print:p-0 print:max-w-none">
        {(charter.generation_summary || charter.last_generated_at || charter.ratified_at) && (
          <div className="mb-6 rounded-lg border border-border bg-card p-4 print:hidden">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Draft lifecycle</p>
                <p className="text-sm text-muted-foreground">{charter.generation_summary || "This charter is ready for review and ratification."}</p>
              </div>
              <div className="space-y-1 text-right text-xs text-muted-foreground">
                {charter.last_generated_at ? <div>Last AI draft: {formatDate(charter.last_generated_at, charter.last_generated_at)}</div> : null}
                {charter.ratified_at ? <div>Ratified: {formatDate(charter.ratified_at, charter.ratified_at)}</div> : null}
              </div>
            </div>
          </div>
        )}

        <div className={pageWrap} style={pageStyle}>
          <div style={{ backgroundColor: "#1e293b", color: "#fff", padding: "10mm 12mm 9mm" }}>
            <img src={pwLogoWhite} alt="ProsperWise" style={{ width: "54mm", height: "auto", display: "block", marginBottom: "4mm" }} />
            <div style={{ fontSize: "8pt", fontWeight: 300, color: "rgba(255,255,255,.55)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: "4mm" }}>
              Sovereignty Operating System™
            </div>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "24pt", fontWeight: 300, lineHeight: 1.08 }}>
              {charter.title}
            </div>
            <div style={{ fontSize: "8pt", color: "rgba(255,255,255,.7)", marginTop: "2.5mm" }}>
              {charter.subtitle}
            </div>
          </div>

          <div style={{ padding: "12mm", display: "flex", flexDirection: "column", gap: "6mm" }}>
            <div>
              <div style={{ fontSize: "7.5pt", letterSpacing: ".1em", textTransform: "uppercase", color: "#94a3b8", marginBottom: "1.5mm" }}>
                Sovereignty Charter &nbsp;·&nbsp; Prepared for <strong>{fullName}</strong>
              </div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "25pt", fontWeight: 300, color: "#334155", lineHeight: 1.1, whiteSpace: "pre-line" }}>
                {charter.intro_heading}
              </div>
              <hr style={{ width: "18mm", height: "3px", background: "#a37c58", border: "none", marginTop: "2.5mm" }} />
            </div>

            <div style={{ background: "#fafafa", borderLeft: "3px solid #a37c58", padding: "3mm 5mm", display: "flex", flexDirection: "column", gap: "1.5mm" }}>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "7.5pt", fontWeight: 400, fontStyle: "italic", color: "#334155", lineHeight: 1.55 }}>
                {charter.intro_callout}
              </div>
              <div style={{ fontSize: "7.5pt", color: "#334155" }}>
                {charter.intro_note}
              </div>
              {charter.transition_summary?.trim() ? (
                <div style={{ fontSize: "7.5pt", color: "#334155", borderTop: "1px dashed #e2e8f0", paddingTop: "1.8mm", marginTop: "0.5mm" }}>
                  <strong style={{ color: "#1e293b" }}>Transition context: </strong>{charter.transition_summary}
                </div>
              ) : null}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5mm" }}>
              <SectionCard title="Mission of Capital" body={charter.mission_of_capital} />
              <SectionCard title="20-Year Vision" body={charter.vision_20_year} />
            </div>

            {charter.primary_goal?.trim() ? (
              <SectionCard title="Primary Goal of This Charter" body={charter.primary_goal} />
            ) : null}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5mm" }}>
              <ArticleCard title="Governance & Authority" body={charter.governance_authority} />
              <ArticleCard title="Conflict Resolution & Representation" body={charter.conflict_resolution} />
              <ArticleCard title="Fiduciary Alliance" body={charter.fiduciary_alliance} />
              <ArticleCard title="Secondary Quiet Period" body={charter.quiet_period} />
            </div>

            {charter.custom_sections.pageOne.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5mm" }}>
                {charter.custom_sections.pageOne.map((section) => (
                  <PageOneContainerCard
                    key={`page-one-${section.id}`}
                    title={section.title}
                    meta={section.meta}
                    body={section.body}
                  />
                ))}
              </div>
            ) : null}
          </div>

          <div style={{ background: "#a37c58", color: "#fff", marginTop: "auto", padding: "3mm 12mm", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: "8.5pt", fontWeight: 500, maxWidth: "75%" }}>
              Ratification status: {charter.footer_status}
            </div>
            <div style={{ fontSize: "7.5pt", opacity: 0.9 }}>{charter.footer_date_label}</div>
          </div>
        </div>

        <div className={`${pageWrap} print-page-break`} style={{ ...pageStyle, marginTop: "6mm" }}>
          <div style={{ backgroundColor: "#1e293b", color: "#fff", padding: "9mm 12mm 8mm" }}>
            <div style={{ fontSize: "8pt", fontWeight: 300, color: "rgba(255,255,255,.55)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: "3mm" }}>
              Charter Architecture
            </div>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "23pt", fontWeight: 300, lineHeight: 1.08 }}>
              Vineyard Protocol & Storehouses
            </div>
          </div>

          <div style={{ padding: "12mm", display: "flex", flexDirection: "column", gap: "6mm" }}>
            {(charter.growth_primary_detail || charter.growth_secondary_detail) ? (
              <div>
                <div style={{ fontSize: "6.5pt", letterSpacing: ".12em", textTransform: "uppercase", color: "#94a3b8", marginBottom: "2mm" }}>Vineyard Growth Allocation</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4mm" }}>
                  {charter.growth_primary_detail ? (
                    <ContainerCard
                      title={charter.growth_primary_label || "Primary Growth"}
                      items={charter.growth_primary_detail.split("\n").map((s) => s.trim()).filter(Boolean)}
                    />
                  ) : null}
                  {charter.growth_secondary_detail ? (
                    <ContainerCard
                      title={charter.growth_secondary_label || "Secondary Growth"}
                      items={charter.growth_secondary_detail.split("\n").map((s) => s.trim()).filter(Boolean)}
                    />
                  ) : null}
                </div>
              </div>
            ) : null}

            {(charter.storehouse_liquidity_detail || charter.storehouse_strategic_detail || charter.storehouse_legacy_detail || charter.storehouse_philanthropic_detail) ? (
              <div>
                <div style={{ fontSize: "6.5pt", letterSpacing: ".12em", textTransform: "uppercase", color: "#94a3b8", marginBottom: "2mm" }}>Storehouse Strategic Notes</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4mm" }}>
                  {charter.storehouse_liquidity_detail ? (
                    <ContainerCard
                      title="Liquidity Reserve"
                      items={charter.storehouse_liquidity_detail.split("\n").map((s) => s.trim()).filter(Boolean)}
                    />
                  ) : null}
                  {charter.storehouse_strategic_detail ? (
                    <ContainerCard
                      title="Strategic Reserve"
                      items={charter.storehouse_strategic_detail.split("\n").map((s) => s.trim()).filter(Boolean)}
                    />
                  ) : null}
                  {charter.storehouse_philanthropic_detail ? (
                    <ContainerCard
                      title="Philanthropic Storehouse"
                      items={charter.storehouse_philanthropic_detail.split("\n").map((s) => s.trim()).filter(Boolean)}
                    />
                  ) : null}
                  {charter.storehouse_legacy_detail ? (
                    <ContainerCard
                      title="Legacy Storehouse"
                      items={charter.storehouse_legacy_detail.split("\n").map((s) => s.trim()).filter(Boolean)}
                    />
                  ) : null}
                </div>
              </div>
            ) : null}

            {(charter.harvest_yield_protocol || charter.harvest_spending_categories) ? (
              <div>
                <div style={{ fontSize: "6.5pt", letterSpacing: ".12em", textTransform: "uppercase", color: "#94a3b8", marginBottom: "2mm" }}>Harvest Protocol</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4mm" }}>
                  {charter.harvest_yield_protocol ? (
                    <ArticleCard title="Yield Protocol" body={charter.harvest_yield_protocol} />
                  ) : null}
                  {charter.harvest_spending_categories ? (
                    <ArticleCard title="Spending Categories" body={charter.harvest_spending_categories} />
                  ) : null}
                </div>
              </div>
            ) : null}

            {charter.custom_sections.pageTwo.length > 0 ? (
              <div>
                <div style={{ fontSize: "6.5pt", letterSpacing: ".12em", textTransform: "uppercase", color: "#94a3b8", marginBottom: "2mm" }}>Strategic Narratives</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4mm" }}>
                  {charter.custom_sections.pageTwo.map((section) => (
                    <PageOneContainerCard
                      key={`page-two-${section.id}`}
                      title={section.title}
                      meta={section.meta}
                      body={section.body}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {(charter.long_term_strategy || charter.monitoring_cadence || charter.withdrawal_safeguards || charter.roles_responsibilities || charter.professional_coordination || charter.executor_primary || charter.executor_alternate || charter.succession_terms || charter.ratification_signatories.length > 0) ? (
          <div className={`${pageWrap} print-page-break`} style={{ ...pageStyle, marginTop: "6mm" }}>
            <div style={{ backgroundColor: "#1e293b", color: "#fff", padding: "9mm 12mm 8mm" }}>
              <div style={{ fontSize: "8pt", fontWeight: 300, color: "rgba(255,255,255,.55)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: "3mm" }}>
                Strategic Stewardship
              </div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "23pt", fontWeight: 300, lineHeight: 1.08 }}>
                Long-Term Strategy, Roles & Succession
              </div>
            </div>

            <div style={{ padding: "12mm", display: "flex", flexDirection: "column", gap: "5mm" }}>
              {charter.long_term_strategy ? (
                <ArticleCard title="Long-Term Strategy" body={charter.long_term_strategy} />
              ) : null}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5mm" }}>
                {charter.monitoring_cadence ? (
                  <SectionCard title="Monitoring Cadence" body={charter.monitoring_cadence} />
                ) : null}
                {charter.withdrawal_safeguards ? (
                  <SectionCard title="Withdrawal Safeguards" body={charter.withdrawal_safeguards} />
                ) : null}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5mm" }}>
                {charter.roles_responsibilities ? (
                  <ArticleCard title="Roles & Responsibilities" body={charter.roles_responsibilities} />
                ) : null}
                {charter.professional_coordination ? (
                  <ArticleCard title="Professional Coordination" body={charter.professional_coordination} />
                ) : null}
              </div>

              {(charter.executor_primary || charter.executor_alternate || charter.succession_terms) ? (
                <div>
                  <div style={{ fontSize: "6.5pt", letterSpacing: ".12em", textTransform: "uppercase", color: "#94a3b8", marginBottom: "2mm" }}>Succession Plan</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4mm" }}>
                    {charter.executor_primary ? (
                      <MetricCard label="Primary Executor" value={charter.executor_primary} />
                    ) : null}
                    {charter.executor_alternate ? (
                      <MetricCard label="Alternate Executor" value={charter.executor_alternate} />
                    ) : null}
                  </div>
                  {charter.succession_terms ? (
                    <div style={{ marginTop: "4mm" }}>
                      <ArticleCard title="Succession Terms" body={charter.succession_terms} />
                    </div>
                  ) : null}
                </div>
              ) : null}

              {charter.ratification_signatories.length > 0 ? (
                <div>
                  <div style={{ fontSize: "6.5pt", letterSpacing: ".12em", textTransform: "uppercase", color: "#94a3b8", marginBottom: "2mm" }}>Ratification Signatories</div>
                  <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                    <thead>
                      <tr style={{ background: "#fafafa" }}>
                        <th style={{ fontSize: "7pt", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: ".08em", padding: "2.4mm 2mm", borderBottom: "1px solid #e2e8f0", textAlign: "left", width: "40%" }}>Name</th>
                        <th style={{ fontSize: "7pt", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: ".08em", padding: "2.4mm 2mm", borderBottom: "1px solid #e2e8f0", textAlign: "left", width: "35%" }}>Role</th>
                        <th style={{ fontSize: "7pt", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: ".08em", padding: "2.4mm 2mm", borderBottom: "1px solid #e2e8f0", textAlign: "left", width: "25%" }}>Signed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {charter.ratification_signatories.map((signatory, idx) => (
                        <tr key={`sig-${idx}`}>
                          <td style={{ fontSize: "7.5pt", padding: "2.4mm 2mm", borderBottom: "1px solid #e2e8f0", verticalAlign: "top" }}>{signatory.name || "—"}</td>
                          <td style={{ fontSize: "7.5pt", padding: "2.4mm 2mm", borderBottom: "1px solid #e2e8f0", verticalAlign: "top" }}>{signatory.role || "—"}</td>
                          <td style={{ fontSize: "7.5pt", padding: "2.4mm 2mm", borderBottom: "1px solid #e2e8f0", verticalAlign: "top" }}>
                            {signatory.signed_at ? formatDate(signatory.signed_at, signatory.signed_at) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className={`${pageWrap} print-page-break`} style={{ ...pageStyle, marginTop: "6mm" }}>
          <div style={{ backgroundColor: "#1e293b", color: "#fff", padding: "9mm 12mm 8mm" }}>
            <div style={{ fontSize: "8pt", fontWeight: 300, color: "rgba(255,255,255,.55)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: "3mm" }}>
              Appendix A
            </div>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "23pt", fontWeight: 300, lineHeight: 1.08 }}>
              Structural Architecture & Territory Schedule
            </div>
          </div>

          <div style={{ padding: "12mm", display: "flex", flexDirection: "column", gap: "5mm" }}>
            <div style={{ background: "#fafafa", borderLeft: "3px solid #a37c58", padding: "3mm 5mm", fontFamily: "'DM Sans', sans-serif", fontSize: "7.5pt", fontWeight: 400, fontStyle: "italic", color: "#334155", lineHeight: 1.65 }}>
              {charter.appendix_note}
            </div>

            <ScheduleTable
              title="Vineyard Accounts"
              rows={vineyardAccounts.map((account) => ({
                label: account.account_name,
                type: account.account_type,
                value: formatCurrency(account.book_value),
                note: isProtectedAccount(account) ? "Protected" : "Eligible Harvest",
              }))}
              emptyLabel="No Vineyard accounts are currently linked."
            />

            <ScheduleTable
              title="Storehouses"
              rows={[
                ...storehouses.map((storehouse) => ({
                  label: storehouse.label,
                  type: storehouse.asset_type || `Storehouse #${storehouse.storehouse_number}`,
                  value: formatCurrency(storehouse.book_value),
                  note: storehouse.risk_cap || storehouse.notes || "Governed reserve",
                })),
                ...charter.custom_sections.pageOne.map((section) => ({
                  label: section.title,
                  type: "Page 1 Additional Container",
                  value: "—",
                  note: section.meta || "Custom page 1 governance container",
                })),
                ...charter.custom_sections.pageTwo.map((section) => ({
                  label: section.title,
                  type: "Page 2 Additional Container",
                  value: "—",
                  note: section.meta || "Custom page 2 governance container",
                })),
              ]}
              emptyLabel="No Storehouses are currently linked."
            />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5mm" }}>
              <MetricCard label="Tracked Stewardship Value" value={formatCurrency(stewardshipValue || family?.total_family_assets)} />
              <MetricCard label="Source Charter Link" value={sourceCharterUrl ? "Linked" : "Not linked"} />
            </div>
          </div>
        </div>

        {charter.full_markdown?.trim() ? (
          <div className={`${pageWrap} print-page-break`} style={{ ...pageStyle, marginTop: "6mm" }}>
            <div style={{ backgroundColor: "#1e293b", color: "#fff", padding: "9mm 12mm 8mm" }}>
              <div style={{ fontSize: "8pt", fontWeight: 300, color: "rgba(255,255,255,.55)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: "3mm" }}>
                Full Charter
              </div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "23pt", fontWeight: 300, lineHeight: 1.08 }}>
                Long-Form Constitutional Draft
              </div>
            </div>

            <div style={{ padding: "12mm" }}>
              <div className="prose prose-sm max-w-none prose-headings:font-normal prose-headings:text-inherit prose-p:text-inherit prose-strong:text-inherit prose-li:text-inherit">
                <ReactMarkdown>{charter.full_markdown}</ReactMarkdown>
              </div>
            </div>
          </div>
        ) : null}

        {charterSources.filter((s) => (s.contentText || "").trim() || s.sourceUrl || s.fileName).length > 0 ? (
          <div className={`${pageWrap} print-page-break`} style={{ ...pageStyle, marginTop: "6mm" }}>
            <div style={{ backgroundColor: "#1e293b", color: "#fff", padding: "9mm 12mm 8mm" }}>
              <div style={{ fontSize: "8pt", fontWeight: 300, color: "rgba(255,255,255,.55)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: "3mm" }}>
                Appendix B
              </div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "23pt", fontWeight: 300, lineHeight: 1.08 }}>
                Source Documents
              </div>
            </div>

            <div style={{ padding: "12mm", display: "flex", flexDirection: "column", gap: "5mm" }}>
              <div style={{ background: "#fafafa", borderLeft: "3px solid #a37c58", padding: "3mm 5mm", fontFamily: "'DM Sans', sans-serif", fontSize: "7.5pt", fontWeight: 400, fontStyle: "italic", color: "#334155", lineHeight: 1.65 }}>
                The following materials were provided by the Sovereign and used as the canonical source for this Charter. They are reproduced here verbatim for traceability and audit.
              </div>

              {charterSources
                .filter((s) => (s.contentText || "").trim() || s.sourceUrl || s.fileName)
                .map((source, index) => {
                  const kindLabel = source.sourceKind.replace(/_/g, " ");
                  const modeLabel = source.inputMode === "upload" ? "Uploaded file" : source.inputMode === "url" ? "Linked source" : "Pasted text";
                  return (
                    <div
                      key={source.id || `source-${index}`}
                      style={{ border: "1px solid #e2e8f0", background: "#fff", display: "flex", flexDirection: "column" }}
                    >
                      <div style={{ background: "#fafafa", borderBottom: "1px solid #e2e8f0", padding: "3mm 4mm", display: "flex", flexDirection: "column", gap: "0.8mm" }}>
                        <div style={{ fontSize: "6.5pt", letterSpacing: ".12em", textTransform: "uppercase", color: "#94a3b8" }}>
                          Source {index + 1} · {kindLabel} · {modeLabel}
                        </div>
                        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "13pt", fontWeight: 500, color: "#334155" }}>
                          {source.title || "Untitled source"}
                        </div>
                        {(source.fileName || source.sourceUrl) ? (
                          <div style={{ fontSize: "7pt", color: "#64748b", wordBreak: "break-all" }}>
                            {source.fileName ? <span>{source.fileName}</span> : null}
                            {source.fileName && source.sourceUrl ? <span> · </span> : null}
                            {source.sourceUrl ? <span>{source.sourceUrl}</span> : null}
                          </div>
                        ) : null}
                      </div>
                      <div style={{ padding: "4mm 5mm", fontSize: "7.5pt", lineHeight: 1.6, color: "#334155", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {(source.contentText || "").trim()
                          ? source.contentText
                          : source.sourceUrl
                            ? "Linked source — content stored externally. See URL above."
                            : "Uploaded file — content stored in secure source bucket. See file name above."}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        ) : null}

        <style>{`
          @media print {
            @page { size: A4 portrait; margin: 0; }
            body { background: white !important; }
            .stab-doc { margin: 0 !important; }
            .print-page-break { break-before: page; page-break-before: always; }
          }
        `}</style>
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  width: "210mm",
  minHeight: "297mm",
  display: "flex",
  flexDirection: "column",
  fontFamily: "'DM Sans', sans-serif",
  color: "#334155",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-foreground">{label}</Label>
      {children}
    </div>
  );
}

function SignatoriesEditor({
  signatories,
  onAdd,
  onRemove,
  onUpdate,
}: {
  signatories: Signatory[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, key: keyof Signatory, value: string) => void;
}) {
  return (
    <div className="rounded-md border border-border p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Ratification Signatories</p>
          <p className="text-xs text-muted-foreground">Names and roles of those ratifying the Charter.</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onAdd}>
          <Plus className="mr-2 h-4 w-4" /> Add signatory
        </Button>
      </div>
      {signatories.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">No signatories yet.</div>
      ) : (
        <div className="space-y-3">
          {signatories.map((sig, index) => (
            <div key={index} className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
              <Field label="Name">
                <Input value={sig.name} onChange={(e) => onUpdate(index, "name", e.target.value)} />
              </Field>
              <Field label="Role">
                <Input value={sig.role} onChange={(e) => onUpdate(index, "role", e.target.value)} placeholder="Sovereign / Personal CFO / Witness" />
              </Field>
              <Button type="button" size="sm" variant="ghost" onClick={() => onRemove(index)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CustomContainerEditor({
  title,
  description,
  emptyLabel,
  sections,
  onAdd,
  onRemove,
  onUpdate,
}: {
  title: string;
  description: string;
  emptyLabel: string;
  sections: CustomContainer[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, key: keyof CustomContainer, value: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onAdd}>
          <Plus className="mr-2 h-4 w-4" /> Add container
        </Button>
      </div>

      <div className="space-y-4">
        {sections.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">{emptyLabel}</div>
        ) : (
          sections.map((section, index) => (
            <div key={section.id} className="rounded-md border border-border p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-foreground">Container {index + 1}</div>
                <Button type="button" size="sm" variant="ghost" onClick={() => onRemove(section.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Container Title">
                  <Input value={section.title} onChange={(e) => onUpdate(section.id, "title", e.target.value)} />
                </Field>
                <Field label="Meta Line">
                  <Input value={section.meta} onChange={(e) => onUpdate(section.id, "meta", e.target.value)} placeholder="Current $0 · Target $0" />
                </Field>
              </div>
              <Field label="Container Guidance">
                <Textarea
                  value={section.body}
                  onChange={(e) => onUpdate(section.id, "body", e.target.value)}
                  rows={4}
                  placeholder="One line per rule or guidance note"
                />
              </Field>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function CharterSourceEditor({
  sources,
  onAdd,
  onRemove,
  onUpdate,
  onFileChange,
}: {
  sources: CharterSourceDraft[];
  onAdd: (kind?: CharterSourceKind, mode?: CharterSourceInputMode) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: Partial<CharterSourceDraft>) => void;
  onFileChange: (id: string) => (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Charter resources</h3>
          <p className="text-sm text-muted-foreground">Mix uploads, pasted notes, and links. The AI uses these alongside the existing account structure.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => onAdd("statement", "upload")}>
            <Upload className="mr-2 h-4 w-4" /> Statement
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => onAdd("stabilization_session", "text")}>
            <FileText className="mr-2 h-4 w-4" /> Session notes
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => onAdd("link", "url")}>
            <ExternalLink className="mr-2 h-4 w-4" /> Link
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {sources.map((source, index) => (
          <div key={source.id} className="rounded-md border border-border p-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Resource {index + 1}</p>
                <p className="text-xs text-muted-foreground">{source.sourceKind.replace(/_/g, " ")}</p>
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={() => onRemove(source.id)} disabled={sources.length === 1}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr_0.9fr]">
              <Field label="Title">
                <Input value={source.title} onChange={(e) => onUpdate(source.id, { title: e.target.value })} />
              </Field>
              <Field label="Resource type">
                <select
                  value={source.sourceKind}
                  onChange={(e) => onUpdate(source.id, { sourceKind: e.target.value as CharterSourceKind })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="statement">Account statement</option>
                  <option value="stabilization_session">Stabilization Session</option>
                  <option value="meeting_transcript">Meeting transcript</option>
                  <option value="link">Reference link</option>
                  <option value="note">Advisor note</option>
                </select>
              </Field>
              <Field label="Input mode">
                <select
                  value={source.inputMode}
                  onChange={(e) => onUpdate(source.id, {
                    inputMode: e.target.value as CharterSourceInputMode,
                    contentText: e.target.value === "text" ? source.contentText : "",
                    sourceUrl: e.target.value === "url" ? source.sourceUrl : "",
                    file: e.target.value === "upload" ? source.file : null,
                    storedPath: e.target.value === "upload" ? source.storedPath : null,
                  })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="upload">Upload file</option>
                  <option value="text">Paste text</option>
                  <option value="url">Link</option>
                </select>
              </Field>
            </div>

            <div className="mt-4">
              {source.inputMode === "upload" ? (
                <Field label="Source file">
                  <div className="rounded-md border border-dashed border-border p-4">
                    <Input type="file" onChange={onFileChange(source.id)} accept=".pdf,.txt,.md,.doc,.docx" />
                    <p className="mt-2 text-xs text-muted-foreground">
                      {source.fileName ? `Selected: ${source.fileName}` : source.storedPath ? "Previously uploaded file ready for reuse." : "Upload account statements or supporting files up to 20MB."}
                    </p>
                  </div>
                </Field>
              ) : source.inputMode === "url" ? (
                <Field label="Reference URL">
                  <Input value={source.sourceUrl} onChange={(e) => onUpdate(source.id, { sourceUrl: e.target.value })} placeholder="https://" />
                </Field>
              ) : (
                <Field label="Resource text">
                  <Textarea
                    value={source.contentText}
                    onChange={(e) => onUpdate(source.id, { contentText: e.target.value })}
                    rows={6}
                    placeholder="Paste the Stabilization Session summary, Gemini meeting transcript, or advisor notes here."
                  />
                </Field>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionCard({ title, body, items }: { title: string; body?: string; items?: string[] }) {
  return (
    <div style={{ background: "#fafafa", borderLeft: "3px solid #a37c58", padding: "3mm 4mm" }}>
      <div style={{ fontSize: "6.5pt", letterSpacing: ".12em", textTransform: "uppercase", color: "#94a3b8", marginBottom: "1.5mm" }}>{title}</div>
      {body && <p style={{ fontSize: "7.5pt", lineHeight: 1.55 }}>{body}</p>}
      {items?.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.4mm" }}>
          {items.map((item, index) => (
            <div key={index} style={{ display: "flex", gap: "2mm" }}>
              <div style={{ width: "4px", height: "4px", borderRadius: "999px", background: "#a37c58", marginTop: "5px", flexShrink: 0 }} />
              <p style={{ fontSize: "7.5pt", lineHeight: 1.5 }}>{item}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ArticleCard({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ border: "1px solid #e2e8f0", padding: "4mm", background: "#fff" }}>
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "13pt", fontWeight: 500, color: "#334155", marginBottom: "1.5mm" }}>{title}</div>
      <p style={{ fontSize: "7.5pt", lineHeight: 1.6, color: "#334155" }}>{body}</p>
    </div>
  );
}

function PageOneContainerCard({ title, meta, body }: { title: string; meta?: string; body: string }) {
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <div style={{ border: "1px solid #e2e8f0", padding: "4mm", background: "#fff" }}>
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "13pt", fontWeight: 500, color: "#334155", marginBottom: "1.5mm" }}>{title}</div>
      {meta ? <div style={{ fontSize: "7pt", color: "#64748b", marginBottom: "2mm", textTransform: "uppercase", letterSpacing: ".08em" }}>{meta}</div> : null}
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5mm" }}>
        {lines.map((line, index) => (
          <p key={index} style={{ fontSize: "7.5pt", lineHeight: 1.6, color: "#334155" }}>
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

function ContainerCard({
  title,
  meta,
  subtitle,
  items,
}: {
  title: string;
  meta?: string;
  subtitle?: string;
  items: string[];
}) {
  return (
    <div style={{ background: "#fafafa", borderLeft: "3px solid #a37c58", padding: "3mm 4mm" }}>
      <strong style={{ display: "block", fontSize: "8.5pt", fontWeight: 600, color: "#334155", marginBottom: "1mm" }}>{title}</strong>
      {meta ? <div style={{ fontSize: "7.5pt", color: "#64748b", marginBottom: "1.5mm" }}>{meta}</div> : null}
      {subtitle ? <div style={{ fontSize: "7.5pt", color: "#334155", marginBottom: "1.5mm" }}>{subtitle}</div> : null}
      {items.map((item, index) => (
        <div key={index} style={{ display: "flex", gap: "2mm", marginTop: "1.2mm" }}>
          <div style={{ width: "4px", height: "4px", borderRadius: "999px", background: "#a37c58", marginTop: "5px", flexShrink: 0 }} />
          <p style={{ fontSize: "7.5pt", lineHeight: 1.5 }}>{item}</p>
        </div>
      ))}
    </div>
  );
}

function ScheduleTable({
  title,
  rows,
  emptyLabel,
}: {
  title: string;
  rows: Array<{ label: string; type: string; value: string; note: string }>;
  emptyLabel: string;
}) {
  const headCell: React.CSSProperties = {
    fontSize: "7pt",
    fontWeight: 600,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: ".08em",
    padding: "2.4mm 2mm",
    borderBottom: "1px solid #e2e8f0",
    textAlign: "left",
  };

  const bodyCell: React.CSSProperties = {
    fontSize: "7.5pt",
    padding: "2.4mm 2mm",
    borderBottom: "1px solid #e2e8f0",
    verticalAlign: "top",
  };

  return (
    <div>
      <div style={{ fontSize: "6.5pt", letterSpacing: ".12em", textTransform: "uppercase", color: "#94a3b8", marginBottom: "2mm" }}>{title}</div>
      {rows.length === 0 ? (
        <div style={{ background: "#fafafa", padding: "4mm", fontSize: "8pt", color: "#64748b" }}>{emptyLabel}</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <thead>
            <tr style={{ background: "#fafafa" }}>
              <th style={{ ...headCell, width: "32%" }}>Account</th>
              <th style={{ ...headCell, width: "22%" }}>Type</th>
              <th style={{ ...headCell, width: "18%" }}>Value</th>
              <th style={{ ...headCell, width: "28%" }}>Purpose</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.label}-${index}`}>
                <td style={bodyCell}>{row.label}</td>
                <td style={bodyCell}>{row.type}</td>
                <td style={bodyCell}>{row.value}</td>
                <td style={bodyCell}>{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "#fafafa", borderLeft: "3px solid #a37c58", padding: "3mm 4mm" }}>
      <div style={{ fontSize: "6.5pt", letterSpacing: ".12em", textTransform: "uppercase", color: "#94a3b8", marginBottom: "1.2mm" }}>{label}</div>
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "16pt", fontWeight: 500, color: "#334155" }}>{value}</div>
    </div>
  );
}
