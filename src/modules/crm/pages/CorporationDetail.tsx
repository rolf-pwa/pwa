import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/shared/integrations/supabase/client";
import { AppLayout } from "@/shared/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
import { PageBreadcrumbs } from "@/shared/components/PageBreadcrumbs";
import { InlineEdit } from "@/shared/components/InlineEdit";
import { InsurancePanel } from "@/modules/crm/components/InsurancePanel";
import { LiabilitiesCard } from "@/modules/crm/components/LiabilitiesCard";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/shared/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  Building2,
  Plus,
  Trash2,
  Users,
  DollarSign,
  User,
  Percent,
  Crown,
  GitBranch,
} from "lucide-react";
import { toast } from "sonner";

const TYPE_LABELS: Record<string, string> = {
  opco: "Operating Co.",
  holdco: "Holding Co.",
  trust: "Trust",
  partnership: "Partnership",
  other: "Other",
};

interface Shareholder {
  id: string;
  contact_id: string;
  ownership_percentage: number;
  share_class: string | null;
  role_title: string | null;
  is_active: boolean;
  contact_name: string;
  contact_email: string | null;
  family_name: string | null;
}

interface CorpAccount {
  id: string;
  account_name: string;
  account_number: string | null;
  account_type: string;
  current_value: number;
  notes: string | null;
}

interface CorpLink {
  id: string;
  child_corporation_id: string;
  parent_corporation_id: string;
  ownership_percentage: number;
  share_class: string | null;
  notes: string | null;
  corp_name: string;
  corp_type: string;
}

const CorporationDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [corp, setCorp] = useState<any>(null);
  const [shareholders, setShareholders] = useState<Shareholder[]>([]);
  const [accounts, setAccounts] = useState<CorpAccount[]>([]);
  const [subsidiaries, setSubsidiaries] = useState<CorpLink[]>([]);
  const [parentCorps, setParentCorps] = useState<CorpLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [linkedStorehouses, setLinkedStorehouses] = useState<any[]>([]);

  // Add shareholder dialog
  const [showAddShareholder, setShowAddShareholder] = useState(false);
  const [shareholderType, setShareholderType] = useState<"individual" | "corporation">("individual");
  const [allContacts, setAllContacts] = useState<any[]>([]);
  const [availableCorpsForShareholder, setAvailableCorpsForShareholder] = useState<any[]>([]);
  const [selectedContactId, setSelectedContactId] = useState("");
  const [selectedCorpShareholderId, setSelectedCorpShareholderId] = useState("");
  const [ownershipPct, setOwnershipPct] = useState("0");
  const [shareClass, setShareClass] = useState("Common");
  const [roleTitle, setRoleTitle] = useState("");

  // Add account dialog
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [newAccName, setNewAccName] = useState("");
  const [newAccType, setNewAccType] = useState("Portfolio");
  const [newAccValue, setNewAccValue] = useState("");

  // Add subsidiary dialog
  const [showAddSubsidiary, setShowAddSubsidiary] = useState(false);
  const [allCorps, setAllCorps] = useState<any[]>([]);
  const [selectedChildCorpId, setSelectedChildCorpId] = useState("");
  const [corpOwnershipPct, setCorpOwnershipPct] = useState("0");
  const [corpShareClass, setCorpShareClass] = useState("Common");

  const fetchData = useCallback(async () => {
    if (!id) return;

    const [corpRes, shRes, accRes] = await Promise.all([
      (supabase.from("corporations" as any) as any).select("*").eq("id", id).single(),
      (supabase.from("shareholders" as any) as any).select("*").eq("corporation_id", id).order("ownership_percentage", { ascending: false }),
      (supabase.from("corporate_vineyard_accounts" as any) as any).select("*").eq("corporation_id", id).order("account_name"),
    ]);

    if (corpRes.error || !corpRes.data) {
      navigate("/corporations");
      return;
    }

    setCorp(corpRes.data);
    setAccounts(
      ((accRes.data || []) as any[]).map((a: any) => ({
        ...a,
        current_value: Number(a.current_value || 0),
      }))
    );

    // Resolve shareholder contact names
    const shData = (shRes.data || []) as any[];
    if (shData.length > 0) {
      const contactIds = shData.map((s: any) => s.contact_id);
      const { data: contacts } = await supabase
        .from("contacts")
        .select("id, full_name, email, family_id")
        .in("id", contactIds);

      // Get family names for linked contacts
      const familyIds = (contacts || []).filter((c: any) => c.family_id).map((c: any) => c.family_id);
      const { data: familyData } = familyIds.length > 0
        ? await (supabase.from("families" as any) as any).select("id, name").in("id", familyIds)
        : { data: [] };

      const familyMap: Record<string, string> = {};
      ((familyData || []) as any[]).forEach((f: any) => { familyMap[f.id] = f.name; });

      const contactMap: Record<string, any> = {};
      (contacts || []).forEach((c: any) => { contactMap[c.id] = c; });

      setShareholders(
        shData.map((s: any) => ({
          ...s,
          ownership_percentage: Number(s.ownership_percentage),
          contact_name: contactMap[s.contact_id]?.full_name || "Unknown",
          contact_email: contactMap[s.contact_id]?.email || null,
          family_name: contactMap[s.contact_id]?.family_id
            ? familyMap[contactMap[s.contact_id].family_id] || null
            : null,
        }))
      );

      // Load storehouses owned by shareholder contacts (available for policy routing)
      const { data: shStores } = await supabase
        .from("storehouses")
        .select("id, storehouse_number, label, contact_id")
        .in("contact_id", contactIds);
      setLinkedStorehouses(shStores || []);
    } else {
      setShareholders([]);
      setLinkedStorehouses([]);
    }

    // Fetch corp-to-corp links (this corp as parent = subsidiaries, as child = parent corps)
    const [subsRes, parentRes] = await Promise.all([
      (supabase.from("corporate_shareholders" as any) as any).select("*").eq("parent_corporation_id", id),
      (supabase.from("corporate_shareholders" as any) as any).select("*").eq("child_corporation_id", id),
    ]);

    const allCorpIds = new Set<string>();
    ((subsRes.data || []) as any[]).forEach((s: any) => allCorpIds.add(s.child_corporation_id));
    ((parentRes.data || []) as any[]).forEach((s: any) => allCorpIds.add(s.parent_corporation_id));

    let corpNameMap: Record<string, any> = {};
    if (allCorpIds.size > 0) {
      const { data: corpNames } = await (supabase.from("corporations" as any) as any)
        .select("id, name, corporation_type")
        .in("id", Array.from(allCorpIds));
      ((corpNames || []) as any[]).forEach((c: any) => { corpNameMap[c.id] = c; });
    }

    setSubsidiaries(
      ((subsRes.data || []) as any[]).map((s: any) => ({
        ...s,
        ownership_percentage: Number(s.ownership_percentage),
        corp_name: corpNameMap[s.child_corporation_id]?.name || "Unknown",
        corp_type: corpNameMap[s.child_corporation_id]?.corporation_type || "",
      }))
    );

    setParentCorps(
      ((parentRes.data || []) as any[]).map((s: any) => ({
        ...s,
        ownership_percentage: Number(s.ownership_percentage),
        corp_name: corpNameMap[s.parent_corporation_id]?.name || "Unknown",
        corp_type: corpNameMap[s.parent_corporation_id]?.corporation_type || "",
      }))
    );

    setLoading(false);
  }, [id, navigate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const updateField = async (field: string, value: any) => {
    const { error } = await (supabase.from("corporations" as any) as any)
      .update({ [field]: value })
      .eq("id", id);
    if (error) toast.error(`Failed to update ${field}`);
    else { toast.success("Updated."); fetchData(); }
  };

  const deleteCorp = async () => {
    const { error } = await (supabase.from("corporations" as any) as any).delete().eq("id", id);
    if (error) toast.error("Failed to delete corporation.");
    else { toast.success("Corporation deleted."); navigate("/corporations"); }
  };

  const openAddShareholder = async () => {
    const [contactsRes, corpsRes] = await Promise.all([
      supabase.from("contacts").select("id, full_name, email").order("full_name"),
      (supabase.from("corporations" as any) as any).select("id, name, corporation_type").order("name"),
    ]);
    const existingContactIds = new Set(shareholders.map((s) => s.contact_id));
    const existingCorpIds = new Set(parentCorps.map((p) => p.parent_corporation_id));
    setAllContacts((contactsRes.data || []).filter((c: any) => !existingContactIds.has(c.id)));
    setAvailableCorpsForShareholder(
      ((corpsRes.data || []) as any[]).filter((c: any) => c.id !== id && !existingCorpIds.has(c.id))
    );
    setShareholderType("individual");
    setSelectedContactId("");
    setSelectedCorpShareholderId("");
    setOwnershipPct("0");
    setShareClass("Common");
    setRoleTitle("");
    setShowAddShareholder(true);
  };

  const addShareholder = async () => {
    if (!id) return;
    if (shareholderType === "individual") {
      if (!selectedContactId) return;
      const { error } = await (supabase.from("shareholders" as any) as any)
        .insert({
          contact_id: selectedContactId,
          corporation_id: id,
          ownership_percentage: Number(ownershipPct) || 0,
          share_class: shareClass || "Common",
          role_title: roleTitle || null,
        });
      if (error) toast.error("Failed to add shareholder.");
      else { toast.success("Shareholder added."); setShowAddShareholder(false); fetchData(); }
    } else {
      if (!selectedCorpShareholderId) return;
      const { error } = await (supabase.from("corporate_shareholders" as any) as any)
        .insert({
          parent_corporation_id: selectedCorpShareholderId,
          child_corporation_id: id,
          ownership_percentage: Number(ownershipPct) || 0,
          share_class: shareClass || "Common",
        });
      if (error) toast.error("Failed to add corporate shareholder.");
      else { toast.success("Corporate shareholder added."); setShowAddShareholder(false); fetchData(); }
    }
  };

  const removeShareholder = async (shareholderId: string) => {
    const { error } = await (supabase.from("shareholders" as any) as any).delete().eq("id", shareholderId);
    if (error) toast.error("Failed to remove shareholder.");
    else { toast.success("Shareholder removed."); fetchData(); }
  };

  const openAddSubsidiary = async () => {
    const { data } = await (supabase.from("corporations" as any) as any).select("id, name, corporation_type").order("name");
    const existingIds = new Set([id, ...subsidiaries.map((s) => s.child_corporation_id)]);
    setAllCorps((data || []).filter((c: any) => !existingIds.has(c.id)));
    setSelectedChildCorpId("");
    setCorpOwnershipPct("0");
    setCorpShareClass("Common");
    setShowAddSubsidiary(true);
  };

  const addSubsidiary = async () => {
    if (!selectedChildCorpId || !id) return;
    const { error } = await (supabase.from("corporate_shareholders" as any) as any)
      .insert({
        parent_corporation_id: id,
        child_corporation_id: selectedChildCorpId,
        ownership_percentage: Number(corpOwnershipPct) || 0,
        share_class: corpShareClass || "Common",
      });
    if (error) toast.error("Failed to add subsidiary link.");
    else { toast.success("Subsidiary linked."); setShowAddSubsidiary(false); fetchData(); }
  };

  const removeCorpLink = async (linkId: string) => {
    const { error } = await (supabase.from("corporate_shareholders" as any) as any).delete().eq("id", linkId);
    if (error) toast.error("Failed to remove link.");
    else { toast.success("Link removed."); fetchData(); }
  };

  const addAccount = async () => {
    if (!newAccName.trim() || !id) return;
    const { error } = await (supabase.from("corporate_vineyard_accounts" as any) as any)
      .insert({
        corporation_id: id,
        account_name: newAccName.trim(),
        account_type: newAccType,
        current_value: Number(newAccValue) || 0,
      });
    if (error) toast.error("Failed to add account.");
    else {
      toast.success("Account added.");
      setNewAccName("");
      setNewAccType("Portfolio");
      setNewAccValue("");
      setShowAddAccount(false);
      fetchData();
    }
  };

  const deleteAccount = async (accountId: string) => {
    const { error } = await (supabase.from("corporate_vineyard_accounts" as any) as any).delete().eq("id", accountId);
    if (error) toast.error("Failed to delete account.");
    else { toast.success("Account deleted."); fetchData(); }
  };

  if (loading) {
    return <AppLayout><p className="p-8 text-muted-foreground">Loading…</p></AppLayout>;
  }

  if (!corp) return null;

  const totalAssets = accounts.reduce((sum, a) => sum + a.current_value, 0);

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageBreadcrumbs items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Corporations", href: "/corporations" },
          { label: corp.name },
        ]} />

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <Building2 className="h-6 w-6 text-accent" />
              <InlineEdit value={corp.name} onSave={(v) => updateField("name", v)} className="text-2xl font-bold font-serif" />
            </div>
            <div className="mt-2 flex items-center gap-3">
              <Badge variant="outline">{TYPE_LABELS[corp.corporation_type] || corp.corporation_type}</Badge>
              {corp.jurisdiction && <span className="text-sm text-muted-foreground">{corp.jurisdiction}</span>}
            </div>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-destructive gap-1.5">
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {corp.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove the corporation, all shareholder links, and corporate accounts. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={deleteCorp} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Relationships: Shareholders + Subsidiaries */}
          <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Users className="h-5 w-5 text-accent" /> Shareholders
              </CardTitle>
              <Button size="sm" variant="outline" onClick={openAddShareholder} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {/* Corporate shareholders (HoldCos etc.) */}
              {parentCorps.map((p) => (
                <div key={`corp-${p.id}`} className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-primary">
                      <Building2 className="h-4 w-4" />
                    </div>
                    <div>
                      <Link to={`/corporations/${p.parent_corporation_id}`} className="text-sm font-medium text-foreground hover:text-accent transition-colors">
                        {p.corp_name}
                      </Link>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-0.5">
                          <Percent className="h-3 w-3" /> {p.ownership_percentage}%
                        </span>
                        {p.share_class && <span>· {p.share_class}</span>}
                        <Badge variant="outline" className="text-[9px] ml-1">{TYPE_LABELS[p.corp_type] || p.corp_type}</Badge>
                      </div>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeCorpLink(p.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}

              {/* Individual shareholders */}
              {shareholders.map((sh) => (
                <div key={`ind-${sh.id}`} className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/15 text-accent">
                      <User className="h-4 w-4" />
                    </div>
                    <div>
                      <Link to={`/contacts/${sh.contact_id}`} className="text-sm font-medium text-foreground hover:text-accent transition-colors">
                        {sh.contact_name}
                      </Link>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-0.5">
                          <Percent className="h-3 w-3" /> {sh.ownership_percentage}%
                        </span>
                        {sh.share_class && <span>· {sh.share_class}</span>}
                        {sh.role_title && <span>· {sh.role_title}</span>}
                        {sh.family_name && (
                          <Badge variant="outline" className="text-[9px] ml-1">
                            <Crown className="h-2.5 w-2.5 mr-0.5" /> {sh.family_name}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeShareholder(sh.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}

              {shareholders.length === 0 && parentCorps.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No shareholders linked.</p>
              )}
            </CardContent>
          </Card>

          {/* Corporate Holdings (Subsidiaries this corp owns) */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <GitBranch className="h-5 w-5 text-accent" /> Subsidiaries
              </CardTitle>
              <Button size="sm" variant="outline" onClick={openAddSubsidiary} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Link
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {subsidiaries.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No subsidiaries linked.</p>
              ) : (
                subsidiaries.map((s) => (
                  <div key={s.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-accent" />
                      <Link to={`/corporations/${s.child_corporation_id}`} className="text-sm font-medium hover:text-accent transition-colors">
                        {s.corp_name}
                      </Link>
                      <Badge variant="outline" className="text-[9px]">{TYPE_LABELS[s.corp_type] || s.corp_type}</Badge>
                      <span className="text-xs text-muted-foreground">{s.ownership_percentage}%</span>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeCorpLink(s.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          </div>

          {/* Financials: Corporate Vineyard + Insurance + Liabilities */}
          <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <DollarSign className="h-5 w-5 text-accent" /> Corporate Vineyard
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  ${totalAssets.toLocaleString()}
                </span>
              </CardTitle>
              <Button size="sm" variant="outline" onClick={() => setShowAddAccount(true)} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Add Account
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {accounts.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No corporate accounts.</p>
              ) : (
                accounts.map((acc) => (
                  <div key={acc.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                    <div>
                      <p className="text-sm font-medium">{acc.account_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {acc.account_type}{acc.account_number ? ` · ${acc.account_number}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">${acc.current_value.toLocaleString()}</span>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteAccount(acc.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))
              )}

              {/* Pro-rata shareholder breakdown */}
              {totalAssets > 0 && (shareholders.length > 0 || parentCorps.length > 0) && (
                <div className="mt-4 pt-4 border-t border-border">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                    Pro-Rata Sovereign Stakes
                  </p>
                  {parentCorps.map((p) => {
                    const proRata = totalAssets * (p.ownership_percentage / 100);
                    return (
                      <div key={`pr-corp-${p.id}`} className="flex items-center justify-between py-1 text-xs">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Building2 className="h-3 w-3" /> {p.corp_name} ({p.ownership_percentage}%)
                        </span>
                        <span className="font-medium">${proRata.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                      </div>
                    );
                  })}
                  {shareholders.map((sh) => {
                    const proRata = totalAssets * (sh.ownership_percentage / 100);
                    return (
                      <div key={`pr-ind-${sh.id}`} className="flex items-center justify-between py-1 text-xs">
                        <span className="text-muted-foreground">{sh.contact_name} ({sh.ownership_percentage}%)</span>
                        <span className="font-medium">${proRata.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Corporate Insurance */}
          <InsurancePanel
            scope={{ kind: "corporation", corporationId: id! }}
            storehouses={linkedStorehouses.map((s) => ({
              id: s.id, storehouse_number: s.storehouse_number, label: s.label,
            }))}
            onStorehousesChanged={() => fetchData()}
          />

          {/* Liabilities */}
          <LiabilitiesCard holderType="corporation" holderId={id!} />
          </div>
        </div>

        {/* Details card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Jurisdiction</label>
              <InlineEdit value={corp.jurisdiction || ""} onSave={(v) => updateField("jurisdiction", v || null)} placeholder="Enter jurisdiction…" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Fiscal Year End</label>
              <InlineEdit value={corp.fiscal_year_end || ""} onSave={(v) => updateField("fiscal_year_end", v || null)} placeholder="e.g. December 31" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Notes</label>
              <InlineEdit value={corp.notes || ""} onSave={(v) => updateField("notes", v || null)} placeholder="Add notes…" />
            </div>
          </CardContent>
        </Card>

        {/* Add Shareholder Dialog */}
        <Dialog open={showAddShareholder} onOpenChange={setShowAddShareholder}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Shareholder</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* Shareholder type toggle */}
              <div>
                <label className="text-sm font-medium">Type</label>
                <Select value={shareholderType} onValueChange={(v: "individual" | "corporation") => { setShareholderType(v); setSelectedContactId(""); setSelectedCorpShareholderId(""); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="individual">Individual (Contact)</SelectItem>
                    <SelectItem value="corporation">Corporation (HoldCo, etc.)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {shareholderType === "individual" ? (
                <div>
                  <label className="text-sm font-medium">Contact</label>
                  <Select value={selectedContactId} onValueChange={setSelectedContactId}>
                    <SelectTrigger><SelectValue placeholder="Select a contact…" /></SelectTrigger>
                    <SelectContent>
                      {allContacts.map((c: any) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.full_name}{c.email ? ` (${c.email})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div>
                  <label className="text-sm font-medium">Corporation</label>
                  <Select value={selectedCorpShareholderId} onValueChange={setSelectedCorpShareholderId}>
                    <SelectTrigger><SelectValue placeholder="Select a corporation…" /></SelectTrigger>
                    <SelectContent>
                      {availableCorpsForShareholder.map((c: any) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name} ({TYPE_LABELS[c.corporation_type] || c.corporation_type})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Ownership %</label>
                  <Input type="number" min="0" max="100" value={ownershipPct} onChange={(e) => setOwnershipPct(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-medium">Share Class</label>
                  <Input value={shareClass} onChange={(e) => setShareClass(e.target.value)} placeholder="Common" />
                </div>
              </div>
              {shareholderType === "individual" && (
                <div>
                  <label className="text-sm font-medium">Role / Title</label>
                  <Input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} placeholder="e.g. Director, President" />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddShareholder(false)}>Cancel</Button>
              <Button
                onClick={addShareholder}
                disabled={shareholderType === "individual" ? !selectedContactId : !selectedCorpShareholderId}
              >
                Add Shareholder
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Add Account Dialog */}
        <Dialog open={showAddAccount} onOpenChange={setShowAddAccount}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Corporate Account</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <label className="text-sm font-medium">Account Name</label>
                <Input value={newAccName} onChange={(e) => setNewAccName(e.target.value)} placeholder="e.g. Corporate Investment Portfolio" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Type</label>
                  <Input value={newAccType} onChange={(e) => setNewAccType(e.target.value)} placeholder="Portfolio" />
                </div>
                <div>
                  <label className="text-sm font-medium">Current Value</label>
                  <Input type="number" value={newAccValue} onChange={(e) => setNewAccValue(e.target.value)} placeholder="0" />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddAccount(false)}>Cancel</Button>
              <Button onClick={addAccount} disabled={!newAccName.trim()}>Add Account</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Add Subsidiary Dialog */}
        <Dialog open={showAddSubsidiary} onOpenChange={setShowAddSubsidiary}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Link Subsidiary Corporation</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <label className="text-sm font-medium">Corporation</label>
                <Select value={selectedChildCorpId} onValueChange={setSelectedChildCorpId}>
                  <SelectTrigger><SelectValue placeholder="Select a corporation…" /></SelectTrigger>
                  <SelectContent>
                    {allCorps.map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} ({TYPE_LABELS[c.corporation_type] || c.corporation_type})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Ownership %</label>
                  <Input type="number" min="0" max="100" value={corpOwnershipPct} onChange={(e) => setCorpOwnershipPct(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-medium">Share Class</label>
                  <Input value={corpShareClass} onChange={(e) => setCorpShareClass(e.target.value)} placeholder="Common" />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddSubsidiary(false)}>Cancel</Button>
              <Button onClick={addSubsidiary} disabled={!selectedChildCorpId}>Link Subsidiary</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
};

export default CorporationDetail;
