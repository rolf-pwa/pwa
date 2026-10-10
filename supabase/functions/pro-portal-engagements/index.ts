import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateProSession } from "../_shared/pro-portal-auth.ts";

const ALLOWED_ORIGINS = [
  "https://prosperwise-portal.web.app",
  "https://prosperwise.lovable.app",
  "https://app.prosperwise.ca",
  "https://id-preview--339dfc8f-3e82-4b05-8a36-a9f66fc58449.lovable.app",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-pro-session, x-region",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Resolve a short label for a given engagement scope so the pro sees
// something meaningful without exposing raw IDs.
async function resolveScopeLabel(
  supabase: any,
  scope_type: string,
  scope_id: string,
): Promise<string> {
  try {
    if (scope_type === "family") {
      const { data } = await supabase.from("families").select("name").eq("id", scope_id).maybeSingle();
      return data?.name || "Family";
    }
    if (scope_type === "household") {
      const { data } = await supabase.from("households").select("label").eq("id", scope_id).maybeSingle();
      return data?.label || "Household";
    }
    if (scope_type === "contact") {
      const { data } = await supabase
        .from("contacts").select("full_name, first_name, last_name").eq("id", scope_id).maybeSingle();
      return data?.full_name || [data?.first_name, data?.last_name].filter(Boolean).join(" ") || "Client";
    }
  } catch {/* swallow */}
  return scope_type;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const sessionToken = req.headers.get("x-pro-session");
    const session = await validateProSession(supabase, sessionToken);
    if (!session) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const action = (body.action as string) || "list";

    if (action === "list") {
      const { data: engagements } = await supabase
        .from("professional_engagements")
        .select("id, title, pillar, scope_type, scope_id, status, started_at, completed_at, created_at, vault_share_link_id")
        .eq("professional_id", session.professional_id)
        .in("status", ["invited", "active", "completed"])
        .order("created_at", { ascending: false });

      // Resolve family_id for each engagement scope
      const resolveFamilyId = async (scope_type: string, scope_id: string): Promise<string | null> => {
        try {
          if (scope_type === "family") return scope_id;
          if (scope_type === "household") {
            const { data } = await supabase.from("households").select("family_id").eq("id", scope_id).maybeSingle();
            return data?.family_id || null;
          }
          if (scope_type === "contact") {
            const { data } = await supabase.from("contacts").select("family_id, household_id").eq("id", scope_id).maybeSingle();
            if (data?.family_id) return data.family_id;
            if (data?.household_id) {
              const { data: hh } = await supabase.from("households").select("family_id").eq("id", data.household_id).maybeSingle();
              return hh?.family_id || null;
            }
          }
        } catch {/* noop */}
        return null;
      };

      // Hydrate scope labels + unread + family_id
      const list = await Promise.all(
        (engagements || []).map(async (e: any) => {
          const scope_label = await resolveScopeLabel(supabase, e.scope_type, e.scope_id);
          const family_id = await resolveFamilyId(e.scope_type, e.scope_id);
          const { count: unread } = await supabase
            .from("engagement_messages")
            .select("id", { count: "exact", head: true })
            .eq("engagement_id", e.id)
            .neq("sender_type", "pro")
            .is("read_by_pro_at", null);
          const { data: latestMsg } = await supabase
            .from("engagement_messages")
            .select("created_at, sender_type, body")
            .eq("engagement_id", e.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          return {
            ...e,
            scope_label,
            family_id,
            unread_count: unread || 0,
            last_message_at: latestMsg?.created_at || null,
            last_message_preview: latestMsg?.body ? String(latestMsg.body).slice(0, 90) : null,
            last_message_sender: latestMsg?.sender_type || null,
          };
        }),
      );

      // Collect all unique family IDs
      const familyIds = Array.from(new Set(list.map((e: any) => e.family_id).filter(Boolean)));

      // Fetch family names
      const { data: familyRows } = familyIds.length
        ? await supabase.from("families").select("id, name").in("id", familyIds)
        : { data: [] as any[] };
      const familyMap = new Map((familyRows || []).map((f: any) => [f.id, f.name]));

      // Fetch collaborators (other pros on same families) via engagements on those families
      const collaboratorsByFamily: Record<string, any[]> = {};
      if (familyIds.length) {
        // Get every engagement scoped to these families (family/household/contact)
        // Gather household + contact IDs per family for scope matching
        const [{ data: households }, { data: contactsInFams }] = await Promise.all([
          supabase.from("households").select("id, family_id").in("family_id", familyIds),
          supabase.from("contacts").select("id, family_id, household_id").in("family_id", familyIds),
        ]);
        const hhToFam = new Map((households || []).map((h: any) => [h.id, h.family_id]));
        const contactToFam = new Map<string, string>();
        (contactsInFams || []).forEach((c: any) => {
          if (c.family_id) contactToFam.set(c.id, c.family_id);
          else if (c.household_id && hhToFam.get(c.household_id)) contactToFam.set(c.id, hhToFam.get(c.household_id)!);
        });
        // Also pull contacts by household for households whose contacts don't have family_id set
        const hhIds = (households || []).map((h: any) => h.id);
        if (hhIds.length) {
          const { data: moreContacts } = await supabase.from("contacts").select("id, household_id").in("household_id", hhIds);
          (moreContacts || []).forEach((c: any) => {
            if (!contactToFam.has(c.id) && c.household_id && hhToFam.get(c.household_id)) {
              contactToFam.set(c.id, hhToFam.get(c.household_id)!);
            }
          });
        }

        const { data: allEng } = await supabase
          .from("professional_engagements")
          .select("professional_id, scope_type, scope_id, pillar, status")
          .neq("professional_id", session.professional_id)
          .in("status", ["invited", "active", "completed"]);

        const proIds = new Set<string>();
        const proToFams: Record<string, Set<string>> = {};
        (allEng || []).forEach((eng: any) => {
          let famId: string | null = null;
          if (eng.scope_type === "family" && familyIds.includes(eng.scope_id)) famId = eng.scope_id;
          else if (eng.scope_type === "household") famId = hhToFam.get(eng.scope_id) || null;
          else if (eng.scope_type === "contact") famId = contactToFam.get(eng.scope_id) || null;
          if (famId && familyIds.includes(famId)) {
            proIds.add(eng.professional_id);
            if (!proToFams[eng.professional_id]) proToFams[eng.professional_id] = new Set();
            proToFams[eng.professional_id].add(famId);
          }
        });

        if (proIds.size) {
          const { data: pros } = await supabase
            .from("professionals")
            .select("id, full_name, firm, professional_type")
            .in("id", Array.from(proIds));
          (pros || []).forEach((p: any) => {
            (proToFams[p.id] || new Set()).forEach((famId) => {
              if (!collaboratorsByFamily[famId]) collaboratorsByFamily[famId] = [];
              collaboratorsByFamily[famId].push(p);
            });
          });
        }
      }

      const families = familyIds.map((fid) => ({
        id: fid,
        name: familyMap.get(fid) || "Family",
        engagements: list.filter((e: any) => e.family_id === fid),
        collaborators: collaboratorsByFamily[fid] || [],
      }));
      const unaffiliated = list.filter((e: any) => !e.family_id);

      return new Response(JSON.stringify({ engagements: list, families, unaffiliated }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "get") {
      const engagementId = body.engagement_id as string;
      if (!engagementId) {
        return new Response(JSON.stringify({ error: "engagement_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: engagement } = await supabase
        .from("professional_engagements")
        .select("*")
        .eq("id", engagementId)
        .eq("professional_id", session.professional_id)
        .maybeSingle();
      if (!engagement) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const scope_label = await resolveScopeLabel(supabase, engagement.scope_type, engagement.scope_id);
      const { data: messages } = await supabase
        .from("engagement_messages")
        .select("id, sender_type, sender_id, body, attachments, created_at, read_by_pro_at, read_by_staff_at")
        .eq("engagement_id", engagementId)
        .order("created_at", { ascending: true });

      // Mark inbound messages as read by pro
      const now = new Date().toISOString();
      const unreadIds = (messages || [])
        .filter((m: any) => m.sender_type !== "pro" && !m.read_by_pro_at)
        .map((m: any) => m.id);
      if (unreadIds.length > 0) {
        await supabase
          .from("engagement_messages")
          .update({ read_by_pro_at: now })
          .in("id", unreadIds);
      }

      return new Response(
        JSON.stringify({ engagement: { ...engagement, scope_label }, messages: messages || [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // downloadSharedFile removed — superseded by vault-service's own
    // streamFile action (firewall + audit log), now reachable directly from
    // the Pro Portal via the "professional" actor kind (x-pro-session).
    // See SharedFolderCard.tsx for the new call site.

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[pro-portal-engagements] error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
