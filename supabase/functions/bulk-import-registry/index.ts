import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getServiceGoogleAccessToken } from "../_shared/google-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
};

interface AccountEntry {
  contract: string;
  registration: string; // TFSA, RRSP, etc
  raw: string;
  joint_with?: string;
}

interface MemberEntry {
  first_name: string;
  last_name: string;
  container: "holding_tank" | "vineyard" | "storehouse";
  storehouse_label?: string;
  accounts: AccountEntry[];
}

interface HouseholdEntry {
  label: string;
  address: string;
  members: MemberEntry[];
}

function extractDocText(doc: any): string {
  const lines: string[] = [];
  for (const el of doc?.body?.content ?? []) {
    const p = el.paragraph;
    if (!p) continue;
    const txt = (p.elements || []).map((e: any) => e.textRun?.content ?? "").join("");
    lines.push(txt.replace(/\n$/, ""));
  }
  return lines.join("\n");
}

function parseRegistry(text: string): HouseholdEntry[] {
  const lines = text.split("\n").map((l) => l.trim());
  const households: HouseholdEntry[] = [];
  let cur: HouseholdEntry | null = null;
  let curMember: MemberEntry | null = null;
  let curContainer: MemberEntry["container"] = "holding_tank";
  let curStorehouseLabel: string | undefined;

  const householdRe = /^\d+\.\s+(.+?)\s+Household\s*$/i;
  const addressRe = /^Address:\s*(.+)$/i;
  const contractRe = /^Contract\s*(?:No|Number)\.?:?\s*(\d+)\s*(?:\((.+)\))?/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const hm = line.match(householdRe);
    if (hm) {
      if (cur) households.push(cur);
      cur = { label: hm[1].trim(), address: "", members: [] };
      curMember = null;
      continue;
    }
    if (!cur) continue;

    const am = line.match(addressRe);
    if (am) {
      cur.address = am[1].trim();
      continue;
    }

    if (/^Members:?$/i.test(line)) continue;

    // Container headers
    if (/^Holding\s*Tank$/i.test(line)) {
      curContainer = "holding_tank";
      curStorehouseLabel = undefined;
      continue;
    }
    if (/^Vineyard$/i.test(line)) {
      curContainer = "vineyard";
      curStorehouseLabel = undefined;
      continue;
    }
    const sh = line.match(/^Storehouse\s*[-–]\s*(.+)$/i);
    if (sh) {
      curContainer = "storehouse";
      curStorehouseLabel = sh[1].trim();
      continue;
    }

    // Contract line
    const cm = line.match(contractRe);
    if (cm && curMember) {
      const raw = cm[2] || "";
      // "TFSA - Series 75/100" or "Non-registered - Joint with X"
      const regMatch = raw.match(/^([A-Za-z-]+(?:\s+[A-Za-z]+)?)/);
      const registration = regMatch ? regMatch[1].trim() : raw.split(/\s*[-–]\s*/)[0].trim();
      const jointMatch = raw.match(/joint\s+with\s+([^)]+)/i);
      curMember.accounts.push({
        contract: cm[1],
        registration,
        raw,
        joint_with: jointMatch?.[1].trim(),
      });
      continue;
    }

    // Otherwise assume it's a member name (if next non-blank is a container header or contract)
    // Heuristic: lines that are 1-4 words, no colon, not "Portfolio" summary
    if (
      /^[A-Z][A-Za-z''.\-]+(?:\s+[A-Z][A-Za-z''.\-]+){0,3}$/.test(line) &&
      !/Household|Portfolio|Advisor|Report|Summary|Contract/i.test(line)
    ) {
      // Skip generic labels
      if (/^(TFSA|RRSP|FHSA|RESP|RRIF|LIF|LIRSP|Non-registered|Cash|Portfolio)$/i.test(line)) continue;
      const parts = line.split(/\s+/);
      const first = parts[0];
      const last = parts.slice(1).join(" ") || cur.label.split(/\s*[/&]\s*/)[0];
      curMember = {
        first_name: first,
        last_name: last,
        container: curContainer,
        storehouse_label: curStorehouseLabel,
        accounts: [],
      };
      cur.members.push(curMember);
      continue;
    }
  }
  if (cur) households.push(cur);
  return households;
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}
function normalizeAddress(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json();
    const { mode = "preview", doc_id, raw_text } = body;
    if (!["preview", "commit"].includes(mode)) throw new Error("mode must be preview or commit");

    // Get doc text
    let text: string;
    if (raw_text) {
      text = raw_text;
    } else if (doc_id) {
      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const accessToken = await getServiceGoogleAccessToken(admin);
      const resp = await fetch(`https://docs.googleapis.com/v1/documents/${doc_id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!resp.ok) throw new Error(`Google Docs fetch failed: ${resp.status} ${await resp.text()}`);
      const doc = await resp.json();
      text = extractDocText(doc);
    } else {
      throw new Error("provide doc_id or raw_text");
    }

    const parsed = parseRegistry(text);

    // Load existing state
    const [{ data: existingContacts }, { data: existingHouseholds }, { data: existingHT }] = await Promise.all([
      supabase.from("contacts").select("id, first_name, last_name, full_name, household_id, family_id"),
      supabase.from("households").select("id, family_id, label, address"),
      supabase.from("holding_tank").select("id, account_number, contact_id"),
    ]);

    const contactByName = new Map<string, any>();
    (existingContacts || []).forEach((c: any) => {
      const key = normalizeName((c.first_name || "") + (c.last_name || ""));
      if (key) contactByName.set(key, c);
      const fk = normalizeName(c.full_name || "");
      if (fk) contactByName.set(fk, c);
    });
    const householdByAddr = new Map<string, any>();
    (existingHouseholds || []).forEach((h: any) => {
      if (h.address) householdByAddr.set(normalizeAddress(h.address), h);
    });
    const contractSet = new Set<string>((existingHT || []).map((h: any) => h.account_number).filter(Boolean));

    // Plan
    const plan = {
      newFamilies: 0,
      newHouseholds: 0,
      newContacts: 0,
      newAccounts: 0,
      matchedContacts: 0,
      matchedHouseholds: 0,
      duplicateContracts: [] as string[],
      households: [] as any[],
    };

    const commitOps: any[] = [];

    for (const hh of parsed) {
      const hhKey = hh.address ? normalizeAddress(hh.address) : "";
      let existingH = hhKey ? householdByAddr.get(hhKey) : null;
      const hEntry: any = {
        label: hh.label,
        address: hh.address,
        existing_id: existingH?.id,
        family_id: existingH?.family_id,
        members: [],
      };
      if (!existingH) plan.newHouseholds++; else plan.matchedHouseholds++;

      for (const m of hh.members) {
        const nkey = normalizeName(m.first_name + m.last_name);
        let existingC = contactByName.get(nkey);
        const mEntry: any = {
          first_name: m.first_name,
          last_name: m.last_name,
          container: m.container,
          storehouse_label: m.storehouse_label,
          existing_contact_id: existingC?.id,
          accounts: [] as any[],
        };
        if (!existingC) plan.newContacts++; else plan.matchedContacts++;

        for (const a of m.accounts) {
          const dup = contractSet.has(a.contract);
          if (dup) plan.duplicateContracts.push(a.contract);
          else {
            plan.newAccounts++;
            contractSet.add(a.contract); // avoid dup within same import
          }
          mEntry.accounts.push({
            contract: a.contract,
            registration: a.registration,
            raw: a.raw,
            joint_with: a.joint_with,
            duplicate: dup,
          });
        }
        hEntry.members.push(mEntry);
      }
      plan.households.push(hEntry);
    }

    plan.newFamilies = plan.households.filter((h: any) => !h.family_id).length;

    if (mode === "preview") {
      return new Response(JSON.stringify({ ok: true, plan, parsedCount: parsed.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // COMMIT
    const results = { families: 0, households: 0, contacts: 0, accounts: 0, skipped: 0 };
    for (const hh of plan.households) {
      // Family
      let familyId = hh.family_id;
      if (!familyId) {
        const { data: fam, error: fe } = await supabase
          .from("families")
          .insert({ name: `${hh.label} Family`, created_by: user.id })
          .select("id").single();
        if (fe) throw fe;
        familyId = fam.id;
        results.families++;
      }
      // Household
      let householdId = hh.existing_id;
      if (!householdId) {
        const { data: h, error: he } = await supabase
          .from("households")
          .insert({ family_id: familyId, label: hh.label, address: hh.address || null })
          .select("id").single();
        if (he) throw he;
        householdId = h.id;
        results.households++;
      }

      // Track contact ids for joint accounts by name key
      const contactIdByKey = new Map<string, string>();

      for (const m of hh.members) {
        let contactId = m.existing_contact_id;
        if (!contactId) {
          const full = `${m.first_name} ${m.last_name}`.trim();
          const { data: c, error: ce } = await supabase
            .from("contacts")
            .insert({
              created_by: user.id,
              first_name: m.first_name,
              last_name: m.last_name,
              full_name: full,
              family_id: familyId,
              household_id: householdId,
              family_role: "head_of_family",
            })
            .select("id").single();
          if (ce) throw ce;
          contactId = c.id;
          results.contacts++;
        } else {
          // ensure link
          await supabase.from("contacts").update({
            family_id: familyId,
            household_id: householdId,
          }).eq("id", contactId).is("household_id", null);
        }
        contactIdByKey.set(normalizeName(m.first_name + m.last_name), contactId);

        for (const a of m.accounts) {
          if (a.duplicate) { results.skipped++; continue; }
          const accountName = `iA ${a.registration} · ${a.contract}`;
          const { error: ae } = await supabase.from("holding_tank").insert({
            contact_id: contactId,
            household_id: householdId,
            account_name: accountName,
            account_number: a.contract,
            account_type: a.registration || "Portfolio",
            custodian: "iA Financial Group",
            notes: a.joint_with ? `Joint with ${a.joint_with}. Source: MOC Household Registry.` : "Source: MOC Household Registry.",
            source_file: "MOC_Household_Registry",
            status: "holding",
          });
          if (ae && !/duplicate/i.test(ae.message)) throw ae;
          if (!ae) results.accounts++;
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("bulk-import-registry error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});


