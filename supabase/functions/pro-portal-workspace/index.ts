// Pro Portal workspace endpoint: scoped tree + family/household/contact detail.
// All access is scoped by professional_engagements for the authenticated pro.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateProSession } from "../_shared/pro-portal-auth.ts";

const ALLOWED_ORIGINS = [
  "https://prosperwise-portal.web.app",
  "https://prosperwise.lovable.app",
  "https://app.prosperwise.ca",
  "https://id-preview--339dfc8f-3e82-4b05-8a36-a9f66fc58449.lovable.app",
];
function cors(req: Request) {
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

// Resolve every family/household/contact the pro is engaged with.
// Visibility rules (strict — do NOT expand downward beyond the granted scope):
//   • family    → that family record only, nothing beneath it. Households and
//                 contacts are never auto-included — each needs its own
//                 household- or contact-scoped engagement to become visible,
//                 the same explicit-opt-in principle as visibility_scope on
//                 financial data (nothing is shared just by being "in the
//                 family").
//   • household → that household + only its members (family shown as container)
//   • contact   → that contact only (household + family shown as containers)
async function resolveScope(supabase: any, professional_id: string) {
  const { data: engagements } = await supabase
    .from("professional_engagements")
    .select("id, scope_type, scope_id, pillar, title, status, started_at, created_at")
    .eq("professional_id", professional_id)
    .in("status", ["invited", "active", "completed"]);

  // Full-access sets — everything the pro can actually open / act on.
  const familyIds = new Set<string>();      // full family access
  const householdIds = new Set<string>();   // full household access (all members)
  const contactIds = new Set<string>();     // individually granted contacts

  // Container-only sets — shown as parent nodes in the tree for hierarchy,
  // but the pro cannot open the family/household detail page itself.
  const containerFamilyIds = new Set<string>();
  const containerHouseholdIds = new Set<string>();

  for (const e of engagements || []) {
    if (e.scope_type === "family") familyIds.add(e.scope_id);
    else if (e.scope_type === "household") householdIds.add(e.scope_id);
    else if (e.scope_type === "contact") contactIds.add(e.scope_id);
  }

  // household scope → its members become visible; parent family is a container only
  if (householdIds.size) {
    const { data: hhs } = await supabase
      .from("households").select("id, family_id").in("id", Array.from(householdIds));
    (hhs || []).forEach((h: any) => { if (h.family_id) containerFamilyIds.add(h.family_id); });
    const { data: members } = await supabase
      .from("contacts").select("id").in("household_id", Array.from(householdIds));
    (members || []).forEach((m: any) => contactIds.add(m.id));
  }

  // contact scope → containers for tree only, no sibling exposure
  if (contactIds.size) {
    const { data: cs } = await supabase
      .from("contacts").select("id, family_id, household_id").in("id", Array.from(contactIds));
    (cs || []).forEach((c: any) => {
      if (c.household_id) containerHouseholdIds.add(c.household_id);
      if (c.family_id) containerFamilyIds.add(c.family_id);
    });
  }

  const treeFamilyIds = new Set<string>([...familyIds, ...containerFamilyIds]);
  const treeHouseholdIds = new Set<string>([...householdIds, ...containerHouseholdIds]);

  return {
    engagements: engagements || [],
    familyIds: Array.from(familyIds),
    householdIds: Array.from(householdIds),
    contactIds: Array.from(contactIds),
    treeFamilyIds: Array.from(treeFamilyIds),
    treeHouseholdIds: Array.from(treeHouseholdIds),
  };
}

async function buildTree(supabase: any, scope: Awaited<ReturnType<typeof resolveScope>>) {
  const { treeFamilyIds, treeHouseholdIds, contactIds } = scope;
  if (!treeFamilyIds.length && !treeHouseholdIds.length && !contactIds.length) {
    return { families: [] };
  }
  const [{ data: families }, { data: households }, { data: contacts }] = await Promise.all([
    treeFamilyIds.length
      ? supabase.from("families").select("id, name, fee_tier").in("id", treeFamilyIds)
      : Promise.resolve({ data: [] as any[] }),
    treeHouseholdIds.length
      ? supabase.from("households").select("id, label, family_id, governance_status").in("id", treeHouseholdIds)
      : Promise.resolve({ data: [] as any[] }),
    contactIds.length
      ? supabase
          .from("contacts")
          .select("id, first_name, last_name, full_name, family_role, family_id, household_id, email, phone, is_minor")
          .in("id", contactIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const familyMap = new Map((families || []).map((f: any) => [f.id, { ...f, households: [] as any[], loose_contacts: [] as any[] }]));

  // Attach households to families
  const hhMap = new Map<string, any>();
  (households || []).forEach((h: any) => {
    const fam = familyMap.get(h.family_id);
    if (!fam) return;
    const enriched = { ...h, contacts: [] as any[] };
    fam.households.push(enriched);
    hhMap.set(h.id, enriched);
  });

  // Attach contacts to households, or hang loose in the family
  (contacts || []).forEach((c: any) => {
    const displayName = c.full_name || [c.first_name, c.last_name].filter(Boolean).join(" ") || "Contact";
    const node = {
      id: c.id,
      name: displayName,
      family_role: c.family_role,
      email: c.email,
      phone: c.phone,
      is_minor: c.is_minor,
    };
    if (c.household_id && hhMap.get(c.household_id)) {
      hhMap.get(c.household_id).contacts.push(node);
    } else if (c.family_id && familyMap.get(c.family_id)) {
      familyMap.get(c.family_id).loose_contacts.push(node);
    }
  });

  return { families: Array.from(familyMap.values()) };
}

// Resolve this pro's Vault grants for one specific household -- takes the
// household id directly rather than re-deriving it, since every call site
// already has it in scope. Only surfaces grants for this pro's own linked
// vault_collaborators row for THAT household (a pro can hold one such row
// per household they're engaged with; without this filter, grants from a
// different household they're also linked to would leak in here).
async function resolveVault(supabase: any, professionalId: string, householdId: string | null) {
  if (!householdId) return [];
  const { data: collab } = await supabase
    .from("vault_collaborators")
    .select("id")
    .eq("professional_id", professionalId)
    .eq("household_id", householdId)
    .is("revoked_at", null)
    .maybeSingle();
  if (!collab) return [];
  const { data: grants } = await supabase
    .from("vault_collaborator_grants")
    .select("id, scope_type, drive_id, permission, created_at, expires_at, revoked_at")
    .eq("collaborator_id", collab.id)
    .is("revoked_at", null);
  // Filter out expired
  const now = Date.now();
  return (grants || []).filter((g: any) => !g.expires_at || new Date(g.expires_at).getTime() > now);
}

async function loadCharter(supabase: any, contactIdOrHouseholdId: string, scopeType: "contact" | "household") {
  // Charter lives on sovereignty_charters keyed by contact_id.
  // For household scope, pick the household's Head of Household charter.
  let contactId = contactIdOrHouseholdId;
  if (scopeType === "household") {
    const { data: hoh } = await supabase
      .from("contacts")
      .select("id, family_role")
      .eq("household_id", contactIdOrHouseholdId)
      .in("family_role", ["head_of_household", "head_of_family"])
      .limit(1)
      .maybeSingle();
    if (!hoh) return null;
    contactId = hoh.id;
  }
  const { data: charter } = await supabase
    .from("sovereignty_charters")
    .select("id, contact_id, title, updated_at")
    .eq("contact_id", contactId)
    .maybeSingle();

  const { data: reviews } = await supabase
    .from("monthly_governance_reviews")
    .select("id, period_end, status, verified_at, approved_at, briefing_principal_markdown")
    .eq("scope_type", scopeType)
    .eq("scope_id", contactIdOrHouseholdId)
    .order("period_end", { ascending: false })
    .limit(1);

  return {
    charter: charter || null,
    latest_review: reviews?.[0] || null,
  };
}

serve(async (req) => {
  const corsHeaders = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const session = await validateProSession(supabase, req.headers.get("x-pro-session"));
    if (!session) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = await req.json().catch(() => ({}));
    const action = body.action as string;
    const scope = await resolveScope(supabase, session.professional_id);
    console.log("[pro-portal-workspace]", action, "pro=", session.professional_id, "engagements=", scope.engagements.length, "fam=", scope.familyIds.length, "hh=", scope.householdIds.length, "c=", scope.contactIds.length);

    if (action === "tree") {
      const tree = await buildTree(supabase, scope);
      console.log("[pro-portal-workspace] tree families=", tree.families.length);
      return new Response(JSON.stringify(tree), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Where should login land this pro? ───
    // Prefer the assigned household directly when everything they can see
    // funnels into exactly one -- family is a container concept only useful
    // once a pro genuinely has broader (family-scope or multi-household)
    // access. familyIds here means a *direct* family-scope engagement, not
    // just the container family a household/contact engagement belongs to.
    if (action === "defaultLanding") {
      if (scope.familyIds.length === 0 && scope.treeHouseholdIds.length === 1) {
        return new Response(JSON.stringify({ type: "household", id: scope.treeHouseholdIds[0] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ type: "portfolio" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "family") {
      const familyId = body.family_id as string;
      // Accessible as a family page if any engagement touches this family
      // (family/household/contact scope). Detail page respects strict visibility.
      if (!familyId || !scope.treeFamilyIds.includes(familyId)) {
        return new Response(JSON.stringify({ error: "Not accessible" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Filter scope down to this family
      const filtered = {
        engagements: scope.engagements,
        familyIds: scope.familyIds.includes(familyId) ? [familyId] : [],
        householdIds: scope.householdIds,
        contactIds: scope.contactIds,
        treeFamilyIds: [familyId],
        treeHouseholdIds: scope.treeHouseholdIds,
      };
      const tree = await buildTree(supabase, filtered);
      const family = tree.families[0] || null;

      // Collaborators: other pros on this family
      const familyHhIds = family ? family.households.map((h: any) => h.id) : [];
      const familyContactIds = family
        ? [
            ...family.loose_contacts.map((c: any) => c.id),
            ...family.households.flatMap((h: any) => h.contacts.map((c: any) => c.id)),
          ]
        : [];
      const { data: otherEng } = await supabase
        .from("professional_engagements")
        .select("professional_id, scope_type, scope_id, pillar")
        .neq("professional_id", session.professional_id)
        .in("status", ["invited", "active", "completed"]);
      const collaboratorIds = new Set<string>();
      (otherEng || []).forEach((e: any) => {
        if (e.scope_type === "family" && e.scope_id === familyId) collaboratorIds.add(e.professional_id);
        else if (e.scope_type === "household" && familyHhIds.includes(e.scope_id)) collaboratorIds.add(e.professional_id);
        else if (e.scope_type === "contact" && familyContactIds.includes(e.scope_id)) collaboratorIds.add(e.professional_id);
      });
      const { data: collaborators } = collaboratorIds.size
        ? await supabase
            .from("professionals")
            .select("id, full_name, firm, professional_type")
            .in("id", Array.from(collaboratorIds))
        : { data: [] as any[] };

      return new Response(JSON.stringify({ family, collaborators: collaborators || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "household") {
      const householdId = body.household_id as string;
      if (!householdId || !scope.householdIds.includes(householdId)) {
        return new Response(JSON.stringify({ error: "Not accessible" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: hh } = await supabase
        .from("households")
        .select("id, label, family_id, governance_status")
        .eq("id", householdId)
        .maybeSingle();
      if (!hh) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: family } = await supabase.from("families").select("id, name").eq("id", hh.family_id).maybeSingle();
      const { data: members } = await supabase
        .from("contacts")
        .select("id, first_name, last_name, full_name, email, phone, family_role, is_minor")
        .eq("household_id", householdId)
        .in("id", scope.contactIds);
      const vault = await resolveVault(supabase, session.professional_id, householdId);
      const governance = await loadCharter(supabase, householdId, "household");
      return new Response(
        JSON.stringify({ household: hh, family, members: members || [], vault, governance }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "contact") {
      const contactId = body.contact_id as string;
      if (!contactId || !scope.contactIds.includes(contactId)) {
        return new Response(JSON.stringify({ error: "Not accessible" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: contact } = await supabase
        .from("contacts")
        .select("id, first_name, last_name, full_name, email, phone, family_role, is_minor, family_id, household_id")
        .eq("id", contactId)
        .maybeSingle();
      if (!contact) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const [{ data: family }, { data: household }] = await Promise.all([
        contact.family_id
          ? supabase.from("families").select("id, name").eq("id", contact.family_id).maybeSingle()
          : Promise.resolve({ data: null }),
        contact.household_id
          ? supabase.from("households").select("id, label").eq("id", contact.household_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      const vault = await resolveVault(supabase, session.professional_id, contact.household_id ?? null);
      const governance = await loadCharter(supabase, contactId, "contact");
      return new Response(
        JSON.stringify({ contact, family, household, vault, governance }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[pro-portal-workspace] error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
