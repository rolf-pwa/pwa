import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import {
  CheckCircle2,
  Database,
  ListTodo,
  Loader2,
  UserPlus,
  UserCog,
  Grape,
  Shield,
  ArrowDownUp,
  MapPin,
  Clock,
} from "lucide-react";
import { supabase } from "@/shared/integrations/supabase/client";
import { logAuditAction, type FunctionCall } from "@/shared/lib/vertex-ai";
import { toast } from "sonner";

interface ProposedUpdateCardProps {
  functionCall: FunctionCall;
  contactId?: string;
  householdId?: string;
  isApproved: boolean;
  onApproved: () => void;
}

const CARD_CONFIG: Record<string, { icon: typeof Database; label: string; color: string }> = {
  propose_vineyard_update: { icon: Database, label: "Vineyard Update", color: "text-sanctuary-green" },
  propose_storehouse_update: { icon: Database, label: "Storehouse Update", color: "text-sanctuary-bronze" },
  draft_pm_task: { icon: ListTodo, label: "Draft PM Task", color: "text-purple-500" },
  create_contact: { icon: UserPlus, label: "New Contact", color: "text-emerald-500" },
  update_contact: { icon: UserCog, label: "Update Contact", color: "text-amber-500" },
  ingest_vineyard_accounts: { icon: Grape, label: "Charter → Vineyard Accounts", color: "text-sanctuary-green" },
  ingest_storehouse_rules: { icon: Shield, label: "Charter → Storehouse Rules", color: "text-sanctuary-bronze" },
  ingest_waterfall_priorities: { icon: ArrowDownUp, label: "Charter → Waterfall Priorities", color: "text-indigo-500" },
  ingest_audit_territory: { icon: MapPin, label: "Draft Territory — Audit Ingestion", color: "text-emerald-600" },
};

export function ProposedUpdateCard({ functionCall, contactId, householdId, isApproved, onApproved }: ProposedUpdateCardProps) {
  const [loading, setLoading] = useState(false);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queued, setQueued] = useState(false);
  const config = CARD_CONFIG[functionCall.name] || { icon: Database, label: "Action", color: "text-foreground" };
  const Icon = config.icon;
  const args = functionCall.args;

  const handleApprove = async () => {
    setLoading(true);
    try {
      const cid = args.contact_id || contactId;

      switch (functionCall.name) {
        case "propose_vineyard_update": {
          const updates: Record<string, any> = {};
          if (args.vineyard_ebitda != null) updates.vineyard_ebitda = args.vineyard_ebitda;
          if (args.vineyard_operating_income != null) updates.vineyard_operating_income = args.vineyard_operating_income;
          if (args.vineyard_balance_sheet_summary) updates.vineyard_balance_sheet_summary = args.vineyard_balance_sheet_summary;

          if (Object.keys(updates).length > 0 && cid) {
            const { error } = await supabase.from("contacts").update(updates).eq("id", cid);
            if (error) throw error;
          }

          if (cid) {
            await logAuditAction(
              cid,
              "vineyard_update",
              `AI Assistant proposed Vineyard update for ${args.contact_name}: ${args.rationale}`,
              args
            );
          }
          toast.success("Vineyard data updated & logged to audit trail.");
          break;
        }

        case "propose_storehouse_update": {
          if (!cid) throw new Error("No contact ID");
          const storehouseData: Record<string, any> = {
            contact_id: cid,
            storehouse_number: args.storehouse_number,
          };
          if (args.label) storehouseData.label = args.label;
          if (args.asset_type) storehouseData.asset_type = args.asset_type;
          if (args.current_value != null) storehouseData.current_value = args.current_value;
          if (args.target_value != null) storehouseData.target_value = args.target_value;
          if (args.risk_cap) storehouseData.risk_cap = args.risk_cap;
          if (args.charter_alignment) storehouseData.charter_alignment = args.charter_alignment;
          if (args.notes) storehouseData.notes = args.notes;

          const { data: existing } = await supabase
            .from("storehouses")
            .select("id")
            .eq("contact_id", cid)
            .eq("storehouse_number", args.storehouse_number)
            .maybeSingle();

          if (existing) {
            const { error } = await supabase.from("storehouses").update(storehouseData).eq("id", existing.id);
            if (error) throw error;
          } else {
            const { error } = await supabase.from("storehouses").insert(storehouseData as any);
            if (error) throw error;
          }

          await logAuditAction(
            cid,
            "storehouse_update",
            `AI Assistant proposed Storehouse ${args.storehouse_number} update for ${args.contact_name}: ${args.rationale}`,
            args
          );
          toast.success("Storehouse updated & logged to audit trail.");
          break;
        }

        case "draft_pm_task": {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) throw new Error("Not authenticated");

          let description: string = args.description || "";
          if (args.priority) description = `[Priority: ${args.priority}] ${description}`.trim();

          // Cast as `any`: the generated pm_tasks type in
          // src/integrations/supabase/types.ts is stale and missing
          // client_visible/family_id, which are confirmed live columns.
          const taskData: Record<string, any> = {
            title: args.title,
            description: description || null,
            status: "open",
            client_visible: false,
            created_by: user.id,
          };
          if (cid) taskData.contact_id = cid;
          if (args.due_date) taskData.due_date = args.due_date;

          let projectMatchWarning = "";
          if (args.project_name) {
            const { data: projects } = await supabase
              .from("pm_projects")
              .select("id, name")
              .ilike("name", `%${args.project_name}%`)
              .limit(1);
            const project = projects?.[0];
            if (project) {
              taskData.project_id = project.id;
            } else {
              projectMatchWarning = ` (no project named "${args.project_name}" found — created without a project)`;
            }
          }

          const { error } = await supabase.from("pm_tasks").insert(taskData as any);
          if (error) throw error;

          if (cid) {
            await logAuditAction(
              cid,
              "draft_pm_task",
              `AI Assistant drafted PM task "${args.title}" for ${args.contact_name || "—"}`,
              args
            );
          }
          toast.success(`Task "${args.title}" created as a draft in PM (internal-only)${projectMatchWarning}.`);
          break;
        }

        case "create_contact": {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) throw new Error("Not authenticated");

          const fullName = [args.first_name, args.last_name].filter(Boolean).join(" ");
          const contactData: Record<string, any> = {
            first_name: args.first_name,
            full_name: fullName,
            created_by: user.id,
          };
          if (args.last_name) contactData.last_name = args.last_name;
          if (args.email) contactData.email = args.email;
          if (args.phone) contactData.phone = args.phone;
          if (args.address) contactData.address = args.address;
          // fiduciary_entity/governance_status live on households, not
          // contacts -- a brand-new contact has no household link yet in
          // this same call, so there's nothing to write them onto here.

          const { data: newContact, error } = await supabase
            .from("contacts")
            .insert(contactData as any)
            .select("id")
            .single();
          if (error) throw error;

          await logAuditAction(
            newContact.id,
            "create_contact",
            `AI Assistant created contact "${fullName}": ${args.rationale}`,
            args
          );
          toast.success(`Contact "${fullName}" created successfully.`);
          break;
        }

        case "update_contact": {
          if (!cid) throw new Error("No contact ID");
          const updates: Record<string, any> = {};
          const fieldsToCopy = [
            "first_name", "last_name", "email", "phone", "address",
            "google_drive_url",
            "ia_financial_url",
            "lawyer_name", "lawyer_firm", "accountant_name", "accountant_firm",
          ];
          for (const field of fieldsToCopy) {
            if (args[field] != null) updates[field] = args[field];
          }
          // Recompute full_name if name fields changed
          if (updates.first_name || updates.last_name) {
            const { data: current } = await supabase.from("contacts").select("first_name, last_name").eq("id", cid).single();
            const fn = updates.first_name || current?.first_name || "";
            const ln = updates.last_name ?? current?.last_name ?? "";
            updates.full_name = [fn, ln].filter(Boolean).join(" ");
          }

          if (Object.keys(updates).length > 0) {
            const { error } = await supabase.from("contacts").update(updates).eq("id", cid);
            if (error) throw error;
          }

          // fiduciary_entity/governance_status live on the contact's
          // household, not the contact itself -- write there instead. If
          // this contact has no household yet, these two fields are
          // silently skipped (a real, expected case, not an error).
          const householdUpdates: Record<string, any> = {};
          if (args.fiduciary_entity != null) householdUpdates.fiduciary_entity = args.fiduciary_entity;
          if (args.governance_status != null) householdUpdates.governance_status = args.governance_status;
          if (Object.keys(householdUpdates).length > 0 && householdId) {
            const { error } = await supabase.from("households").update(householdUpdates).eq("id", householdId);
            if (error) throw error;
          }

          await logAuditAction(
            cid,
            "update_contact",
            `AI Assistant updated contact "${args.contact_name}": ${args.rationale}`,
            args
          );
          toast.success(`Contact "${args.contact_name}" updated.`);
          break;
        }

        case "ingest_vineyard_accounts": {
          if (!cid) throw new Error("No contact ID for Vineyard ingestion");
          const accounts = args.accounts || [];
          for (const acct of accounts) {
            const { error } = await supabase.from("vineyard_accounts").insert({
              contact_id: cid,
              account_name: acct.account_name,
              account_type: acct.account_type || "Portfolio",
              account_number: acct.account_number || null,
              current_value: acct.current_value || null,
            } as any);
            if (error) console.error("Vineyard insert error:", error);
          }
          await logAuditAction(
            cid,
            "charter_vineyard_ingestion",
            `Charter ingestion: ${accounts.length} Vineyard accounts extracted for ${args.contact_name} (${args.family_name}). ${args.rationale}`,
            args
          );
          toast.success(`${accounts.length} Vineyard accounts ingested from charter.`);
          break;
        }

        case "ingest_storehouse_rules": {
          // Find family by name to get family_id
          const { data: families } = await supabase
            .from("families")
            .select("id")
            .ilike("name", `%${args.family_name}%`)
            .limit(1);
          const familyId = families?.[0]?.id;
          if (!familyId) throw new Error(`Family "${args.family_name}" not found`);

          const rules = args.rules || [];
          for (const rule of rules) {
            const { error } = await supabase.from("storehouse_rules" as any).insert({
              family_id: familyId,
              storehouse_label: rule.storehouse_label,
              storehouse_number: rule.storehouse_number,
              rule_type: rule.rule_type,
              rule_description: rule.rule_description,
              rule_value: rule.rule_value || null,
            } as any);
            if (error) console.error("Storehouse rule insert error:", error);
          }

          const auditContactId = cid || "00000000-0000-0000-0000-000000000000";
          if (cid) {
            await logAuditAction(
              cid,
              "charter_storehouse_rules",
              `Charter ingestion: ${rules.length} Storehouse rules extracted for ${args.family_name}. ${args.rationale}`,
              args
            );
          }
          toast.success(`${rules.length} Storehouse rules ingested from charter.`);
          break;
        }

        case "ingest_waterfall_priorities": {
          const { data: families } = await supabase
            .from("families")
            .select("id")
            .ilike("name", `%${args.family_name}%`)
            .limit(1);
          const familyId = families?.[0]?.id;
          if (!familyId) throw new Error(`Family "${args.family_name}" not found`);

          const priorities = args.priorities || [];
          for (const p of priorities) {
            const { error } = await supabase.from("waterfall_priorities" as any).insert({
              family_id: familyId,
              priority_order: p.priority_order,
              priority_label: p.priority_label,
              priority_description: p.priority_description || null,
              target_amount: p.target_amount || null,
            } as any);
            if (error) console.error("Waterfall insert error:", error);
          }

          if (cid) {
            await logAuditAction(
              cid,
              "charter_waterfall",
              `Charter ingestion: ${priorities.length} Waterfall priorities extracted for ${args.family_name}. ${args.rationale}`,
              args
            );
          }
          toast.success(`${priorities.length} Waterfall priorities ingested from charter.`);
          break;
        }

        case "ingest_audit_territory": {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) throw new Error("Not authenticated");

          // 1. Create or find family
          let familyId: string;
          const { data: existingFamily } = await supabase
            .from("families")
            .select("id")
            .ilike("name", `%${args.family_name}%`)
            .limit(1);

          if (existingFamily?.[0]) {
            familyId = existingFamily[0].id;
          } else {
            const { data: newFamily, error: famErr } = await supabase
              .from("families")
              .insert({ name: args.family_name, created_by: user.id } as any)
              .select("id")
              .single();
            if (famErr) throw famErr;
            familyId = newFamily.id;
          }

          // 2. Process each household
          for (const hh of (args.households || [])) {
            // Create household
            const { data: newHousehold, error: hhErr } = await supabase
              .from("households")
              .insert({ family_id: familyId, label: hh.label || "Primary", address: hh.address || null } as any)
              .select("id")
              .single();
            if (hhErr) throw hhErr;

            // 3. Create each member contact and their vineyard accounts
            for (const member of (hh.members || [])) {
              const fullName = [member.first_name, member.last_name].filter(Boolean).join(" ");
              const { data: newContact, error: contactErr } = await supabase
                .from("contacts")
                .insert({
                  first_name: member.first_name,
                  last_name: member.last_name || args.family_name,
                  full_name: fullName || member.first_name,
                  family_id: familyId,
                  household_id: newHousehold.id,
                  family_role: member.family_role || "beneficiary",
                  email: member.email || null,
                  phone: member.phone || null,
                  created_by: user.id,
                } as any)
                .select("id")
                .single();
              if (contactErr) throw contactErr;

              // 4. Create vineyard accounts for this contact
              for (const acct of (member.vineyard_accounts || [])) {
                await supabase.from("vineyard_accounts").insert({
                  contact_id: newContact.id,
                  account_name: acct.account_name,
                  account_type: acct.account_type || "Portfolio",
                  account_number: acct.account_number || null,
                  current_value: acct.current_value || null,
                } as any);
              }

              // Audit trail per contact
              await logAuditAction(
                newContact.id,
                "audit_territory_ingestion",
                `Audit ingestion: created "${fullName}" under ${args.family_name} with ${(member.vineyard_accounts || []).length} Vineyard accounts.`,
                { family_name: args.family_name, member, rationale: args.rationale }
              );
            }
          }

          const totalMembers = (args.households || []).reduce((sum: number, hh: any) => sum + (hh.members?.length || 0), 0);
          toast.success(`Territory created: ${args.family_name} family with ${totalMembers} contact(s).`);
          break;
        }
      }

      // Log to review queue
      try {
        const { data: { user } } = await supabase.auth.getUser();
        await (supabase.from("review_queue" as any) as any).insert({
          contact_id: cid || null,
          action_type: functionCall.name,
          action_description: args.rationale || args.title || args.subject || args.summary || config.label,
          proposed_data: args,
          logic_trace: `Auto-approved by CFO via Sovereignty Assistant. Action: ${functionCall.name}`,
          status: "approved",
          client_visible: false,
          created_by: user?.id || null,
          reviewed_by: user?.id || null,
          reviewed_at: new Date().toISOString(),
        });
      } catch {
        // Non-blocking — review queue logging is supplementary
      }

      onApproved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to execute action");
    } finally {
      setLoading(false);
    }
  };

  // Fields to hide from display
  const hiddenFields = ["contact_id", "accounts", "rules", "priorities", "households"];
  const isCharterIngestion = ["ingest_vineyard_accounts", "ingest_storehouse_rules", "ingest_waterfall_priorities"].includes(functionCall.name);
  const isAuditIngestion = functionCall.name === "ingest_audit_territory";

  return (
    <Card className="border-sanctuary-bronze/30 bg-accent/5">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${config.color}`} />
          <span className="text-xs font-semibold uppercase tracking-wider">{config.label}</span>
          <Badge variant="outline" className="ml-auto text-[10px]">
            📋 Draft for CFO Review
          </Badge>
        </div>

        {/* Charter ingestion: show summary of extracted items */}
        {isCharterIngestion && (
          <div className="space-y-1 text-xs">
            <p className="font-medium">{args.family_name}{args.contact_name ? ` — ${args.contact_name}` : ""}</p>
            {args.accounts && (
              <div className="space-y-0.5 mt-1">
                <p className="text-muted-foreground">{args.accounts.length} accounts:</p>
                {args.accounts.map((a: any, i: number) => (
                  <div key={i} className="flex justify-between pl-2 border-l-2 border-muted">
                    <span>{a.account_name} <span className="text-muted-foreground">({a.account_type})</span></span>
                    {a.current_value != null && <span className="font-medium">${Number(a.current_value).toLocaleString()}</span>}
                  </div>
                ))}
              </div>
            )}
            {args.rules && (
              <div className="space-y-0.5 mt-1">
                <p className="text-muted-foreground">{args.rules.length} rules:</p>
                {args.rules.map((r: any, i: number) => (
                  <div key={i} className="pl-2 border-l-2 border-muted">
                    <span className="font-medium">{r.storehouse_label}</span> — {r.rule_description}
                    {r.rule_value != null && <span className="text-muted-foreground"> (${Number(r.rule_value).toLocaleString()})</span>}
                  </div>
                ))}
              </div>
            )}
            {args.priorities && (
              <div className="space-y-0.5 mt-1">
                <p className="text-muted-foreground">{args.priorities.length} priorities:</p>
                {args.priorities.map((p: any, i: number) => (
                  <div key={i} className="pl-2 border-l-2 border-muted">
                    <span className="font-medium">{p.priority_order}.</span> {p.priority_label}
                    {p.priority_description && <span className="text-muted-foreground"> — {p.priority_description}</span>}
                  </div>
                ))}
              </div>
            )}
            <p className="text-muted-foreground italic mt-1">{args.rationale}</p>
          </div>
        )}

        {/* Audit territory ingestion: show full territory summary */}
        {isAuditIngestion && (
          <div className="space-y-2 text-xs">
            <p className="font-medium text-sm">Family: {args.family_name}</p>
            {(args.households || []).map((hh: any, hi: number) => (
              <div key={hi} className="space-y-1 border-l-2 border-emerald-500/50 pl-2">
                <p className="font-medium">🏠 {hh.label || "Primary"} Household{hh.address ? ` — ${hh.address}` : ""}</p>
                {(hh.members || []).map((m: any, mi: number) => (
                  <div key={mi} className="space-y-0.5 pl-2 border-l border-muted">
                    <p className="font-medium">
                      👤 {m.first_name} {m.last_name || args.family_name}
                      <span className="text-muted-foreground ml-1 capitalize">({(m.family_role || "beneficiary").replace(/_/g, " ")})</span>
                    </p>
                    {(m.vineyard_accounts || []).length > 0 && (
                      <div className="space-y-0.5 pl-2">
                        {m.vineyard_accounts.map((a: any, ai: number) => (
                          <div key={ai} className="flex justify-between">
                            <span>{a.account_name} <span className="text-muted-foreground">({a.account_type})</span></span>
                            {a.current_value != null && <span className="font-medium">${Number(a.current_value).toLocaleString()}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
            <p className="text-muted-foreground italic">{args.rationale}</p>
          </div>
        )}

        {/* Standard: Render args as key-value pairs */}
        {!isCharterIngestion && !isAuditIngestion && (
          <dl className="space-y-1 text-xs">
            {Object.entries(args)
              .filter(([key]) => !hiddenFields.includes(key))
              .map(([key, value]) => (
                <div key={key} className="flex gap-2">
                  <dt className="text-muted-foreground capitalize min-w-[100px]">
                    {key.replace(/_/g, " ")}:
                  </dt>
                  <dd className="font-medium flex-1">
                    {typeof value === "number"
                      ? `$${value.toLocaleString()}`
                      : String(value)}
                  </dd>
                </div>
              ))}
          </dl>
        )}

        {isApproved ? (
          <div className="flex items-center gap-1.5 text-xs text-sanctuary-green">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span className="font-medium">Approved by Personal CFO</span>
          </div>
        ) : queued ? (
          <div className="flex items-center gap-1.5 text-xs text-amber-600">
            <Clock className="h-3.5 w-3.5" />
            <span className="font-medium">Queued for Review</span>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleApprove}
              disabled={loading || queueLoading}
              className="flex-1 bg-sanctuary-green text-primary-foreground hover:bg-sanctuary-green/90"
            >
              {loading ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              Approve & Sync
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                setQueueLoading(true);
                try {
                  const cid = args.contact_id || contactId;
                  const { data: { user } } = await supabase.auth.getUser();
                  await (supabase.from("review_queue" as any) as any).insert({
                    contact_id: cid || null,
                    action_type: functionCall.name,
                    action_description: args.rationale || args.title || args.subject || config.label,
                    proposed_data: args,
                    logic_trace: `AI proposed: ${functionCall.name}. Queued for human review.`,
                    status: "pending",
                    client_visible: false,
                    created_by: user?.id || null,
                  });
                  setQueued(true);
                  toast.success("Added to Review Queue.");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Failed to queue");
                } finally {
                  setQueueLoading(false);
                }
              }}
              disabled={loading || queueLoading}
              className="gap-1"
            >
              {queueLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock className="h-3.5 w-3.5" />}
              Queue
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
