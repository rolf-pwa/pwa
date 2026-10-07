// One place that works out a household's Sovereignty Charter: where it lives, whether it is ratified, and what it says.
// Used by the Sovereignty Review and the Governance Audit so the two always agree. Order of precedence:
//   1. a Charter file in the Vault (10 Correspondence, ideally a "Charter" subfolder); non-draft = ratified
//   2. the household's v2 Charter record (ratified when complete)
//   3. an earlier-format Charter (a linked charter document, or a sovereignty_charters row marked ratified)

// deno-lint-ignore-file no-explicit-any
import { extractCharter, locateVaultCharter, type CharterExtract } from "./charter-vault.ts";
import type { CharterFile } from "./charter-vault-pick.ts";
import { getServiceGoogleAccessToken } from "./google-token.ts";
import type { ServiceAccountKey } from "./vertex-ai.ts";

import { decideCharter, type CharterSource } from "./charter-decide.ts";
export { decideCharter, type CharterSource };

const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

export interface ResolvedCharter {
  source: CharterSource;
  ratified: boolean;
  vaultCharter: CharterFile | null;
  vaultExtract: CharterExtract | null;
  text: {
    source: CharterSource; ratified: boolean;
    purpose: string; mission: string; vision: string; values: string[];
    reserveRules: string; governance: string; unreadable: boolean;
    targets: CharterExtract["targets"];
    incomeSources: CharterExtract["income_sources"];
  };
}

export async function resolveCharter(
  supabase: any,
  opts: {
    householdId: string;
    contacts: Array<{ id: string; charter_url?: string | null }>;
    vaultRootFolderId: string | null;
    saKey: ServiceAccountKey | null;
  },
): Promise<ResolvedCharter> {
  const contactIds = opts.contacts.map((c) => c.id);
  const [{ data: hCharter }, { data: cCharters }] = await Promise.all([
    supabase.from("household_charters").select("status, completed_at, vision_text, core_values").eq("household_id", opts.householdId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    contactIds.length
      ? supabase.from("sovereignty_charters").select("intro_callout, intro_note, mission_of_capital, vision_20_year, draft_status, esign_status").in("contact_id", contactIds).limit(1)
      : Promise.resolve({ data: [] }),
  ]);
  const cc = (cCharters ?? [])[0] ?? null;

  let vaultCharter: CharterFile | null = null;
  let vaultExtract: CharterExtract | null = null;
  if (opts.vaultRootFolderId) {
    try {
      const { data: corrTmpl } = await supabase.from("vault_folder_templates").select("display_name").eq("slug", "correspondence").eq("is_active", true).maybeSingle();
      if (corrTmpl) {
        const token = await getServiceGoogleAccessToken(supabase);
        vaultCharter = await locateVaultCharter(opts.vaultRootFolderId, corrTmpl.display_name, token);
        if (vaultCharter && opts.saKey) vaultExtract = await extractCharter(opts.saKey, vaultCharter, token);
      }
    } catch (e) {
      console.error("charter-resolve: Vault Charter lookup failed:", e instanceof Error ? e.message : String(e));
    }
  }

  const { source, ratified } = decideCharter({
    vaultCharter,
    hasHouseholdCharter: !!hCharter,
    householdComplete: !!hCharter && (/complete/i.test(String(hCharter.status ?? "")) || !!hCharter.completed_at),
    hasContactCharterRow: !!cc,
    hasCharterUrl: opts.contacts.some((c) => !!c.charter_url),
    contactCharterRatified: cc?.draft_status === "ratified" || cc?.esign_status === "ratified",
  });

  const text = {
    source, ratified,
    purpose: clip(vaultExtract?.purpose || cc?.intro_callout || cc?.intro_note, 700),
    mission: clip(vaultExtract?.mission || cc?.mission_of_capital, 700),
    vision: clip(vaultExtract?.vision || hCharter?.vision_text || cc?.vision_20_year, 900),
    values: vaultExtract?.values?.length ? vaultExtract.values
      : Array.isArray(hCharter?.core_values) ? hCharter.core_values.slice(0, 8).map((v: any) => clip(typeof v === "string" ? v : v?.name ?? v?.label ?? "", 60)).filter(Boolean) : [],
    reserveRules: vaultExtract?.reserve_rules ?? "",
    governance: vaultExtract?.governance ?? "",
    unreadable: !!vaultCharter && !vaultExtract,
    targets: vaultExtract?.targets ?? [],
    incomeSources: vaultExtract?.income_sources ?? [],
  };
  return { source, ratified, vaultCharter, vaultExtract, text };
}
