import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/shared/integrations/supabase/client";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { InlineEdit } from "@/shared/components/InlineEdit";
import { FamilyRollup } from "@/modules/crm/components/FamilyRollup";
import { dialViaQuo } from "@/shared/lib/quo-dial";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
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
import {
  X,
  MoreHorizontal,
  Plus,
  Trash2,
  MoveRight,
  ArrowRightLeft,
  Scissors,
  Cross,
  Unlink,
  Mail,
  Phone,
  ExternalLink,
  User,
  Home,
  TreesIcon,
  Wallet,
  Loader2,
} from "lucide-react";
import { ROLE_ICONS, ROLE_LABELS } from "./FamilyTreeList";
import type { ResolvedSelection } from "./types";
import { SERVICE_TIER_LABEL, type ServiceTier } from "@/shared/lib/serviceTier";

type ConfirmKind = "deleteFamily" | "deleteHousehold" | "markDeceased" | "removeIndividual" | null;

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

interface Props {
  selection: ResolvedSelection;
  onClose: () => void;
  onSelectHousehold: (id: string) => void;
  onSelectContact: (id: string) => void;
  onRefetch: () => void;
  updateFamilyName: (id: string, name: string) => void | Promise<void>;
  deleteFamily: (id: string) => void | Promise<void>;
  updateHouseholdField: (id: string, field: "label" | "address", value: string) => void | Promise<void>;
  updateContactName: (id: string, field: "first_name" | "last_name", value: string) => void | Promise<void>;
  deleteHousehold: (id: string) => void | Promise<void>;
  onAddHousehold: (familyId: string) => void;
  onAddIndividual: (familyId: string, householdId: string) => void;
  onMoveHousehold: (householdId: string, householdLabel: string, currentFamilyId: string) => void;
  onReassign: (individual: { id: string; first_name: string; last_name: string | null }, familyId: string, householdId: string) => void;
  onDecoupler: (contactId: string, contactName: string, familyId: string, familyName: string) => void;
  markDeceased: (contactId: string, firstName: string, lastName: string | null) => void | Promise<void>;
  unlinkIndividual: (contactId: string, familyId: string) => void | Promise<void>;
}

export function DetailPanel({
  selection,
  onClose,
  onSelectHousehold,
  onSelectContact,
  onRefetch,
  updateFamilyName,
  deleteFamily,
  updateHouseholdField,
  updateContactName,
  deleteHousehold,
  onAddHousehold,
  onAddIndividual,
  onMoveHousehold,
  onReassign,
  onDecoupler,
  markDeceased,
  unlinkIndividual,
}: Props) {
  const [confirm, setConfirm] = useState<ConfirmKind>(null);
  const [aumTotal, setAumTotal] = useState<number | null>(null);
  const [aumLoading, setAumLoading] = useState(true);

  const { family } = selection;
  const household = selection.type !== "family" ? selection.household : undefined;
  const individual = selection.type === "contact" ? selection.individual : undefined;

  useEffect(() => {
    const contactIds =
      selection.type === "family"
        ? selection.family.households.flatMap((h) => h.individuals.map((i) => i.id))
        : selection.type === "household"
          ? selection.household.individuals.map((i) => i.id)
          : [selection.individual.id];

    if (contactIds.length === 0) {
      setAumTotal(0);
      setAumLoading(false);
      return;
    }

    let cancelled = false;
    setAumLoading(true);
    (async () => {
      const [{ data: vineyard }, { data: storehouses }, { data: holdingTank }, { data: insurance }] = await Promise.all([
        supabase.from("vineyard_accounts").select("current_value").in("contact_id", contactIds),
        supabase.from("storehouses").select("current_value, asset_type").in("contact_id", contactIds),
        supabase.from("holding_tank").select("current_value").in("contact_id", contactIds).neq("status", "moved"),
        supabase.from("insurance_policies").select("cash_value").in("contact_id", contactIds),
      ]);
      if (cancelled) return;

      const sum = (rows: any[] | null, key: string) =>
        (rows || []).reduce((s, r) => s + (Number(r[key]) || 0), 0);

      const totalVineyard = sum(vineyard, "current_value");
      const nonRealEstate = (storehouses || []).filter((s: any) => s.asset_type !== "Primary Residence & Protected Legacy Accounts");
      const totalStorehouses = sum(nonRealEstate, "current_value") + sum(insurance, "cash_value");
      const totalHoldingTank = sum(holdingTank, "current_value");

      setAumTotal(totalVineyard + totalStorehouses + totalHoldingTank);
      setAumLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.type, selection.type === "family" ? selection.family.id : selection.type === "household" ? selection.household.id : selection.individual.id]);

  return (
    <div className="sticky top-6 flex max-h-[calc(100vh-6rem)] w-[400px] shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_hsl(var(--pw-navy)/0.05)]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">
            {family.name}
            {household && <> / {household.label}</>}
            {individual && <> / {individual.first_name} {individual.last_name}</>}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {selection.type === "family" && (
                <DropdownMenuItem className="text-destructive" onSelect={() => setConfirm("deleteFamily")}>
                  <Trash2 className="mr-2 h-4 w-4" /> Delete Family
                </DropdownMenuItem>
              )}
              {selection.type === "household" && (
                <>
                  <DropdownMenuItem onSelect={() => onMoveHousehold(household!.id, household!.label, family.id)}>
                    <MoveRight className="mr-2 h-4 w-4" /> Move to Another Family
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive" onSelect={() => setConfirm("deleteHousehold")}>
                    <Trash2 className="mr-2 h-4 w-4" /> Delete Household
                  </DropdownMenuItem>
                </>
              )}
              {selection.type === "contact" && (
                <>
                  <DropdownMenuItem asChild>
                    <Link to={`/contacts/${individual!.id}`}>
                      <ExternalLink className="mr-2 h-4 w-4" /> Open Full Profile
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => onReassign(individual!, family.id, household!.id)}>
                    <ArrowRightLeft className="mr-2 h-4 w-4" /> Reassign to Another Household
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      onDecoupler(individual!.id, `${individual!.first_name} ${individual!.last_name || ""}`.trim(), family.id, family.name)
                    }
                  >
                    <Scissors className="mr-2 h-4 w-4" /> Decoupler Protocol
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setConfirm("markDeceased")}>
                    <Cross className="mr-2 h-4 w-4" /> Mark as Deceased
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive" onSelect={() => setConfirm("removeIndividual")}>
                    <Unlink className="mr-2 h-4 w-4" /> Remove from Household
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        <div className="flex items-center gap-2">
          {selection.type === "family" && <TreesIcon className="h-5 w-5 shrink-0 text-primary" />}
          {selection.type === "household" && <Home className="h-5 w-5 shrink-0 text-accent" />}
          {selection.type === "contact" &&
            (() => {
              const RoleIcon = ROLE_ICONS[individual!.family_role] || User;
              return <RoleIcon className="h-5 w-5 shrink-0 text-muted-foreground" />;
            })()}
          {selection.type === "family" && (
            <InlineEdit value={family.name} onSave={(v) => updateFamilyName(family.id, v)} className="font-serif text-lg font-semibold" />
          )}
          {selection.type === "family" && family.service_tier && (
            <Badge variant="outline" className="shrink-0 text-[10px]" title="Staff-only — not visible to clients">
              {SERVICE_TIER_LABEL[family.service_tier as ServiceTier]}
            </Badge>
          )}
          {selection.type === "household" && (
            <InlineEdit
              value={household!.label}
              onSave={(v) => updateHouseholdField(household!.id, "label", v)}
              className="font-serif text-lg font-semibold"
            />
          )}
          {selection.type === "contact" && (
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <InlineEdit
                value={individual!.first_name}
                onSave={(v) => updateContactName(individual!.id, "first_name", v)}
                className="font-serif text-lg font-semibold"
              />
              <InlineEdit
                value={individual!.last_name || ""}
                onSave={(v) => updateContactName(individual!.id, "last_name", v)}
                placeholder="Last name"
                className="min-w-0 flex-1 truncate font-serif text-lg font-semibold"
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
          <Wallet className="h-4 w-4 shrink-0 text-sanctuary-bronze" />
          <span className="text-xs text-muted-foreground">Total AUM</span>
          <span className="ml-auto">
            {aumLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : (
              <span className="text-sm font-bold text-sanctuary-bronze">{formatCurrency(aumTotal || 0)}</span>
            )}
          </span>
        </div>

        {/* Family body */}
        {selection.type === "family" && (
          <>
            <FamilyRollup
              familyId={family.id}
              familyName={family.name}
              feeTier={family.fee_tier}
              totalAssets={family.total_family_assets}
              annualSavings={family.annual_savings}
              discountPct={family.fee_tier_discount_pct}
              onRecalculated={onRefetch}
            />
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Households ({family.households.length})
              </p>
              <div className="space-y-0.5">
                {family.households.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => onSelectHousehold(h.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/50"
                  >
                    <Home className="h-3.5 w-3.5 shrink-0 text-accent" />
                    <span className="min-w-0 flex-1 truncate">{h.label}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{h.individuals.length}</span>
                  </button>
                ))}
                <button
                  onClick={() => onAddHousehold(family.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Household
                </button>
              </div>
            </div>
          </>
        )}

        {/* Household body */}
        {selection.type === "household" && (
          <>
            <InlineEdit
              value={household!.address || ""}
              onSave={(v) => updateHouseholdField(household!.id, "address", v)}
              placeholder="Add address…"
              className="text-sm text-muted-foreground"
            />
            <div className="flex flex-wrap gap-1.5">
              {household!.governance_status && household!.governance_status !== "none" && (
                <Badge variant="outline" className="text-[10px]">
                  {household!.governance_status}
                </Badge>
              )}
              {household!.fiduciary_entity && (
                <Badge variant="outline" className="text-[10px]">
                  {household!.fiduciary_entity.toUpperCase()}
                </Badge>
              )}
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Individuals ({household!.individuals.length})
              </p>
              <div className="space-y-0.5">
                {household!.individuals.map((i) => {
                  const RoleIcon = ROLE_ICONS[i.family_role] || User;
                  return (
                    <button
                      key={i.id}
                      onClick={() => onSelectContact(i.id)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/50"
                    >
                      <RoleIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">
                        {i.first_name} {i.last_name}
                      </span>
                    </button>
                  );
                })}
                <button
                  onClick={() => onAddIndividual(family.id, household!.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Individual
                </button>
              </div>
            </div>
          </>
        )}

        {/* Contact body */}
        {selection.type === "contact" && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline" className="text-[10px]">
                {ROLE_LABELS[individual!.family_role] || individual!.family_role}
              </Badge>
              {individual!.is_minor && (
                <Badge variant="secondary" className="text-[10px]">
                  Minor
                </Badge>
              )}
            </div>
            {individual!.email && (
              <a href={`mailto:${individual!.email}`} className="flex items-center gap-2 text-sm hover:underline">
                <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {individual!.email}
              </a>
            )}
            {individual!.phone && (
              <button
                type="button"
                onClick={() => dialViaQuo(individual!.phone!)}
                className="flex items-center gap-2 text-sm hover:underline"
              >
                <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {individual!.phone}
              </button>
            )}
            <Link to={`/contacts/${individual!.id}`} className="flex items-center gap-2 text-sm text-primary hover:underline">
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              Open full profile
            </Link>
          </div>
        )}
      </div>

      {/* Confirm dialogs — controlled, not nested in the dropdown, to avoid Radix focus issues */}
      <AlertDialog open={confirm === "deleteFamily"} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Family</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{family.name}" and all its households. Individuals will be unlinked but not deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                deleteFamily(family.id);
                setConfirm(null);
                onClose();
              }}
            >
              Delete Family
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirm === "deleteHousehold"} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Household</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the "{household?.label}" household. Individuals will be unlinked but not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                deleteHousehold(household!.id);
                setConfirm(null);
                onClose();
              }}
            >
              Delete Household
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirm === "markDeceased"} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark as Deceased</AlertDialogTitle>
            <AlertDialogDescription>
              This will rename the contact record to "The Estate of — {individual?.first_name} {individual?.last_name}". The individual will remain in their household. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                markDeceased(individual!.id, individual!.first_name, individual!.last_name);
                setConfirm(null);
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirm === "removeIndividual"} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Individual</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove {individual?.first_name} {individual?.last_name} from this household and family. The contact record will not be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                unlinkIndividual(individual!.id, family.id);
                setConfirm(null);
                onClose();
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
