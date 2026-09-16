import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/components/ui/collapsible";
import { Badge } from "@/shared/components/ui/badge";
import { InlineEdit } from "@/shared/components/InlineEdit";
import { ChevronRight, ChevronDown, TreesIcon, Home, User, Crown, Shield, Baby } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { Family, Selected, SelectedType } from "./types";
import { SERVICE_TIER_LABEL, type ServiceTier } from "@/shared/lib/serviceTier";

export const ROLE_ICONS: Record<string, typeof Crown> = {
  head_of_family: Crown,
  spouse: Shield,
  beneficiary: User,
  minor: Baby,
};

export const ROLE_LABELS: Record<string, string> = {
  head_of_family: "Head of Family",
  head_of_household: "Head of Household",
  spouse: "Spouse",
  beneficiary: "Beneficiary",
  minor: "Minor",
};

export const TIER_COLORS: Record<string, string> = {
  sovereign: "bg-muted text-muted-foreground",
  legacy: "bg-accent/20 text-accent border-accent/30",
  dynasty: "bg-primary/20 text-primary border-primary/30",
};

export const TIER_LABELS: Record<string, string> = {
  sovereign: "Sovereign Tier",
  legacy: "Legacy Tier — 15% Discount",
  dynasty: "Dynasty Tier — 25% Discount",
};

const ROLE_SORT_ORDER: Record<string, number> = {
  head_of_family: 0,
  head_of_household: 1,
  spouse: 2,
  beneficiary: 3,
  minor: 4,
};

interface Props {
  families: Family[];
  openFamilies: Set<string>;
  openHouseholds: Set<string>;
  toggleFamily: (id: string) => void;
  toggleHousehold: (id: string) => void;
  selected: Selected;
  onSelect: (type: SelectedType, id: string) => void;
  updateFamilyName: (id: string, name: string) => void | Promise<void>;
  updateHouseholdField: (id: string, field: "label" | "address", value: string) => void | Promise<void>;
  updateContactName: (id: string, field: "first_name" | "last_name", value: string) => void | Promise<void>;
}

export function FamilyTreeList({
  families,
  openFamilies,
  openHouseholds,
  toggleFamily,
  toggleHousehold,
  selected,
  onSelect,
  updateFamilyName,
  updateHouseholdField,
  updateContactName,
}: Props) {
  return (
    <div className="space-y-2">
      {families.map((family) => {
        const isOpen = openFamilies.has(family.id);
        const isSelected = selected?.type === "family" && selected.id === family.id;
        return (
          <div key={family.id} className="overflow-hidden rounded-lg border border-border">
            <Collapsible open={isOpen} onOpenChange={() => toggleFamily(family.id)}>
              <div
                className={cn(
                  "flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors",
                  isSelected ? "bg-primary/10" : "hover:bg-muted/40",
                )}
                onClick={() => onSelect("family", family.id)}
              >
                <CollapsibleTrigger asChild>
                  <button
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                  >
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                </CollapsibleTrigger>
                <TreesIcon className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <InlineEdit
                    value={family.name}
                    onSave={(v) => updateFamilyName(family.id, v)}
                    className="truncate text-sm font-semibold"
                  />
                  <p className="text-xs text-muted-foreground">
                    {family.households.length} household{family.households.length !== 1 ? "s" : ""} ·{" "}
                    {family.households.reduce((sum, h) => sum + h.individuals.length, 0)} individuals
                  </p>
                </div>
                <Badge className={cn("shrink-0", TIER_COLORS[family.fee_tier] || "")}>
                  {TIER_LABELS[family.fee_tier] || family.fee_tier}
                </Badge>
                {family.service_tier && (
                  <Badge variant="outline" className="shrink-0 text-[10px]" title="Staff-only — not visible to clients">
                    {SERVICE_TIER_LABEL[family.service_tier as ServiceTier]}
                  </Badge>
                )}
              </div>

              <CollapsibleContent>
                <div className="border-t border-border">
                  {family.households.map((household) => {
                    const hhOpen = openHouseholds.has(household.id);
                    const hhSelected = selected?.type === "household" && selected.id === household.id;
                    return (
                      <Collapsible key={household.id} open={hhOpen} onOpenChange={() => toggleHousehold(household.id)}>
                        <div
                          className={cn(
                            "flex cursor-pointer items-center gap-3 py-2 pl-9 pr-3 transition-colors",
                            hhSelected ? "bg-primary/10" : "hover:bg-muted/30",
                          )}
                          onClick={() => onSelect("household", household.id)}
                        >
                          <CollapsibleTrigger asChild>
                            <button
                              onClick={(e) => e.stopPropagation()}
                              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                            >
                              {hhOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            </button>
                          </CollapsibleTrigger>
                          <Home className="h-3.5 w-3.5 shrink-0 text-accent" />
                          <InlineEdit
                            value={household.label}
                            onSave={(v) => updateHouseholdField(household.id, "label", v)}
                            className="min-w-0 flex-1 truncate text-sm"
                          />
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {household.individuals.length} member{household.individuals.length !== 1 ? "s" : ""}
                          </span>
                        </div>

                        <CollapsibleContent>
                          {[...household.individuals]
                            .sort((a, b) => (ROLE_SORT_ORDER[a.family_role] ?? 4) - (ROLE_SORT_ORDER[b.family_role] ?? 4))
                            .map((individual) => {
                              const RoleIcon = ROLE_ICONS[individual.family_role] || User;
                              const contactSelected = selected?.type === "contact" && selected.id === individual.id;
                              return (
                                <div
                                  key={individual.id}
                                  className={cn(
                                    "flex cursor-pointer items-center gap-3 py-2 pl-16 pr-3 transition-colors",
                                    contactSelected ? "bg-primary/10" : "hover:bg-muted/30",
                                  )}
                                  onClick={() => onSelect("contact", individual.id)}
                                >
                                  <RoleIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                  <div className="flex min-w-0 flex-1 items-center gap-1 text-sm">
                                    <InlineEdit
                                      value={individual.first_name}
                                      onSave={(v) => updateContactName(individual.id, "first_name", v)}
                                      className="shrink-0"
                                    />
                                    <InlineEdit
                                      value={individual.last_name || ""}
                                      onSave={(v) => updateContactName(individual.id, "last_name", v)}
                                      placeholder="Last name"
                                      className="min-w-0 flex-1 truncate"
                                    />
                                  </div>
                                  <Badge variant="outline" className="shrink-0 text-[10px]">
                                    {ROLE_LABELS[individual.family_role] || individual.family_role}
                                  </Badge>
                                </div>
                              );
                            })}
                          {household.individuals.length === 0 && (
                            <p className="py-2 pl-16 text-xs text-muted-foreground">No members in this household.</p>
                          )}
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  })}
                  {family.households.length === 0 && (
                    <p className="py-2 pl-9 text-xs text-muted-foreground">No households yet.</p>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        );
      })}
    </div>
  );
}
