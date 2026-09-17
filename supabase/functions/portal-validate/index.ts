import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

async function getValidGoogleToken(supabase: any, userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("google_tokens")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;

  if (new Date(data.token_expiry) <= new Date()) {
    try {
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          refresh_token: data.refresh_token,
          grant_type: "refresh_token",
        }),
      });
      const tokens = await res.json();
      if (tokens.error) return null;

      const newExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
      await supabase
        .from("google_tokens")
        .update({ access_token: tokens.access_token, token_expiry: newExpiry })
        .eq("user_id", userId);

      return tokens.access_token;
    } catch {
      return null;
    }
  }

  return data.access_token;
}

async function fetchCalendarEvents(accessToken: string, contactEmail: string): Promise<any[]> {
  try {
    // 90 days back covers past meetings (e.g. the last few quarterly
    // reviews) alongside the next 30 days of upcoming ones. The client
    // splits this single chronological list into Upcoming/Past sections.
    const timeMin = new Date(Date.now() - 90 * 86400000).toISOString();
    const timeMax = new Date(Date.now() + 30 * 86400000).toISOString();

    const calRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
      new URLSearchParams({
        timeMin,
        timeMax,
        maxResults: "40",
        singleEvents: "true",
        orderBy: "startTime",
        q: contactEmail,
      }),
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!calRes.ok) return [];

    const data = await calRes.json();
    return (data.items || []).filter((event: any) =>
      event.attendees?.some((a: any) =>
        a.email?.toLowerCase() === contactEmail.toLowerCase()
      ) ||
      event.organizer?.email?.toLowerCase() === contactEmail.toLowerCase() ||
      event.creator?.email?.toLowerCase() === contactEmail.toLowerCase()
    );
  } catch {
    return [];
  }
}

// Fetch vineyard + storehouse data for a list of contact IDs
async function fetchAssetsForContacts(supabase: any, contactIds: string[]) {
  if (contactIds.length === 0) return { vineyard: [], storehouses: [] };
  const [vRes, sRes] = await Promise.all([
    supabase.from("vineyard_accounts").select("*").in("contact_id", contactIds).order("created_at"),
    supabase.from("storehouses").select("*").in("contact_id", contactIds).order("storehouse_number"),
  ]);
  return { vineyard: vRes.data || [], storehouses: sRes.data || [] };
}

// Build hierarchy data based on family_role
async function buildHierarchy(supabase: any, contact: any) {
  const role = contact.family_role;
  const familyId = contact.family_id;
  const householdId = contact.household_id;

  if (role === "head_of_family" && familyId) {
    // Fetch all households, respecting hof_visible flag
    const { data: allHouseholds } = await supabase
      .from("households")
      .select("id, label, address, hof_visible, governance_status, fiduciary_entity")
      .eq("family_id", familyId)
      .order("label");

    // HoF can always see their own household; others only if hof_visible is true
    const households = (allHouseholds || []).filter((h: any) =>
      h.id === householdId || h.hof_visible === true
    );

    const householdIds = households.map((h: any) => h.id);

    // Fetch all contacts in these households
    const { data: allMembers } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, family_role, is_minor, household_id, email")
      .in("household_id", householdIds.length > 0 ? householdIds : ["__none__"]);

    const memberIds = (allMembers || []).map((m: any) => m.id);
    const assets = await fetchAssetsForContacts(supabase, memberIds);

    // Group by household
    const householdsWithMembers = households.map((hh: any) => {
      const members = (allMembers || []).filter((m: any) => m.household_id === hh.id);
      return {
        id: hh.id,
        label: hh.label,
        address: hh.address,
        governance_status: hh.governance_status,
        fiduciary_entity: hh.fiduciary_entity,
        members: members.map((m: any) => ({
          ...m,
          // Denormalized from this household for hierarchy-view read
          // convenience -- assembled fresh on every request, never stored,
          // so this isn't the same drift-prone duplication being removed
          // from the contacts table.
          governance_status: hh.governance_status,
          fiduciary_entity: hh.fiduciary_entity,
          vineyard_accounts: assets.vineyard.filter((v: any) => v.contact_id === m.id),
          storehouses: assets.storehouses.filter((s: any) => s.contact_id === m.id),
        })),
      };
    });

    return { level: "family", households: householdsWithMembers };
  }

  if ((role === "head_of_family" || role === "head_of_household" || role === "spouse" || role === "beneficiary") && householdId) {
    // Head of household, spouse, or beneficiary: see household members
    const [{ data: members }, { data: ownHousehold }] = await Promise.all([
      supabase
        .from("contacts")
        .select("id, first_name, last_name, family_role, is_minor, email")
        .eq("household_id", householdId)
        .neq("id", contact.id),
      supabase.from("households").select("governance_status, fiduciary_entity").eq("id", householdId).maybeSingle(),
    ]);

    const memberIds = (members || []).map((m: any) => m.id);
    const assets = await fetchAssetsForContacts(supabase, memberIds);

    return {
      level: role === "head_of_family" ? "family" : "household",
      members: (members || []).map((m: any) => ({
        ...m,
        // Denormalized from the shared household for read convenience --
        // every member here is in the same householdId as the caller.
        governance_status: ownHousehold?.governance_status,
        fiduciary_entity: ownHousehold?.fiduciary_entity,
        vineyard_accounts: assets.vineyard.filter((v: any) => v.contact_id === m.id),
        storehouses: assets.storehouses.filter((s: any) => s.contact_id === m.id),
      })),
    };
  }

  return { level: "individual" };
}

// Fetch Quarterly Reviews pinned from the "Sovereignty Charter Sources" Drive folder.
// Returns rows with a 24h signed URL when stored in the private bucket; falls back to the Drive link.
async function fetchQuarterlyReviews(supabase: any, contactIds: string[]) {
  if (!contactIds || contactIds.length === 0) return [];
  const { data, error } = await supabase
    .from("sovereignty_charter_sources")
    .select("id, contact_id, title, file_name, source_url, storage_bucket, storage_path, external_modified_at, created_at")
    .in("contact_id", contactIds)
    .eq("source_kind", "quarterly_review")
    .order("external_modified_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error || !data) return [];

  const enriched = await Promise.all(
    data.map(async (row: any) => {
      let signed_url: string | null = null;
      if (row.storage_bucket && row.storage_path) {
        const { data: signed } = await supabase.storage
          .from(row.storage_bucket)
          .createSignedUrl(row.storage_path, 60 * 60 * 24);
        signed_url = signed?.signedUrl || null;
      }
      return {
        id: row.id,
        contact_id: row.contact_id,
        title: row.title || row.file_name || "Quarterly Governance Review",
        file_name: row.file_name,
        signed_url,
        drive_url: row.source_url || null,
        review_date: row.external_modified_at || row.created_at,
      };
    }),
  );
  return enriched;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { token } = await req.json();
    if (!token) {
      return new Response(JSON.stringify({ error: "Token required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Validate token
    const { data: portalToken, error: tokenError } = await supabase
      .from("portal_tokens")
      .select("*")
      .eq("token", token)
      .eq("revoked", false)
      .maybeSingle();

    if (tokenError || !portalToken) {
      return new Response(JSON.stringify({ error: "Invalid or expired link" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (new Date(portalToken.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: "This link has expired" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Enforce single-use semantics for magic-link tokens. We allow the same
    // token to resolve once (so the page can load), then mark it used.
    // Subsequent attempts get rejected — the user falls back to OTP.
    if (portalToken.single_use && portalToken.used_at) {
      return new Response(JSON.stringify({ error: "This link has already been used. Please sign in with your email." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (portalToken.single_use && !portalToken.used_at) {
      const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
      await supabase
        .from("portal_tokens")
        .update({ used_at: new Date().toISOString(), first_used_ip: clientIp })
        .eq("token", token);
    }

    const contactId = portalToken.contact_id;
    const advisorUserId = portalToken.created_by;


    // Fetch all portal data in parallel
    const [contactRes, accountsRes, storehousesRes, auditRes, requestsRes, holdingTankRes, charterRes] = await Promise.all([
      supabase.from("contacts").select("*").eq("id", contactId).maybeSingle(),
      supabase.from("vineyard_accounts").select("*").eq("contact_id", contactId).order("created_at"),
      supabase.from("storehouses").select("*").eq("contact_id", contactId).order("storehouse_number"),
      supabase.from("sovereignty_audit_trail").select("*").eq("contact_id", contactId).order("created_at", { ascending: false }).limit(50),
      supabase.from("portal_requests").select("*, messages:portal_request_messages(*)").eq("contact_id", contactId).order("created_at", { ascending: false }),
      supabase.from("holding_tank").select("*").eq("contact_id", contactId).eq("status", "holding").order("created_at"),
      supabase.from("sovereignty_charters").select("id, title, draft_status, ratified_at, last_generated_at").eq("contact_id", contactId).maybeSingle(),
    ]);

    if (contactRes.error) console.error("[portal-validate] contacts query error:", contactRes.error);
    if (!contactRes.data) console.error("[portal-validate] contact not found for id", contactId);

    // Fetch family, household, and household members if available
    let family = null;
    let household = null;
    let householdMembers: any[] = [];

    const familyId = contactRes.data?.family_id;
    const householdId = contactRes.data?.household_id;

    if (familyId || householdId) {
      const extraQueries: any[] = [];
      
      if (familyId) {
        extraQueries.push(
          supabase.from("families").select("id, name, charter_document_url, fee_tier, total_family_assets, vfo_enabled, vfo_enrolled_at").eq("id", familyId).maybeSingle()
        );
      } else {
        extraQueries.push(Promise.resolve({ data: null }));
      }

      if (householdId) {
        extraQueries.push(
          supabase.from("households").select("id, label, address, governance_status, fiduciary_entity").eq("id", householdId).maybeSingle()
        );
        extraQueries.push(
          supabase.from("contacts").select("id, first_name, last_name, family_role, is_minor").eq("household_id", householdId).neq("id", contactId)
        );
      } else {
        extraQueries.push(Promise.resolve({ data: null }));
        extraQueries.push(Promise.resolve({ data: [] }));
      }

      const [familyRes, householdRes, membersRes] = await Promise.all(extraQueries);
      family = familyRes.data;
      household = householdRes.data;
      householdMembers = membersRes.data || [];
    }

    // Build hierarchy data based on role
    const hierarchy = contactRes.data ? await buildHierarchy(supabase, contactRes.data) : { level: "individual" };

    // Fetch household-wide holding tank by contact membership (not household_id field which may be stale)
    let householdHoldingTank: any[] = [];
    if (householdId) {
      const hhMemberIds = [contactId, ...householdMembers.map((m: any) => m.id)];
      const { data: hhHolding } = await supabase
        .from("holding_tank")
        .select("*")
        .in("contact_id", hhMemberIds)
        .eq("status", "holding")
        .order("created_at");
      householdHoldingTank = hhHolding || [];
    }

    // Fetch family-wide holding tank for all family members across households
    let familyHoldingTank: any[] = [];
    if (hierarchy.level === "family" && Array.isArray(hierarchy.households)) {
      const familyMemberIds = hierarchy.households.flatMap((hh: any) =>
        (hh.members || []).map((m: any) => m.id)
      );
      const uniqueFamilyMemberIds = [...new Set(familyMemberIds)];
      if (uniqueFamilyMemberIds.length > 0) {
        const { data: famHolding } = await supabase
          .from("holding_tank")
          .select("*")
          .in("contact_id", uniqueFamilyMemberIds)
          .eq("status", "holding")
          .order("created_at");
        familyHoldingTank = famHolding || [];
      }
    }

    // Fetch corporations via shareholders for all household members + self
    let corporations: any[] = [];
    const allMemberIds = [contactId, ...householdMembers.map((m: any) => m.id)];
    const { data: shareholders } = await supabase
      .from("shareholders")
      .select("contact_id, corporation_id, ownership_percentage, share_class, role_title")
      .in("contact_id", allMemberIds)
      .eq("is_active", true);

    if (shareholders && shareholders.length > 0) {
      const corpIds = [...new Set(shareholders.map((s: any) => s.corporation_id))];
      const [corpsRes, corpVineyardRes] = await Promise.all([
        supabase.from("corporations").select("id, name, corporation_type, jurisdiction").in("id", corpIds),
        supabase.from("corporate_vineyard_accounts").select("*").in("corporation_id", corpIds),
      ]);

      corporations = (corpsRes.data || []).map((corp: any) => ({
        ...corp,
        shareholders: shareholders.filter((s: any) => s.corporation_id === corp.id),
        vineyard_accounts: (corpVineyardRes.data || []).filter((v: any) => v.corporation_id === corp.id),
        total_assets: (corpVineyardRes.data || [])
          .filter((v: any) => v.corporation_id === corp.id)
          .reduce((sum: number, v: any) => sum + (Number(v.current_value) || 0), 0),
      }));
    }

    // Fetch calendar events if contact has an email
    let meetings: any[] = [];
    const contactEmail = contactRes.data?.email;
    if (contactEmail) {
      const googleToken = await getValidGoogleToken(supabase, advisorUserId);
      if (googleToken) {
        meetings = await fetchCalendarEvents(googleToken, contactEmail);
      }
    }

    // Pinned Quarterly Reviews (synced from "Sovereignty Charter Sources" Drive folder)
    const reviewMemberIds = [contactId, ...householdMembers.map((m: any) => m.id)];
    const quarterly_reviews = await fetchQuarterlyReviews(supabase, reviewMemberIds);

    // VFO Professionals & engagements scoped to this family / household / contacts
    let professionals: any[] = [];
    let engagements: any[] = [];
    try {
      const scopeIds: string[] = [];
      if (familyId) scopeIds.push(familyId);
      if (householdId) scopeIds.push(householdId);
      reviewMemberIds.forEach((id) => id && scopeIds.push(id));
      if (scopeIds.length > 0) {
        const { data: engRows } = await supabase
          .from("professional_engagements")
          .select("id, professional_id, scope_type, scope_id, pillar, title, status, started_at, completed_at, updated_at")
          .in("scope_id", scopeIds)
          .neq("status", "draft")
          .neq("status", "revoked")
          .order("updated_at", { ascending: false });
        engagements = engRows || [];
        const proIds = [...new Set(engagements.map((e: any) => e.professional_id).filter(Boolean))];
        if (proIds.length > 0) {
          const { data: pros } = await supabase
            .from("professionals")
            .select("id, full_name, firm, professional_type, credentials, email, phone")
            .in("id", proIds);
          professionals = pros || [];
        }
      }
    } catch (e) {
      console.error("[portal-validate] professionals fetch error", e);
    }

    // Attach latest performance snapshot to every account (vineyard / storehouse / holding tank)
    try {
      const vyIds: string[] = [];
      const shIds: string[] = [];
      const htIds: string[] = [];
      const pushVy = (rows: any[]) => (rows || []).forEach((r: any) => r?.id && vyIds.push(r.id));
      const pushSh = (rows: any[]) => (rows || []).forEach((r: any) => r?.id && shIds.push(r.id));
      const pushHt = (rows: any[]) => (rows || []).forEach((r: any) => r?.id && htIds.push(r.id));

      pushVy(accountsRes.data || []);
      pushSh(storehousesRes.data || []);
      pushHt(holdingTankRes.data || []);
      pushHt(householdHoldingTank);
      pushHt(familyHoldingTank);
      if (Array.isArray(hierarchy?.households)) {
        hierarchy.households.forEach((hh: any) => (hh.members || []).forEach((m: any) => {
          pushVy(m.vineyard_accounts); pushSh(m.storehouses);
        }));
      }
      if (Array.isArray(hierarchy?.members)) {
        hierarchy.members.forEach((m: any) => { pushVy(m.vineyard_accounts); pushSh(m.storehouses); });
      }

      const uniq = (arr: string[]) => [...new Set(arr)];
      const [vySnapRes, shSnapRes, htSnapRes] = await Promise.all([
        vyIds.length ? supabase.from("account_harvest_snapshots")
          .select("vineyard_account_id, snapshot_date, boy_value, current_value, current_harvest, ytd_value, ror_ytd, ror_6m, ror_1y, ror_3y, ror_5y, ror_since_inception")
          .in("vineyard_account_id", uniq(vyIds)).order("snapshot_date", { ascending: false }) : Promise.resolve({ data: [] }),
        shIds.length ? supabase.from("account_harvest_snapshots")
          .select("storehouse_id, snapshot_date, boy_value, current_value, current_harvest, ytd_value, ror_ytd, ror_6m, ror_1y, ror_3y, ror_5y, ror_since_inception")
          .in("storehouse_id", uniq(shIds)).order("snapshot_date", { ascending: false }) : Promise.resolve({ data: [] }),
        htIds.length ? supabase.from("account_harvest_snapshots")
          .select("holding_tank_id, snapshot_date, boy_value, current_value, current_harvest, ytd_value, ror_ytd, ror_6m, ror_1y, ror_3y, ror_5y, ror_since_inception")
          .in("holding_tank_id", uniq(htIds)).order("snapshot_date", { ascending: false }) : Promise.resolve({ data: [] }),
      ]);

      const latestBy = (rows: any[], key: string) => {
        const m = new Map<string, any>();
        (rows || []).forEach((r: any) => { if (r[key] && !m.has(r[key])) m.set(r[key], r); });
        return m;
      };
      const vyMap = latestBy(vySnapRes.data as any[], "vineyard_account_id");
      const shMap = latestBy(shSnapRes.data as any[], "storehouse_id");
      const htMap = latestBy(htSnapRes.data as any[], "holding_tank_id");
      const attachVy = (rows: any[]) => (rows || []).forEach((r: any) => { if (r?.id) r.latest_snapshot = vyMap.get(r.id) || null; });
      const attachSh = (rows: any[]) => (rows || []).forEach((r: any) => { if (r?.id) r.latest_snapshot = shMap.get(r.id) || null; });
      const attachHt = (rows: any[]) => (rows || []).forEach((r: any) => { if (r?.id) r.latest_snapshot = htMap.get(r.id) || null; });

      attachVy(accountsRes.data || []);
      attachSh(storehousesRes.data || []);
      attachHt(holdingTankRes.data || []);
      attachHt(householdHoldingTank);
      attachHt(familyHoldingTank);
      if (Array.isArray(hierarchy?.households)) {
        hierarchy.households.forEach((hh: any) => (hh.members || []).forEach((m: any) => {
          attachVy(m.vineyard_accounts); attachSh(m.storehouses);
        }));
      }
      if (Array.isArray(hierarchy?.members)) {
        hierarchy.members.forEach((m: any) => { attachVy(m.vineyard_accounts); attachSh(m.storehouses); });
      }
    } catch (e) {
      console.error("[portal-validate] snapshot attach error", e);
    }

    // Fetch insurance policies for all in-scope contacts and corporations
    let insurance_policies: any[] = [];
    try {
      const insContactIds = new Set<string>([contactId, ...householdMembers.map((m: any) => m.id)]);
      if (Array.isArray(hierarchy?.households)) {
        hierarchy.households.forEach((hh: any) => (hh.members || []).forEach((m: any) => insContactIds.add(m.id)));
      }
      if (Array.isArray(hierarchy?.members)) {
        hierarchy.members.forEach((m: any) => insContactIds.add(m.id));
      }
      const insCorpIds = corporations.map((c: any) => c.id);
      const [insByContact, insByCorp] = await Promise.all([
        insContactIds.size > 0
          ? supabase.from("insurance_policies").select("*").in("contact_id", [...insContactIds])
          : Promise.resolve({ data: [] }),
        insCorpIds.length > 0
          ? supabase.from("insurance_policies").select("*").in("corporation_id", insCorpIds)
          : Promise.resolve({ data: [] }),
      ]);
      const seen = new Set<string>();
      insurance_policies = [...(insByContact.data || []), ...(insByCorp.data || [])].filter((p: any) => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      });
    } catch (e) {
      console.error("[portal-validate] insurance fetch error", e);
    }

    return new Response(JSON.stringify({
      contact: contactRes.data,
      vineyard_accounts: accountsRes.data || [],
      storehouses: storehousesRes.data || [],
      holding_tank: holdingTankRes.data || [],
      household_holding_tank: (() => {
        const individual = holdingTankRes.data || [];
        const individualIds = new Set(individual.map((r: any) => r.id));
        return [...individual, ...householdHoldingTank.filter((r: any) => !individualIds.has(r.id))];
      })(),
      family_holding_tank: familyHoldingTank,
      audit_trail: auditRes.data || [],
      portal_requests: requestsRes.data || [],
      meetings,
      family,
      household,
      household_members: householdMembers,
      hierarchy,
      corporations,
      charter: charterRes.data,
      quarterly_reviews,
      professionals,
      engagements,
      insurance_policies,

    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Portal validate error:", e);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
