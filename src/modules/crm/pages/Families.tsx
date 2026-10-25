import { isFormer } from "@/shared/lib/retention";
import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/shared/integrations/supabase/client";
import { AppLayout } from "@/shared/components/AppLayout";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { PageBreadcrumbs } from "@/shared/components/PageBreadcrumbs";
import { ListRow } from "@/shared/components/ListRow";
import { CrmTabs } from "@/modules/crm/components/CrmTabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/shared/components/ui/dialog";
import { TreesIcon, User, Plus, Search, MoveRight } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { toast } from "sonner";
import { useAuth } from "@/shared/hooks/useAuth";
import { DecouplerWizard } from "@/modules/crm/components/DecouplerWizard";
import { FamilyTreeList } from "@/modules/crm/components/families/FamilyTreeList";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import { BottomSheetContent } from "@/shared/components/BottomSheet";
import { Sheet, SheetHeader, SheetTitle } from "@/shared/components/ui/sheet";
import { DetailPanel } from "@/modules/crm/components/families/DetailPanel";
import type { Family, Individual, Selected, ResolvedSelection } from "@/modules/crm/components/families/types";

const Families = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [families, setFamilies] = useState<Family[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [openFamilies, setOpenFamilies] = useState<Set<string>>(new Set());
  const [openHouseholds, setOpenHouseholds] = useState<Set<string>>(new Set());
  const phone = useIsMobile();
  const [showNewFamily, setShowNewFamily] = useState(false);
  const [newFamilyName, setNewFamilyName] = useState("");
  const [showNewHousehold, setShowNewHousehold] = useState<string | null>(null);
  const [newHouseholdLabel, setNewHouseholdLabel] = useState("");
  const [addIndividualTarget, setAddIndividualTarget] = useState<{ familyId: string; householdId: string } | null>(null);
  const [unlinkedContacts, setUnlinkedContacts] = useState<{ id: string; first_name: string; last_name: string | null; email: string | null }[]>([]);
  const [unassignedContacts, setUnassignedContacts] = useState<{ id: string; first_name: string; last_name: string | null; email: string | null }[]>([]);
  const [individualSearch, setIndividualSearch] = useState("");
  const [selectedRole, setSelectedRole] = useState<string>("beneficiary");
  const [reassignTarget, setReassignTarget] = useState<{ contactId: string; contactName: string; currentFamilyId: string; currentHouseholdId: string } | null>(null);
  const [reassignFamilyId, setReassignFamilyId] = useState<string>("");
  const [reassignHouseholdId, setReassignHouseholdId] = useState<string>("");
  const [availableHouseholds, setAvailableHouseholds] = useState<{ id: string; label: string }[]>([]);
  const [decouplerTarget, setDecouplerTarget] = useState<{ contactId: string; contactName: string; familyId: string; familyName: string } | null>(null);
  const [moveHouseholdTarget, setMoveHouseholdTarget] = useState<{ householdId: string; householdLabel: string; currentFamilyId: string } | null>(null);
  const [moveDestinationFamilyId, setMoveDestinationFamilyId] = useState<string>("");
  const [moveNewFamilyName, setMoveNewFamilyName] = useState("");
  const [moveCreateNew, setMoveCreateNew] = useState(false);
  const [selected, setSelected] = useState<Selected>(null);

  const fetchFamilies = useCallback(async () => {
    // Fetch families
    const { data: familyData } = await supabase
      .from("families" as any)
      .select("*")
      .order("name");

    if (!familyData) {
      setLoading(false);
      return;
    }

    // Fetch households
    const familyIds = (familyData as any[]).map((f: any) => f.id);
    const { data: householdData } = await supabase
      .from("households" as any)
      .select("*")
      .in("family_id", familyIds)
      .order("label");

    // Fetch individuals (contacts with family_id)
    const { data: contactData } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, family_role, is_minor, email, phone, household_id, family_id")
      .in("family_id", familyIds);

    // Build tree
    const tree: Family[] = (familyData as any[]).map((f: any) => {
      const familyHouseholds = ((householdData as any[]) || [])
        .filter((h: any) => h.family_id === f.id)
        .map((h: any) => ({
          ...h,
          individuals: ((contactData as any[]) || []).filter(
            (c: any) => c.household_id === h.id
          ),
        }))
        .sort((a: any, b: any) => {
          const aHasHead = a.individuals.some((i: any) => i.family_role === "head_of_family");
          const bHasHead = b.individuals.some((i: any) => i.family_role === "head_of_family");
          if (aHasHead && !bHasHead) return -1;
          if (!aHasHead && bHasHead) return 1;
          return a.label.localeCompare(b.label);
        });

      // Households whose relationship has ended are Former clients: out of this tree (and so out of reach of an accidental delete), but still open from the Former clients page.
      return {
        ...f,
        households: familyHouseholds.filter((h: any) => !isFormer(h)),
        allEnded: familyHouseholds.length > 0 && familyHouseholds.every((h: any) => isFormer(h)),
      };
    });

    setFamilies(tree.filter((f: any) => !f.allEnded));

    // Contacts with no family at all — otherwise invisible from this page
    const { data: orphanData } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, email")
      .is("family_id", null)
      .order("first_name");
    setUnassignedContacts(orphanData || []);

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchFamilies();
  }, [fetchFamilies]);

  const toggleFamily = (id: string) => {
    setOpenFamilies((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleHousehold = (id: string) => {
    setOpenHouseholds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const createFamily = async () => {
    if (!newFamilyName.trim() || !user) return;
    const { error } = await supabase
      .from("families" as any)
      .insert({ name: newFamilyName.trim(), created_by: user.id } as any);
    if (error) {
      toast.error("Failed to create family.");
    } else {
      toast.success("Family created.");
      setNewFamilyName("");
      setShowNewFamily(false);
      fetchFamilies();
    }
  };

  const createHousehold = async (familyId: string) => {
    if (!newHouseholdLabel.trim()) return;
    const { error } = await supabase
      .from("households" as any)
      .insert({ family_id: familyId, label: newHouseholdLabel.trim() } as any);
    if (error) {
      toast.error("Failed to create household.");
    } else {
      toast.success("Household created.");
      setNewHouseholdLabel("");
      setShowNewHousehold(null);
      fetchFamilies();
    }
  };

  const deleteFamily = async (familyId: string) => {
    // Unlink contacts first (SET NULL via FK), then delete cascades households
    const { error } = await supabase.from("families" as any).delete().eq("id", familyId);
    if (error) {
      toast.error(error.message?.includes("must be kept for 7 years") ? error.message : "Failed to delete family.");
    } else {
      toast.success("Family deleted.");
      fetchFamilies();
    }
  };

  const deleteHousehold = async (householdId: string) => {
    const { error } = await supabase.from("households" as any).delete().eq("id", householdId);
    if (error) {
      toast.error(error.message?.includes("must be kept for 7 years") ? error.message : "Failed to delete household.");
    } else {
      toast.success("Household deleted.");
      fetchFamilies();
    }
  };

  const openAddIndividual = async (familyId: string, householdId: string) => {
    setAddIndividualTarget({ familyId, householdId });
    setIndividualSearch("");
    setSelectedRole("beneficiary");
    // Fetch contacts not already in this family
    const { data } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, email, family_id")
      .order("first_name");
    setUnlinkedContacts(
      (data || []).filter((c: any) => !c.family_id || c.family_id !== familyId)
    );
  };

  const recalcTier = async (familyId: string) => {
    try {
      await supabase.functions.invoke("calculate-family-fee-tier", {
        body: { familyId },
      });
    } catch { /* silent */ }
  };

  const linkIndividual = async (contactId: string) => {
    if (!addIndividualTarget) return;
    const { error } = await supabase
      .from("contacts")
      .update({
        family_id: addIndividualTarget.familyId,
        household_id: addIndividualTarget.householdId,
        family_role: selectedRole,
      } as any)
      .eq("id", contactId);
    if (error) {
      toast.error("Failed to add individual.");
    } else {
      toast.success("Individual added to household.");
      setAddIndividualTarget(null);
      await recalcTier(addIndividualTarget.familyId);
      fetchFamilies();
    }
  };

  const createAndLinkIndividual = async (name: string) => {
    if (!addIndividualTarget || !user) return;
    const parts = name.trim().split(" ");
    const firstName = parts[0] || "";
    const lastName = parts.slice(1).join(" ") || "";
    const { data, error: createErr } = await supabase
      .from("contacts")
      .insert({
        full_name: name.trim(),
        first_name: firstName,
        last_name: lastName,
        created_by: user.id,
        family_id: addIndividualTarget.familyId,
        household_id: addIndividualTarget.householdId,
        family_role: selectedRole,
      } as any)
      .select("id")
      .single();
    if (createErr || !data) {
      toast.error("Failed to create contact.");
    } else {
      toast.success(`${name.trim()} created and added.`);
      setAddIndividualTarget(null);
      await recalcTier(addIndividualTarget.familyId);
      fetchFamilies();
    }
  };

  const unlinkIndividual = async (contactId: string, familyId: string) => {
    const { error } = await supabase
      .from("contacts")
      .update({ family_id: null, household_id: null, family_role: "head_of_family" } as any)
      .eq("id", contactId);
    if (error) {
      toast.error("Failed to unlink individual.");
    } else {
      toast.success("Individual removed from household.");
      await recalcTier(familyId);
      fetchFamilies();
    }
  };

  const markDeceased = async (contactId: string, firstName: string, lastName: string | null) => {
    const estateName = `The Estate of — ${firstName} ${lastName || ""}`.trim();
    const { error } = await supabase
      .from("contacts")
      .update({ first_name: estateName, last_name: null, full_name: estateName } as any)
      .eq("id", contactId);
    if (error) {
      toast.error("Failed to update contact record.");
    } else {
      toast.success("Contact updated to estate record.");
      fetchFamilies();
    }
  };

  const openReassign = async (individual: Individual, currentFamilyId: string, currentHouseholdId: string) => {
    setReassignTarget({
      contactId: individual.id,
      contactName: `${individual.first_name} ${individual.last_name || ""}`.trim(),
      currentFamilyId,
      currentHouseholdId,
    });
    setReassignFamilyId(currentFamilyId);
    // Load households for the current family
    const { data } = await supabase
      .from("households" as any)
      .select("id, label")
      .eq("family_id", currentFamilyId)
      .order("label");
    setAvailableHouseholds((data as any[]) || []);
    setReassignHouseholdId("");
  };

  const handleReassignFamilyChange = async (familyId: string) => {
    setReassignFamilyId(familyId);
    setReassignHouseholdId("");
    const { data } = await supabase
      .from("households" as any)
      .select("id, label")
      .eq("family_id", familyId)
      .order("label");
    setAvailableHouseholds((data as any[]) || []);
  };

  const reassignIndividual = async () => {
    if (!reassignTarget || !reassignFamilyId || !reassignHouseholdId) return;
    const { error } = await supabase
      .from("contacts")
      .update({
        family_id: reassignFamilyId,
        household_id: reassignHouseholdId,
      } as any)
      .eq("id", reassignTarget.contactId);
    if (error) {
      toast.error("Failed to reassign individual.");
    } else {
      toast.success("Individual reassigned.");
      const affectedFamilies = new Set([reassignTarget.currentFamilyId, reassignFamilyId]);
      await Promise.all(Array.from(affectedFamilies).map(recalcTier));
      setReassignTarget(null);
      fetchFamilies();
    }
  };

  const moveHouseholdToFamily = async () => {
    if (!moveHouseholdTarget || !user) return;
    let targetFamilyId = moveDestinationFamilyId;

    // Create new family if needed
    if (moveCreateNew) {
      if (!moveNewFamilyName.trim()) return;
      const { data: newFamily, error: createErr } = await supabase
        .from("families" as any)
        .insert({ name: moveNewFamilyName.trim(), created_by: user.id } as any)
        .select("id")
        .single();
      if (createErr || !newFamily) {
        toast.error("Failed to create new family.");
        return;
      }
      targetFamilyId = (newFamily as any).id;
    }

    if (!targetFamilyId || targetFamilyId === moveHouseholdTarget.currentFamilyId) return;

    // Move the household to the new family
    const { error: hhErr } = await supabase
      .from("households" as any)
      .update({ family_id: targetFamilyId } as any)
      .eq("id", moveHouseholdTarget.householdId);
    if (hhErr) {
      toast.error("Failed to move household.");
      return;
    }

    // Update all contacts in this household to the new family
    const { error: contactErr } = await supabase
      .from("contacts")
      .update({ family_id: targetFamilyId } as any)
      .eq("household_id", moveHouseholdTarget.householdId);
    if (contactErr) {
      toast.error("Household moved but failed to update contacts.");
    }

    toast.success("Household moved successfully.");
    // Recalculate both families
    await Promise.all([
      recalcTier(moveHouseholdTarget.currentFamilyId),
      recalcTier(targetFamilyId),
    ]);
    setMoveHouseholdTarget(null);
    setMoveDestinationFamilyId("");
    setMoveNewFamilyName("");
    setMoveCreateNew(false);
    fetchFamilies();
  };

  const updateFamilyName = async (familyId: string, newName: string) => {
    const { error } = await supabase.from("families" as any).update({ name: newName } as any).eq("id", familyId);
    if (error) { toast.error("Failed to update family name."); }
    else { toast.success("Family name updated."); fetchFamilies(); }
  };

  const updateHouseholdField = async (householdId: string, field: "label" | "address", value: string) => {
    const { error } = await supabase.from("households" as any).update({ [field]: value } as any).eq("id", householdId);
    if (error) { toast.error(`Failed to update household ${field}.`); }
    else { toast.success(`Household ${field} updated.`); fetchFamilies(); }
  };

  // full_name is a denormalized column other pages read directly (not
  // DB-generated) -- keep it in sync on every first/last name edit, same
  // pattern already used in ProposedUpdateCard.tsx's update_contact case.
  const updateContactName = async (contactId: string, field: "first_name" | "last_name", value: string) => {
    const { data: current } = await supabase.from("contacts").select("first_name, last_name").eq("id", contactId).maybeSingle();
    const fn = field === "first_name" ? value : (current?.first_name || "");
    const ln = field === "last_name" ? value : (current?.last_name || "");
    const full_name = [fn, ln].filter(Boolean).join(" ");
    const { error } = await supabase.from("contacts" as any).update({ [field]: value, full_name } as any).eq("id", contactId);
    if (error) { toast.error("Failed to update contact name."); }
    else { toast.success("Contact name updated."); fetchFamilies(); }
  };

  const filtered = families.filter((f) =>
    f.name.toLowerCase().includes(search.toLowerCase())
  );

  const resolvedSelection: ResolvedSelection | null = (() => {
    if (!selected) return null;
    for (const family of families) {
      if (selected.type === "family" && family.id === selected.id) {
        return { type: "family", family };
      }
      for (const household of family.households) {
        if (selected.type === "household" && household.id === selected.id) {
          return { type: "household", family, household };
        }
        for (const individual of household.individuals) {
          if (selected.type === "contact" && individual.id === selected.id) {
            return { type: "contact", family, household, individual };
          }
        }
      }
    }
    return null;
  })();

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageBreadcrumbs items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Family Tree" },
        ]} />
        <CrmTabs />
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">Family Tree</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Family → Household → Individual Hierarchy — {families.length} families
            </p>
          </div>
          <Button
            onClick={() => setShowNewFamily(true)}
            className="bg-accent text-accent-foreground hover:bg-accent/90"
          >
            <Plus className="mr-2 h-4 w-4" />
            New Family
          </Button>
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search families..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Tree View + Detail Panel */}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading families...</p>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
              <TreesIcon className="h-8 w-8 text-muted-foreground" />
              <p className="text-muted-foreground">
                {search ? "No families match your search." : "No families yet."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <FamilyTreeList
                families={filtered}
                openFamilies={openFamilies}
                openHouseholds={openHouseholds}
                toggleFamily={toggleFamily}
                toggleHousehold={toggleHousehold}
                selected={selected}
                onSelect={(type, id) => setSelected({ type, id })}
                updateFamilyName={updateFamilyName}
                updateHouseholdField={updateHouseholdField}
                updateContactName={updateContactName}
              />
            </div>
            {resolvedSelection && (phone ? (
              <Sheet open onOpenChange={(o) => { if (!o) setSelected(null); }}>
                <BottomSheetContent onClose={() => setSelected(null)} data-testid="family-sheet">
                  <SheetHeader className="sr-only"><SheetTitle>Details</SheetTitle></SheetHeader>
                  <DetailPanel
                    embedded
                selection={resolvedSelection}
                onClose={() => setSelected(null)}
                onSelectHousehold={(id) => setSelected({ type: "household", id })}
                onSelectContact={(id) => setSelected({ type: "contact", id })}
                onRefetch={fetchFamilies}
                updateFamilyName={updateFamilyName}
                deleteFamily={deleteFamily}
                updateHouseholdField={updateHouseholdField}
                updateContactName={updateContactName}
                deleteHousehold={deleteHousehold}
                onAddHousehold={(familyId) => setShowNewHousehold(familyId)}
                onAddIndividual={openAddIndividual}
                onMoveHousehold={(householdId, householdLabel, currentFamilyId) => {
                  setMoveHouseholdTarget({ householdId, householdLabel, currentFamilyId });
                  setMoveDestinationFamilyId("");
                  setMoveNewFamilyName("");
                  setMoveCreateNew(false);
                }}
                onReassign={openReassign}
                onDecoupler={(contactId, contactName, familyId, familyName) =>
                  setDecouplerTarget({ contactId, contactName, familyId, familyName })
                }
                markDeceased={markDeceased}
                unlinkIndividual={unlinkIndividual}
                  />
                </BottomSheetContent>
              </Sheet>
            ) : (
              <DetailPanel
                selection={resolvedSelection}
                onClose={() => setSelected(null)}
                onSelectHousehold={(id) => setSelected({ type: "household", id })}
                onSelectContact={(id) => setSelected({ type: "contact", id })}
                onRefetch={fetchFamilies}
                updateFamilyName={updateFamilyName}
                deleteFamily={deleteFamily}
                updateHouseholdField={updateHouseholdField}
                updateContactName={updateContactName}
                deleteHousehold={deleteHousehold}
                onAddHousehold={(familyId) => setShowNewHousehold(familyId)}
                onAddIndividual={openAddIndividual}
                onMoveHousehold={(householdId, householdLabel, currentFamilyId) => {
                  setMoveHouseholdTarget({ householdId, householdLabel, currentFamilyId });
                  setMoveDestinationFamilyId("");
                  setMoveNewFamilyName("");
                  setMoveCreateNew(false);
                }}
                onReassign={openReassign}
                onDecoupler={(contactId, contactName, familyId, familyName) =>
                  setDecouplerTarget({ contactId, contactName, familyId, familyName })
                }
                markDeceased={markDeceased}
                unlinkIndividual={unlinkIndividual}
              />
            ))}
          </div>
        )}

        {/* Contacts with no family at all */}
        {!loading && unassignedContacts.length > 0 && (
          <Card>
            <CardContent className="p-0">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <p className="font-serif text-base font-semibold">Unassigned Contacts</p>
                <p className="text-xs text-muted-foreground">
                  {unassignedContacts.length} not linked to a family
                </p>
              </div>
              <div>
                {unassignedContacts.map((c) => (
                  <ListRow key={c.id} to={`/contacts/${c.id}`}>
                    <span className="font-medium">
                      {c.first_name} {c.last_name}
                    </span>
                    {c.email && <span className="text-xs text-muted-foreground ml-auto">{c.email}</span>}
                  </ListRow>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* New Family Dialog */}
      <Dialog open={showNewFamily} onOpenChange={setShowNewFamily}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Family</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Family name (e.g. The Richardson Family)"
            value={newFamilyName}
            onChange={(e) => setNewFamilyName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createFamily()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewFamily(false)}>
              Cancel
            </Button>
            <Button onClick={createFamily} className="bg-accent text-accent-foreground hover:bg-accent/90">
              Create Family
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Household Dialog */}
      <Dialog open={!!showNewHousehold} onOpenChange={() => setShowNewHousehold(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Household</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Household label (e.g. Secondary, Lake House)"
            value={newHouseholdLabel}
            onChange={(e) => setNewHouseholdLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && showNewHousehold && createHousehold(showNewHousehold)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewHousehold(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => showNewHousehold && createHousehold(showNewHousehold)}
              className="bg-accent text-accent-foreground hover:bg-accent/90"
            >
              Add Household
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Individual Dialog */}
      <Dialog open={!!addIndividualTarget} onOpenChange={() => setAddIndividualTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Individual to Household</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search existing contacts..."
                value={individualSearch}
                onChange={(e) => setIndividualSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Role</label>
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="head_of_family">Head of Family</option>
                <option value="head_of_household">Head of Household</option>
                <option value="spouse">Spouse</option>
                <option value="beneficiary">Beneficiary</option>
                <option value="minor">Minor</option>
              </select>
            </div>
            <div className="max-h-[240px] overflow-y-auto rounded-md border">
              {unlinkedContacts
                .filter((c) => {
                  const name = `${c.first_name} ${c.last_name || ""}`.toLowerCase();
                  return name.includes(individualSearch.toLowerCase());
                })
                .map((c) => (
                  <button
                    key={c.id}
                    onClick={() => linkIndividual(c.id)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/50 border-b last:border-b-0"
                  >
                    <User className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{c.first_name} {c.last_name}</p>
                      {c.email && (
                        <p className="text-xs text-muted-foreground truncate">{c.email}</p>
                      )}
                    </div>
                  </button>
                ))}
              {individualSearch.trim().length >= 2 && (
                <button
                  onClick={() => createAndLinkIndividual(individualSearch)}
                  className="flex w-full items-center gap-2 border-t px-3 py-2.5 text-sm text-primary transition-colors hover:bg-muted/50"
                >
                  <Plus className="h-4 w-4" />
                  Create "{individualSearch.trim()}"
                </button>
              )}
              {unlinkedContacts.filter((c) =>
                `${c.first_name} ${c.last_name || ""}`.toLowerCase().includes(individualSearch.toLowerCase())
              ).length === 0 && !individualSearch.trim() && (
                <p className="p-3 text-center text-xs text-muted-foreground">
                  No unlinked contacts found. Type a name to create one.
                </p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reassign Individual Dialog */}
      <Dialog open={!!reassignTarget} onOpenChange={() => setReassignTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reassign {reassignTarget?.contactName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Family</label>
              <Select value={reassignFamilyId} onValueChange={handleReassignFamilyChange}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select family" />
                </SelectTrigger>
                <SelectContent>
                  {families.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Household</label>
              <Select value={reassignHouseholdId} onValueChange={setReassignHouseholdId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select household" />
                </SelectTrigger>
                <SelectContent>
                  {availableHouseholds.map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      {h.label} Household
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {reassignFamilyId && availableHouseholds.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">No households in this family.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReassignTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={reassignIndividual}
              disabled={!reassignHouseholdId || (reassignHouseholdId === reassignTarget?.currentHouseholdId && reassignFamilyId === reassignTarget?.currentFamilyId)}
              className="bg-accent text-accent-foreground hover:bg-accent/90"
            >
              Reassign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move Household Dialog */}
      <Dialog open={!!moveHouseholdTarget} onOpenChange={() => setMoveHouseholdTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Move "{moveHouseholdTarget?.householdLabel}" Household</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="move-create-new"
                checked={moveCreateNew}
                onChange={(e) => {
                  setMoveCreateNew(e.target.checked);
                  if (e.target.checked) setMoveDestinationFamilyId("");
                }}
                className="rounded border-border"
              />
              <label htmlFor="move-create-new" className="text-sm">Create a new family</label>
            </div>

            {moveCreateNew ? (
              <div>
                <label className="text-xs font-medium text-muted-foreground">New Family Name</label>
                <Input
                  placeholder="e.g. The Richardson Family"
                  value={moveNewFamilyName}
                  onChange={(e) => setMoveNewFamilyName(e.target.value)}
                  className="mt-1"
                />
              </div>
            ) : (
              <div>
                <label className="text-xs font-medium text-muted-foreground">Destination Family</label>
                <Select value={moveDestinationFamilyId} onValueChange={setMoveDestinationFamilyId}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select family" />
                  </SelectTrigger>
                  <SelectContent>
                    {families
                      .filter((f) => f.id !== moveHouseholdTarget?.currentFamilyId)
                      .map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveHouseholdTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={moveHouseholdToFamily}
              disabled={moveCreateNew ? !moveNewFamilyName.trim() : !moveDestinationFamilyId}
              className="bg-accent text-accent-foreground hover:bg-accent/90"
            >
              <MoveRight className="mr-2 h-4 w-4" />
              Move Household
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Decoupler Protocol Wizard */}
      {user && (
        <DecouplerWizard
          target={decouplerTarget}
          families={families.map((f) => ({ id: f.id, name: f.name }))}
          userId={user.id}
          onClose={() => setDecouplerTarget(null)}
          onComplete={() => {
            setDecouplerTarget(null);
            fetchFamilies();
          }}
        />
      )}
    </AppLayout>
  );
};

export default Families;
