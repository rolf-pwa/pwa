import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/shared/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { AppLayout } from "@/shared/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Bell, BellOff, Trash2 } from "lucide-react";
import { PageBreadcrumbs } from "@/shared/components/PageBreadcrumbs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger
} from "@/shared/components/ui/alert-dialog";

const ContactForm = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [emailNotifEnabled, setEmailNotifEnabled] = useState(true);

  const [form, setForm] = useState({
    first_name: searchParams.get("first_name") || "",
    last_name: searchParams.get("last_name") || "",
    email: "",
    phone: "",
    address: "",
    family_role: "head_of_family" as "head_of_family" | "spouse" | "beneficiary" | "minor" | "head_of_household",
    vineyard_ebitda: "",
    vineyard_operating_income: "",
    vineyard_balance_sheet_summary: "",
    quiet_period_start_date: "",

    asana_url: "",
    ia_financial_url: "",
    just_wealth_url: "",
    google_drive_url: "",
    charter_url: "",
    vault_root_folder_id: "",
  });
  const [householdId, setHouseholdId] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    async function load() {
      const { data } = await supabase.from("contacts").select("*").eq("id", id).maybeSingle();
      if (!data) return;
      setForm({
        first_name: data.first_name || "",
        last_name: data.last_name || "",
        email: data.email || "",
        phone: data.phone || "",
        address: data.address || "",
        family_role: (data.family_role as any) || "head_of_family",
        vineyard_ebitda: data.vineyard_ebitda?.toString() || "",
        vineyard_operating_income: data.vineyard_operating_income?.toString() || "",
        vineyard_balance_sheet_summary: data.vineyard_balance_sheet_summary || "",
        quiet_period_start_date: data.quiet_period_start_date || "",

        asana_url: data.asana_url || "",
        ia_financial_url: data.ia_financial_url || "",
        just_wealth_url: (data as any).just_wealth_url || "",
        google_drive_url: data.google_drive_url || "",
        charter_url: (data as any).charter_url || "",
        vault_root_folder_id: "",
      });
      const hhId = (data as any).household_id || null;
      setHouseholdId(hhId);
      if (hhId) {
        const { data: hh } = await supabase
          .from("households")
          .select("vault_root_folder_id")
          .eq("id", hhId)
          .maybeSingle();
        if (hh) setForm((prev) => ({ ...prev, vault_root_folder_id: (hh as any).vault_root_folder_id || "" }));
      }
      setEmailNotifEnabled(data.email_notifications_enabled !== false);
    }
    load();
  }, [id]);

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.first_name.trim()) {
      toast.error("First name is required.");
      return;
    }

    setSaving(true);

    const payload: any = {
      full_name: `${form.first_name} ${form.last_name}`.trim(),
      first_name: form.first_name,
      last_name: form.last_name || null,
      email: form.email || null,
      phone: form.phone || null,
      address: form.address || null,
      family_role: form.family_role,
      vineyard_ebitda: form.vineyard_ebitda ? Number(form.vineyard_ebitda) : null,
      vineyard_operating_income: form.vineyard_operating_income
        ? Number(form.vineyard_operating_income)
        : null,
      vineyard_balance_sheet_summary:
        form.vineyard_balance_sheet_summary || null,
      quiet_period_start_date: form.quiet_period_start_date || null,
      
      asana_url: form.asana_url || null,
      ia_financial_url: form.ia_financial_url || null,
      just_wealth_url: form.just_wealth_url || null,
      google_drive_url: form.google_drive_url || null,
      charter_url: form.charter_url || null,
    };

    let contactId = id;

    if (isEdit) {
      const { error } = await supabase
        .from("contacts")
        .update(payload)
        .eq("id", id!);
      if (error) {
        toast.error("Failed to update contact.");
        setSaving(false);
        return;
      }
    } else {
      const { data, error } = await supabase
        .from("contacts")
        .insert({ ...payload, created_by: user!.id })
        .select("id")
        .single();
      if (error || !data) {
        toast.error("Failed to create contact.");
        setSaving(false);
        return;
      }
      contactId = data.id;
    }

    // Persist vault root folder on the household
    if (householdId) {
      const raw = form.vault_root_folder_id.trim();
      const folderId = raw ? (raw.match(/\/folders\/([a-zA-Z0-9_-]+)/)?.[1] ?? raw) : null;
      await supabase
        .from("households")
        .update({ vault_root_folder_id: folderId } as any)
        .eq("id", householdId);
    }

    // Mirror contact info onto the household record so the household
    // address (and label, when this is the Head of Household) stay in sync.
    if (householdId) {
      const householdUpdate: Record<string, any> = {};
      householdUpdate.address = form.address?.trim() || null;
      if (
        form.family_role === "head_of_household" ||
        form.family_role === "head_of_family"
      ) {
        const lastName = form.last_name?.trim();
        if (lastName) householdUpdate.label = `${lastName} Household`;
      }
      await supabase
        .from("households")
        .update(householdUpdate)
        .eq("id", householdId);
    }

    toast.success(isEdit ? "Contact updated." : "Contact created.");
    navigate(`/contacts/${contactId}`);
    setSaving(false);
  }

  return (
    <AppLayout>
      <form onSubmit={handleSubmit} className="space-y-6">
        <PageBreadcrumbs items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Contacts", href: "/contacts" },
          ...(isEdit && id ? [{ label: form.first_name || "Contact", href: `/contacts/${id}` }] : []),
          { label: isEdit ? "Edit" : "New Contact" },
        ]} />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => navigate(isEdit ? `/contacts/${id}` : "/contacts")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-2xl font-bold">
              {isEdit ? "Edit Contact" : "New Contact"}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {isEdit && id && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  title={emailNotifEnabled ? "Email notifications on" : "Email notifications off"}
                  onClick={async () => {
                    const newVal = !emailNotifEnabled;
                    const { error } = await supabase.from("contacts").update({ email_notifications_enabled: newVal }).eq("id", id);
                    if (error) { toast.error("Failed to update notifications."); return; }
                    setEmailNotifEnabled(newVal);
                    toast.success(newVal ? "Notifications enabled" : "Notifications disabled");
                  }}
                >
                  {emailNotifEnabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4 text-muted-foreground" />}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="outline" size="icon" className="text-destructive hover:bg-destructive/10">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete contact</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete {form.first_name} {form.last_name} and all associated relationships. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={async () => {
                          const { error } = await supabase.from("contacts").delete().eq("id", id);
                          if (error) { toast.error("Failed to delete contact."); }
                          else { toast.success("Contact deleted."); navigate("/contacts"); }
                        }}
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : isEdit ? "Update Contact" : "Create Contact"}
            </Button>
          </div>
        </div>

        {/* Basic Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Basic Information</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="first_name">First Name *</Label>
              <Input
                id="first_name"
                value={form.first_name}
                onChange={(e) => update("first_name", e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="last_name">Last Name</Label>
              <Input
                id="last_name"
                value={form.last_name}
                onChange={(e) => update("last_name", e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={form.email} onChange={(e) => update("email", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" value={form.phone} onChange={(e) => update("phone", e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="address">Address</Label>
              <Input id="address" value={form.address} onChange={(e) => update("address", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="family_role">Role</Label>
              <Select value={form.family_role} onValueChange={(v) => update("family_role", v)}>
                <SelectTrigger id="family_role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="head_of_family">Head of Family</SelectItem>
                  <SelectItem value="head_of_household">Head of Household</SelectItem>
                  <SelectItem value="spouse">Spouse</SelectItem>
                  <SelectItem value="beneficiary">Beneficiary</SelectItem>
                  <SelectItem value="minor">Minor</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Resources */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Resources</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Asana URL</Label>
              <Input value={form.asana_url} onChange={(e) => update("asana_url", e.target.value)} placeholder="https://..." />
            </div>
            <div>
              <Label>IA Financial URL</Label>
              <Input value={form.ia_financial_url} onChange={(e) => update("ia_financial_url", e.target.value)} placeholder="https://..." />
            </div>
            <div>
              <Label>Just Wealth URL</Label>
              <Input value={form.just_wealth_url} onChange={(e) => update("just_wealth_url", e.target.value)} placeholder="https://..." />
            </div>
            <div>
              <Label>Google Drive Folder URL</Label>
              <Input value={form.google_drive_url} onChange={(e) => update("google_drive_url", e.target.value)} placeholder="https://drive.google.com/..." />
            </div>
            <div>
              <Label>Vault Root Folder URL or ID</Label>
              <Input
                value={form.vault_root_folder_id}
                onChange={(e) => update("vault_root_folder_id", e.target.value)}
                placeholder="https://drive.google.com/drive/folders/... or folder ID"
                disabled={!householdId}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {householdId
                  ? "Saved on the household. Used as the provisioned Vault root."
                  : "Assign this contact to a household to set the Vault root."}
              </p>
            </div>
            <div>
              <Label>Charter Document URL</Label>
              <Input value={form.charter_url} onChange={(e) => update("charter_url", e.target.value)} placeholder="https://drive.google.com/..." />
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" disabled={saving} className="bg-sanctuary-bronze text-sanctuary-charcoal hover:bg-sanctuary-bronze/90">
            {saving ? "Saving..." : isEdit ? "Update Contact" : "Create Contact"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate(isEdit ? `/contacts/${id}` : "/contacts")}
          >
            Cancel
          </Button>
        </div>
      </form>
    </AppLayout>
  );
};

export default ContactForm;
