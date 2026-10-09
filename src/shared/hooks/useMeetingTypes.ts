import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/shared/integrations/supabase/client";
import type { MeetingType } from "@/shared/lib/meetingTypes";

/** Every meeting type (staff side). Use forStaff() for the ones to show; the manage dialog needs all of them. */
export function useMeetingTypes() {
  return useQuery({
    queryKey: ["meeting-types"],
    queryFn: async () => {
      const { data, error } = await supabase.from("meeting_types").select("*").order("sort_order");
      if (error) throw error;
      return (data ?? []) as MeetingType[];
    },
    staleTime: 60_000,
  });
}
