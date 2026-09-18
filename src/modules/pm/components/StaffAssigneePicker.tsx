import { useEffect, useState } from "react";
import { supabase } from "@/shared/integrations/supabase/client";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { AI_TEAMMATE_LABEL, AI_TEAMMATE_ORDER } from "@/shared/lib/aiTeammates";

interface StaffProfile {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

interface HouseholdAssignee extends StaffProfile {
  roleLabel: string;
}

interface Props {
  /** A real assignee user id, or `agent:{key}` for an AI Teammate — caller decodes. */
  value: string | null;
  onChange: (value: string | null) => void;
  /** Scope for offering the household/family head(s) as an assignee, alongside staff. */
  householdId?: string | null;
  familyId?: string | null;
}

const ROLE_LABEL: Record<string, string> = {
  head_of_household: "Head of Household",
  head_of_family: "Head of Family",
};

export function StaffAssigneePicker({ value, onChange, householdId, familyId }: Props) {
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [householdAssignees, setHouseholdAssignees] = useState<HouseholdAssignee[]>([]);

  useEffect(() => {
    // Staff only — profiles is shared with client Google-sign-in accounts,
    // so it can't be trusted unfiltered here.
    supabase
      .from("profiles")
      .select("user_id, full_name, email")
      .ilike("email", "%@prosperwise.ca")
      .order("full_name")
      .then(({ data }) => setStaff(data || []));
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!householdId && !familyId) {
      setHouseholdAssignees([]);
      return;
    }
    (async () => {
      // A household can have more than one head (e.g. spouses both marked
      // head_of_family) — resolve all of them, not just the first.
      let heads: { email: string | null; family_role: string | null }[] = [];
      if (householdId) {
        const { data } = await supabase
          .from("contacts")
          .select("email, family_role")
          .eq("household_id", householdId)
          .in("family_role", ["head_of_household", "head_of_family"]);
        heads = data || [];
      } else if (familyId) {
        const { data } = await supabase
          .from("contacts")
          .select("email, family_role")
          .eq("family_id", familyId)
          .eq("family_role", "head_of_family");
        heads = data || [];
      }
      const emails = heads.filter((h) => h.email).map((h) => h.email as string);
      if (cancelled || emails.length === 0) {
        if (!cancelled) setHouseholdAssignees([]);
        return;
      }
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in(
          "email",
          emails.map((e) => e.toLowerCase()),
        );
      if (cancelled) return;
      const roleByEmail = new Map(heads.map((h) => [h.email?.toLowerCase(), h.family_role]));
      const resolved = (profiles || []).map((p) => ({
        ...p,
        roleLabel: ROLE_LABEL[roleByEmail.get(p.email?.toLowerCase() || "") || ""] || "Household Head",
      }));
      setHouseholdAssignees(resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, [householdId, familyId]);

  return (
    <Select value={value ?? "unassigned"} onValueChange={(v) => onChange(v === "unassigned" ? null : v)}>
      <SelectTrigger className="h-8 w-[160px]">
        <SelectValue placeholder="Unassigned" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="unassigned">Unassigned</SelectItem>
        {staff.map((s) => (
          <SelectItem key={s.user_id} value={s.user_id}>
            {s.full_name || s.email || s.user_id.slice(0, 8)}
          </SelectItem>
        ))}
        {householdAssignees.length > 0 && (
          <>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Household</SelectLabel>
              {householdAssignees.map((a) => (
                <SelectItem key={a.user_id} value={a.user_id}>
                  {a.full_name || a.email} — {a.roleLabel}
                </SelectItem>
              ))}
            </SelectGroup>
          </>
        )}
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>AI Teammates</SelectLabel>
          {AI_TEAMMATE_ORDER.map((key) => (
            <SelectItem key={key} value={`agent:${key}`}>
              🤖 {AI_TEAMMATE_LABEL[key]}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
