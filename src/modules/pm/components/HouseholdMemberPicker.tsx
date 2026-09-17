import { useEffect, useState } from "react";
import { supabase } from "@/shared/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";

interface Member {
  id: string;
  first_name: string;
  last_name: string | null;
}

interface Props {
  householdId?: string | null;
  familyId?: string | null;
  excludeIds: string[];
  onSelect: (contactId: string) => void;
}

/** Tags a household (or, absent that, family) member onto a task — the native replacement for Asana's tag-a-household-member capability. */
export function HouseholdMemberPicker({ householdId, familyId, excludeIds, onSelect }: Props) {
  const [members, setMembers] = useState<Member[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!householdId && !familyId) {
      setMembers([]);
      return;
    }
    const query = householdId
      ? supabase.from("contacts").select("id, first_name, last_name").eq("household_id", householdId)
      : supabase.from("contacts").select("id, first_name, last_name").eq("family_id", familyId as string);
    query.order("first_name").then(({ data }) => {
      if (!cancelled) setMembers(data || []);
    });
    return () => {
      cancelled = true;
    };
  }, [householdId, familyId]);

  const options = members.filter((m) => !excludeIds.includes(m.id));
  if (!householdId && !familyId) return null;

  return (
    <Select value="" onValueChange={onSelect}>
      <SelectTrigger className="h-8 w-[220px]">
        <SelectValue placeholder="Tag a household member…" />
      </SelectTrigger>
      <SelectContent>
        {options.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">No other members to tag</div>
        ) : (
          options.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.first_name} {m.last_name || ""}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}
