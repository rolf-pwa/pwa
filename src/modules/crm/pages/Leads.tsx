import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/shared/components/AppLayout";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/shared/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { Loader2, UserPlus, ArrowRight, Check, TreesIcon, FileText, Info, X } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/shared/integrations/supabase/client";
import { PageBreadcrumbs } from "@/shared/components/PageBreadcrumbs";
import { CrmTabs } from "@/modules/crm/components/CrmTabs";
import { toast } from "sonner";
import { useAuth } from "@/shared/hooks/useAuth";

type DiscoveryLead = {
  id: string;
  first_name: string;
  email: string | null;
  phone: string | null;
  transition_type: string | null;
  sovereignty_status: string;
  anxiety_anchor: string | null;
  vision_summary: string | null;
  vineyard_summary: string | null;
  discovery_notes: string | null;
  created_at: string;
};

type Georgia2Lead = {
  id: string;
  first_name: string;
  email: string;
  mobile: string | null;
  domain: string;
  catalyst: string;
  chosen_pathway: string;
  scale: number | null;
  answers: Record<string, unknown>;
  status: string;
  created_at: string;
  unstructured_stress_quote?: string | null;
  freeform_extraction?: { threat_detected?: boolean; threat_source?: string | null } | null;
  validation_text?: string | null;
};

// Normalized shape for the shared convert-to-contact dialog, regardless of source.
type ConvertTarget = {
  source: "discovery" | "georgia2";
  id: string;
  first_name: string;
  email: string | null;
  phone: string | null;
};

const ROLE_OPTIONS = [
  { value: "head_of_family", label: "Head of Family" },
  { value: "spouse", label: "Spouse" },
  { value: "beneficiary", label: "Beneficiary" },
];

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);

export default function Leads() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [convertTarget, setConvertTarget] = useState<ConvertTarget | null>(null);
  const [familyName, setFamilyName] = useState("");
  const [householdLabel, setHouseholdLabel] = useState("Primary");
  const [role, setRole] = useState("head_of_family");

  const { data: discoveryLeads, isLoading: discoveryLoading } = useQuery({
    queryKey: ["discovery-leads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("discovery_leads")
        .select("*")
        .not("sovereignty_status", "in", "(converted_to_contact,dismissed)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as DiscoveryLead[];
    },
  });

  const { data: georgia2Leads, isLoading: georgia2Loading } = useQuery({
    queryKey: ["georgia2-leads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("georgia2_leads" as any)
        .select("*")
        .not("status", "in", "(converted_to_contact,dismissed)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as Georgia2Lead[];
    },
  });

  const dismissDiscoveryMutation = useMutation({
    mutationFn: async (leadId: string) => {
      const { error } = await supabase
        .from("discovery_leads")
        .update({ sovereignty_status: "dismissed" })
        .eq("id", leadId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["discovery-leads"] });
      toast.success("Lead dismissed");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to dismiss lead");
    },
  });

  const dismissGeorgia2Mutation = useMutation({
    mutationFn: async (leadId: string) => {
      const { error } = await supabase
        .from("georgia2_leads" as any)
        .update({ status: "dismissed" } as any)
        .eq("id", leadId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["georgia2-leads"] });
      toast.success("Lead dismissed");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to dismiss lead");
    },
  });

  const openConvertDialog = (target: ConvertTarget) => {
    setConvertTarget(target);
    setFamilyName(`The ${target.first_name} Family`);
    setHouseholdLabel("Primary");
    setRole("head_of_family");
  };

  const recalcTier = async (familyId: string) => {
    try {
      await supabase.functions.invoke("calculate-family-fee-tier", {
        body: { familyId },
      });
    } catch {
      /* silent */
    }
  };

  const convertMutation = useMutation({
    mutationFn: async () => {
      if (!user || !convertTarget) throw new Error("Not authenticated");

      // 1. Create Family
      const { data: family, error: familyErr } = await supabase
        .from("families" as any)
        .insert({ name: familyName.trim(), created_by: user.id } as any)
        .select()
        .single();
      if (familyErr || !family) throw familyErr ?? new Error("Failed to create family");

      // 2. Create Household under Family
      const { data: household, error: hhErr } = await supabase
        .from("households" as any)
        .insert({
          family_id: (family as any).id,
          label: householdLabel.trim() || "Primary",
          governance_status: "stabilization",
        } as any)
        .select()
        .single();
      if (hhErr || !household) throw hhErr ?? new Error("Failed to create household");

      // 3. Create Contact linked to Family + Household
      const nameParts = convertTarget.first_name.trim().split(" ");
      const firstName = nameParts[0] ?? "";
      const lastName = nameParts.slice(1).join(" ") || null;

      const { data: contact, error: contactErr } = await supabase
        .from("contacts")
        .insert({
          first_name: firstName,
          last_name: lastName,
          full_name: convertTarget.first_name.trim(),
          email: convertTarget.email,
          phone: convertTarget.phone,
          family_role: role as any,
          family_id: (family as any).id,
          household_id: (household as any).id,
          created_by: user.id,
        })
        .select()
        .single();
      if (contactErr || !contact) throw contactErr ?? new Error("Failed to create contact");

      // 4. Mark lead as converted (hide from queue) and, for discovery leads only,
      // carry over any Stabilization Map (georgia2 leads have no equivalent).
      if (convertTarget.source === "discovery") {
        await supabase
          .from("discovery_leads")
          .update({ sovereignty_status: "converted_to_contact" })
          .eq("id", convertTarget.id);
        await supabase
          .from("stabilization_maps")
          .update({ contact_id: contact.id })
          .eq("lead_id", convertTarget.id);
      } else {
        await supabase
          .from("georgia2_leads" as any)
          .update({ status: "converted_to_contact" } as any)
          .eq("id", convertTarget.id);
      }

      // 5. Trigger fee tier calculation
      await recalcTier((family as any).id);

      return contact;
    },
    onSuccess: (contact) => {
      queryClient.invalidateQueries({ queryKey: ["discovery-leads"] });
      queryClient.invalidateQueries({ queryKey: ["georgia2-leads"] });
      setConvertTarget(null);
      toast.success("Lead converted — Family & Household initialized", {
        action: {
          label: "View Contact",
          onClick: () => navigate(`/contacts/${contact.id}`),
        },
      });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to convert lead");
    },
  });

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageBreadcrumbs
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Leads" },
          ]}
        />
        <CrmTabs />
        <div>
          <h1 className="text-3xl font-bold text-foreground">Leads</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Prospects from VFO Onboarding and the Georgia 2.0 intake flow
          </p>
        </div>

        <div className="flex items-start gap-3 rounded-md border border-border bg-muted/30 p-4">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="space-y-1 text-sm">
            <p className="font-medium text-foreground">What happens on conversion?</p>
            <p className="text-muted-foreground">
              <strong>Convert to Contact</strong> initializes a Family and Household in the
              Sovereignty Tree, creates a Contact record, and triggers fee tier calculation
              (Stabilization Map carry-over applies to VFO Onboarding leads only).{" "}
              <strong>Dismiss</strong> removes the lead from this queue without creating any records.
            </p>
          </div>
        </div>

        <Tabs defaultValue="vfo" className="w-full">
          <TabsList>
            <TabsTrigger value="vfo" className="gap-1.5">
              VFO Onboarding
              {!!discoveryLeads?.length && (
                <Badge variant="secondary" className="text-[10px]">{discoveryLeads.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="georgia2" className="gap-1.5">
              Georgia 2.0
              {!!georgia2Leads?.length && (
                <Badge variant="secondary" className="text-[10px]">{georgia2Leads.length}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="vfo" className="mt-4">
            {discoveryLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !discoveryLeads?.length ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
                  <UserPlus className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No pending VFO Onboarding leads.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {discoveryLeads.map((lead) => (
                  <Card key={lead.id}>
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <h3 className="text-base font-semibold text-foreground">{lead.first_name}</h3>
                          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                            {lead.email && <span>{lead.email}</span>}
                            {lead.phone && <span>{lead.phone}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant="outline" className="text-[10px]">
                            {lead.transition_type?.replace(/_/g, " ") || "Discovery"}
                          </Badge>
                          <Badge variant="secondary" className="text-[10px]">
                            {lead.sovereignty_status?.replace(/_/g, " ")}
                          </Badge>
                        </div>
                      </div>

                      {(lead.anxiety_anchor || lead.vision_summary || lead.vineyard_summary || lead.discovery_notes) && (
                        <div className="mt-3 space-y-2 rounded-md border border-border bg-muted/30 p-3">
                          {lead.anxiety_anchor && (
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Anxiety Anchor</p>
                              <p className="text-sm text-foreground">{lead.anxiety_anchor}</p>
                            </div>
                          )}
                          {lead.vision_summary && (
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Vision</p>
                              <p className="text-sm text-foreground">{lead.vision_summary}</p>
                            </div>
                          )}
                          {lead.vineyard_summary && (
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Vineyard Summary</p>
                              <p className="text-sm text-foreground">{lead.vineyard_summary}</p>
                            </div>
                          )}
                          {lead.discovery_notes && (
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Notes</p>
                              <p className="text-sm text-foreground">{lead.discovery_notes}</p>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="mt-3 flex items-center justify-between gap-2">
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(lead.created_at), "MMM d, yyyy 'at' h:mm a")}
                        </p>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => dismissDiscoveryMutation.mutate(lead.id)}
                            disabled={dismissDiscoveryMutation.isPending}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <X className="mr-1.5 h-3.5 w-3.5" />
                            Dismiss
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => navigate(`/stabilization-map/lead/${lead.id}`)}>
                            <FileText className="mr-1.5 h-3.5 w-3.5" />
                            Stabilization Map
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openConvertDialog({
                              source: "discovery",
                              id: lead.id,
                              first_name: lead.first_name,
                              email: lead.email,
                              phone: lead.phone,
                            })}
                          >
                            <ArrowRight className="mr-1.5 h-3.5 w-3.5" />
                            Convert to Contact
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="georgia2" className="mt-4">
            {georgia2Loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !georgia2Leads?.length ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
                  <UserPlus className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No pending Georgia 2.0 leads.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {georgia2Leads.map((lead) => (
                  <Card key={lead.id}>
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <h3 className="text-base font-semibold text-foreground">{lead.first_name}</h3>
                          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                            {lead.email && <span>{lead.email}</span>}
                            {lead.mobile && <span>{lead.mobile}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {lead.chosen_pathway === "urgent_contact" && (
                            <Badge variant="destructive" className="text-[10px]">URGENT · asked for a personal reply</Badge>
                          )}
                          {lead.chosen_pathway !== "urgent_contact" && lead.freeform_extraction?.threat_detected && (
                            <Badge variant="outline" className="border-destructive/50 text-[10px] text-destructive">
                              Free text flagged
                            </Badge>
                          )}
                          {lead.status === "pending_survey_payment" && (
                            <Badge className="text-[10px]">Survey clicked · awaiting payment</Badge>
                          )}
                          <Badge variant="outline" className="text-[10px] capitalize">{lead.domain}</Badge>
                          {lead.scale != null && (
                            <Badge variant="secondary" className="text-[10px]">{formatCurrency(lead.scale)}</Badge>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 space-y-2 rounded-md border border-border bg-muted/30 p-3">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Catalyst</p>
                          <p className="text-sm text-foreground">{lead.catalyst.replace(/_/g, " ")}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Chosen Pathway</p>
                          <p className="text-sm text-foreground">{lead.chosen_pathway.replace(/_/g, " ")}</p>
                        </div>
                        {lead.unstructured_stress_quote && (
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">In their words</p>
                            <p className="mt-1 whitespace-pre-wrap text-sm italic text-foreground">{lead.unstructured_stress_quote}</p>
                          </div>
                        )}
                        {lead.answers && Object.keys(lead.answers).length > 0 && (
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Diagnostic Answers</p>
                            <div className="mt-1 space-y-0.5">
                              {Object.entries(lead.answers).map(([key, value]) => (
                                <p key={key} className="text-sm text-foreground">
                                  <span className="text-muted-foreground">{key.replace(/_/g, " ")}: </span>
                                  {String(value)}
                                </p>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-2">
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(lead.created_at), "MMM d, yyyy 'at' h:mm a")}
                        </p>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => dismissGeorgia2Mutation.mutate(lead.id)}
                            disabled={dismissGeorgia2Mutation.isPending}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <X className="mr-1.5 h-3.5 w-3.5" />
                            Dismiss
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openConvertDialog({
                              source: "georgia2",
                              id: lead.id,
                              first_name: lead.first_name,
                              email: lead.email,
                              phone: lead.mobile,
                            })}
                          >
                            <ArrowRight className="mr-1.5 h-3.5 w-3.5" />
                            Convert to Contact
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Conversion Dialog — shared by both sources */}
      <Dialog
        open={!!convertTarget}
        onOpenChange={(open) => { if (!open) setConvertTarget(null); }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TreesIcon className="h-5 w-5 text-primary" />
              Initialize Family Structure
            </DialogTitle>
            <DialogDescription>
              Converting <strong>{convertTarget?.first_name}</strong> will create a Contact and
              initialize their Family &amp; Household in the Sovereignty Tree.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="familyName">Family Name</Label>
              <Input
                id="familyName"
                value={familyName}
                onChange={(e) => setFamilyName(e.target.value)}
                placeholder="e.g. The Smith Family"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="householdLabel">Household Label</Label>
              <Input
                id="householdLabel"
                value={householdLabel}
                onChange={(e) => setHouseholdLabel(e.target.value)}
                placeholder="e.g. Primary"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role">Role in Family</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => convertMutation.mutate()}
              disabled={convertMutation.isPending || !familyName.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {convertMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Confirm & Convert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
