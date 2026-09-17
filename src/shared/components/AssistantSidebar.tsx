import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/shared/components/ui/button";
import { Bot, X } from "lucide-react";
import { SovereigntyAssistant } from "./SovereigntyAssistant";
import { useCurrentEntityFromRoute } from "@/shared/hooks/useCurrentEntityFromRoute";
import { supabase } from "@/shared/integrations/supabase/client";

const ENTITY_TABLE: Record<string, { table: string; nameColumn: string }> = {
  contact: { table: "contacts", nameColumn: "full_name" },
  household: { table: "households", nameColumn: "label" },
  family: { table: "families", nameColumn: "name" },
};

export function AssistantSidebar() {
  const [isOpen, setIsOpen] = useState(false);
  const entity = useCurrentEntityFromRoute();

  const nameQuery = useQuery({
    queryKey: ["assistant-current-entity-name", entity?.type, entity?.id],
    queryFn: async () => {
      if (!entity) return null;
      const { table, nameColumn } = ENTITY_TABLE[entity.type];
      // Contact lookups also grab household_id here -- reused as the target
      // for household-scoped AI proposals (fiduciary_entity/governance_status)
      // in ProposedUpdateCard, instead of a second round-trip per approval.
      const columns = entity.type === "contact" ? `${nameColumn}, household_id` : nameColumn;
      const { data } = await supabase.from(table as any).select(columns).eq("id", entity.id).maybeSingle();
      return {
        name: (data as any)?.[nameColumn] ?? null,
        householdId: entity.type === "contact" ? ((data as any)?.household_id ?? null) : null,
      };
    },
    enabled: isOpen && !!entity,
    staleTime: 60_000,
  });

  const contactContext = entity
    ? { type: entity.type, id: entity.id, name: nameQuery.data?.name ?? undefined, householdId: nameQuery.data?.householdId ?? undefined }
    : undefined;

  return (
    <>
      {/* Toggle button */}
      {!isOpen && (
        <Button
          onClick={() => setIsOpen(true)}
          size="icon"
          className="fixed bottom-6 right-6 z-50 h-12 w-12 rounded-full shadow-lg bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Bot className="h-5 w-5" />
        </Button>
      )}

      {/* Sidebar panel */}
      {isOpen && (
        <div className="fixed inset-y-0 right-0 z-50 w-[400px] border-l bg-background shadow-2xl flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <span className="text-sm font-semibold">Sovereignty Assistant</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-hidden">
            <SovereigntyAssistant
              variant="embedded"
              contactContext={contactContext}
              contactId={entity?.type === "contact" ? entity.id : undefined}
            />
          </div>
        </div>
      )}
    </>
  );
}
