import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
};

interface PerfRow {
  contract: string;
  last_name: string;
  first_name: string;
  product?: string;
  registration?: string;
  issue_date?: string | null;
  boy_value?: number | null;
  current_value?: number | null;
  variation_pct?: number | null;
  variation_dollar?: number | null;
  ror_ytd?: number | null;
  ror_6m?: number | null;
  ror_1y?: number | null;
  ror_3y?: number | null;
  ror_5y?: number | null;
  ror_since_inception?: number | null;
  raw_note?: string;
}

function normName(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z]/g, "");
}
function toNum(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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

    const { mode = "preview", snapshot_date, rows, source_file } = await req.json();
    if (!snapshot_date) throw new Error("snapshot_date required (YYYY-MM-DD)");
    if (!Array.isArray(rows)) throw new Error("rows[] required");

    const [{ data: htRows }, { data: vyRows }, { data: contacts }] = await Promise.all([
      supabase.from("holding_tank").select("id, contact_id, account_number, account_name, household_id"),
      supabase.from("vineyard_accounts").select("id, contact_id, account_number, account_name"),
      supabase.from("contacts").select("id, first_name, last_name, full_name, family_id, household_id"),
    ]);

    const htByContract = new Map<string, any>();
    (htRows || []).forEach((r: any) => r.account_number && htByContract.set(String(r.account_number), r));
    const vyByContract = new Map<string, any>();
    (vyRows || []).forEach((r: any) => r.account_number && vyByContract.set(String(r.account_number), r));
    const contactByName = new Map<string, any>();
    (contacts || []).forEach((c: any) => {
      const k = normName((c.first_name || "") + (c.last_name || ""));
      if (k) contactByName.set(k, c);
    });

    // Snapshots already existing for this date
    const contractIds = [...htRows?.map((r: any) => r.id) || []];
    const vyIds = [...vyRows?.map((r: any) => r.id) || []];
    const [{ data: htSnaps }, { data: vySnaps }] = await Promise.all([
      contractIds.length
        ? supabase.from("account_harvest_snapshots").select("holding_tank_id").eq("snapshot_date", snapshot_date).in("holding_tank_id", contractIds)
        : Promise.resolve({ data: [] }),
      vyIds.length
        ? supabase.from("account_harvest_snapshots").select("vineyard_account_id").eq("snapshot_date", snapshot_date).in("vineyard_account_id", vyIds)
        : Promise.resolve({ data: [] }),
    ]);
    const existingHtSnaps = new Set<string>((htSnaps || []).map((s: any) => s.holding_tank_id));
    const existingVySnaps = new Set<string>((vySnaps || []).map((s: any) => s.vineyard_account_id));

    const report = {
      snapshot_date,
      total_rows: rows.length,
      matched_holding: 0,
      matched_vineyard: 0,
      auto_created_holding: 0,
      updated_existing: 0,
      skipped_no_data: 0,
      unmatched_no_contact: [] as any[],
      preview_ops: [] as any[],
    };

    interface Op {
      kind: "upsert_snapshot" | "create_ht_then_snapshot";
      row: PerfRow;
      target?: { table: "holding_tank" | "vineyard_accounts"; id: string; contact_id: string };
      needsHt?: { contact_id: string; household_id?: string | null; account_name: string; account_number: string; account_type: string };
      isUpdate?: boolean;
    }
    const ops: Op[] = [];

    for (const r of rows as PerfRow[]) {
      const contract = String(r.contract || "").trim();
      if (!contract) continue;

      if (r.boy_value == null && r.current_value == null) {
        report.skipped_no_data++;
        continue;
      }

      const vy = vyByContract.get(contract);
      if (vy) {
        const isUpdate = existingVySnaps.has(vy.id);
        if (isUpdate) report.updated_existing++; else report.matched_vineyard++;
        ops.push({ kind: "upsert_snapshot", row: r, target: { table: "vineyard_accounts", id: vy.id, contact_id: vy.contact_id }, isUpdate });
        continue;
      }
      const ht = htByContract.get(contract);
      if (ht) {
        const isUpdate = existingHtSnaps.has(ht.id);
        if (isUpdate) report.updated_existing++; else report.matched_holding++;
        ops.push({ kind: "upsert_snapshot", row: r, target: { table: "holding_tank", id: ht.id, contact_id: ht.contact_id }, isUpdate });
        continue;
      }


      // Unmatched — try contact by name to create HT stub
      const nkey = normName(r.first_name + r.last_name);
      const c = contactByName.get(nkey);
      if (!c) {
        report.unmatched_no_contact.push({ contract, first: r.first_name, last: r.last_name, registration: r.registration });
        continue;
      }
      report.auto_created_holding++;
      ops.push({
        kind: "create_ht_then_snapshot",
        row: r,
        needsHt: {
          contact_id: c.id,
          household_id: c.household_id,
          account_name: `iA ${r.registration || r.product || "Account"} · ${contract} (AUTO)`,
          account_number: contract,
          account_type: r.registration || r.product || "Portfolio",
        },
      });
    }

    if (mode === "preview") {
      return new Response(JSON.stringify({ ok: true, report }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // COMMIT
    const commit = { snapshots_inserted: 0, snapshots_updated: 0, ht_created: 0, errors: [] as any[] };
    for (const op of ops) {
      try {
        let holding_tank_id: string | null = null;
        let vineyard_account_id: string | null = null;
        let contact_id: string;

        if (op.kind === "create_ht_then_snapshot" && op.needsHt) {
          const { data: newHt, error: he } = await supabase.from("holding_tank").insert({
            ...op.needsHt,
            custodian: "iA Financial Group",
            status: "holding",
            notes: `AUTO-CREATED from performance file ${source_file || snapshot_date}. Needs advisor review to link contact/household.`,
            source_file: source_file || `perf-${snapshot_date}`,
          }).select("id, contact_id").single();
          if (he) throw he;
          commit.ht_created++;
          holding_tank_id = newHt.id;
          contact_id = newHt.contact_id;
        } else if (op.target) {
          if (op.target.table === "holding_tank") holding_tank_id = op.target.id;
          else vineyard_account_id = op.target.id;
          contact_id = op.target.contact_id;
        } else continue;

        const row = op.row;
        const snapDate = snapshot_date;
        const year = new Date(snapDate).getUTCFullYear();
        const boy = toNum(row.boy_value) ?? 0;
        const cur = toNum(row.current_value) ?? 0;
        const harvest = toNum(row.variation_dollar) ?? (cur - boy);

        // Source file stores percentages as decimal fractions (0.1327 = 13.27%).
        // UI expects percentage numbers (13.27). Convert on import.
        const pct = (v: any): number | null => {
          const n = toNum(v);
          return n == null ? null : n * 100;
        };
        const ytdVal = pct(row.variation_pct) ?? 0;

        const snapshotPayload: any = {
          contact_id,
          holding_tank_id,
          vineyard_account_id,
          snapshot_date: snapDate,
          reporting_year: year,
          boy_value: boy,
          current_value: cur,
          current_harvest: harvest,
          ytd_value: ytdVal,
          ror_ytd: pct(row.ror_ytd),
          ror_6m: pct(row.ror_6m),
          ror_1y: pct(row.ror_1y),
          ror_3y: pct(row.ror_3y),
          ror_5y: pct(row.ror_5y),
          ror_since_inception: pct(row.ror_since_inception),

          notes: source_file ? `Import: ${source_file}` : null,
          created_by: user.id,
        };

        // Update existing snapshot if present for this account+date; otherwise insert
        let existingSnapId: string | null = null;
        if (holding_tank_id) {
          const { data: es } = await supabase.from("account_harvest_snapshots")
            .select("id").eq("snapshot_date", snapDate).eq("holding_tank_id", holding_tank_id).maybeSingle();
          existingSnapId = es?.id ?? null;
        } else if (vineyard_account_id) {
          const { data: es } = await supabase.from("account_harvest_snapshots")
            .select("id").eq("snapshot_date", snapDate).eq("vineyard_account_id", vineyard_account_id).maybeSingle();
          existingSnapId = es?.id ?? null;
        }

        if (existingSnapId) {
          const { error: ue } = await supabase.from("account_harvest_snapshots")
            .update(snapshotPayload).eq("id", existingSnapId);
          if (ue) throw ue;
          commit.snapshots_updated++;
        } else {
          const { error: se } = await supabase.from("account_harvest_snapshots").insert(snapshotPayload);
          if (se) throw se;
          commit.snapshots_inserted++;
        }


        // Also update the account row itself so dashboards render current values
        const updatePayload: any = {
          current_value: cur,
          book_value: boy,
          updated_at: new Date().toISOString(),
        };
        if (holding_tank_id) {
          await supabase.from("holding_tank").update(updatePayload).eq("id", holding_tank_id);
        } else if (vineyard_account_id) {
          await supabase.from("vineyard_accounts").update(updatePayload).eq("id", vineyard_account_id);
        }
      } catch (e) {
        commit.errors.push({ contract: op.row.contract, error: (e as Error).message });
      }
    }

    return new Response(JSON.stringify({ ok: true, report, commit }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("bulk-import-performance error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
