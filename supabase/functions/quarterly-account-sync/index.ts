import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-region",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type OverrideKind = "vineyard" | "holding" | "storehouse" | "holding_tank_new" | "skip";

interface IncomingRow {
  csv_row_number: number;
  account_number?: string | null;
  client_name?: string | null;
  custodian?: string | null;
  account_type?: string | null;
  product?: string | null;
  boy_value?: number | null;
  current_value?: number | null;
  as_of_date?: string | null; // YYYY-MM-DD
  ror_ytd?: number | null;
  ror_6m?: number | null;
  ror_1y?: number | null;
  ror_3y?: number | null;
  ror_5y?: number | null;
  ror_since_inception?: number | null;
  override?: {
    kind: OverrideKind;
    id?: string | null;
    contact_id?: string | null;
  } | null;
}

type Destination =
  | "vineyard_update"
  | "holding_tank_update"
  | "storehouse_update"
  | "holding_tank_new"
  | "skipped"
  | "conflict"
  | "missing_account_number"
  | "missing_contact";

interface RowResult {
  csv_row_number: number;
  destination: Destination;
  account_number: string | null;
  client_name: string | null;
  matched_table?: "vineyard_accounts" | "holding_tank" | "storehouses" | null;
  matched_id?: string | null;
  matched_contact_id?: string | null;
  matched_contact_name?: string | null;
  message?: string;
  applied?: boolean;
}

const normalize = (v?: string | null) =>
  (v || "").toString().trim().replace(/[\s\-]/g, "").toUpperCase();

const parseNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const cleaned = String(v).replace(/[$,\s%]/g, "").replace(/[()]/g, (m) => m === "(" ? "-" : "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const mode: "preview" | "commit" = body.mode === "commit" ? "commit" : "preview";
    const rows: IncomingRow[] = Array.isArray(body.rows) ? body.rows : [];
    const sourceFile = body.source_file || "Quarterly CSV sync";

    if (rows.length === 0) {
      return new Response(JSON.stringify({ error: "No rows" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [vineyardRes, holdingRes, storehouseRes, contactsRes] = await Promise.all([
      admin.from("vineyard_accounts").select("id, contact_id, account_number, account_name, account_type"),
      admin.from("holding_tank").select("id, contact_id, household_id, account_number, account_name, account_type, custodian"),
      admin.from("storehouses").select("id, contact_id, label, storehouse_number"),
      admin.from("contacts").select("id, first_name, last_name, full_name, household_id"),
    ]);

    if (vineyardRes.error || holdingRes.error || storehouseRes.error || contactsRes.error) {
      throw new Error(
        vineyardRes.error?.message || holdingRes.error?.message ||
          storehouseRes.error?.message || contactsRes.error?.message,
      );
    }

    const vineyardByNum = new Map<string, typeof vineyardRes.data[number][]>();
    for (const v of vineyardRes.data || []) {
      const key = normalize(v.account_number);
      if (!key) continue;
      const list = vineyardByNum.get(key) || [];
      list.push(v);
      vineyardByNum.set(key, list);
    }
    const holdingByNum = new Map<string, typeof holdingRes.data[number][]>();
    for (const h of holdingRes.data || []) {
      const key = normalize(h.account_number);
      if (!key) continue;
      const list = holdingByNum.get(key) || [];
      list.push(h);
      holdingByNum.set(key, list);
    }

    const vineyardById = new Map((vineyardRes.data || []).map((v) => [v.id, v]));
    const holdingById = new Map((holdingRes.data || []).map((h) => [h.id, h]));
    const storehouseById = new Map((storehouseRes.data || []).map((s) => [s.id, s]));
    const contactById = new Map((contactsRes.data || []).map((c) => [c.id, c]));

    const contacts = contactsRes.data || [];
    const findContact = (name: string | null | undefined) => {
      if (!name) return null;
      const n = name.trim().toLowerCase();
      if (!n) return null;
      let hit = contacts.find((c) => (c.full_name || "").trim().toLowerCase() === n);
      if (hit) return hit;
      hit = contacts.find((c) => `${c.first_name || ""} ${c.last_name || ""}`.trim().toLowerCase() === n);
      if (hit) return hit;
      hit = contacts.find((c) => `${c.last_name || ""}, ${c.first_name || ""}`.trim().toLowerCase() === n);
      if (hit) return hit;
      return null;
    };

    const contactName = (c: any) =>
      c ? (c.full_name || `${c.first_name || ""} ${c.last_name || ""}`.trim()) : null;

    const results: RowResult[] = [];

    const writeSnapshot = async (
      contactId: string,
      keyField: "vineyard_account_id" | "holding_tank_id" | "storehouse_id",
      keyId: string,
      row: IncomingRow,
      snapshotDate: string,
      boy: number | null,
      current: number | null,
    ) => {
      if (boy === null && current === null) return null;
      const payload: Record<string, unknown> = {
        contact_id: contactId,
        snapshot_date: snapshotDate,
        boy_value: boy ?? 0,
        current_value: current ?? 0,
        ytd_value: current ?? 0,
        current_harvest: (current ?? 0) - (boy ?? 0),
        ror_ytd: row.ror_ytd ?? null,
        ror_6m: row.ror_6m ?? null,
        ror_1y: row.ror_1y ?? null,
        ror_3y: row.ror_3y ?? null,
        ror_5y: row.ror_5y ?? null,
        ror_since_inception: row.ror_since_inception ?? null,
        notes: `Imported from ${sourceFile}`,
        created_by: userId,
        vineyard_account_id: null,
        holding_tank_id: null,
        storehouse_id: null,
      };
      payload[keyField] = keyId;

      const existing = await admin
        .from("account_harvest_snapshots")
        .select("id")
        .eq(keyField, keyId)
        .eq("snapshot_date", snapshotDate)
        .limit(1);
      if (existing.error) return existing.error;

      if (existing.data?.[0]?.id) {
        const { error } = await admin
          .from("account_harvest_snapshots")
          .update(payload)
          .eq("id", existing.data[0].id);
        return error;
      }

      const { error } = await admin
        .from("account_harvest_snapshots")
        .insert(payload);
      return error;
    };

    const findExistingHoldingTank = async (contactId: string, accountNumber?: string | null) => {
      const acct = accountNumber?.trim();
      if (!acct) return null;
      const { data, error } = await admin
        .from("holding_tank")
        .select("id")
        .eq("contact_id", contactId)
        .eq("account_number", acct)
        .limit(1);
      if (error) throw error;
      return data?.[0] || null;
    };

    for (const row of rows) {
      const acctNum = normalize(row.account_number);
      const current = parseNumber(row.current_value);
      const boy = parseNumber(row.boy_value);
      const snapshotDate =
        row.as_of_date && /^\d{4}-\d{2}-\d{2}$/.test(row.as_of_date)
          ? row.as_of_date
          : new Date().toISOString().slice(0, 10);

      const base: RowResult = {
        csv_row_number: row.csv_row_number,
        destination: "missing_account_number",
        account_number: row.account_number || null,
        client_name: row.client_name || null,
        applied: false,
      };

      // 1. Manual overrides win
      if (row.override) {
        const ov = row.override;
        if (ov.kind === "skip") {
          results.push({ ...base, destination: "skipped", message: "Skipped by reviewer." });
          continue;
        }
        if (ov.kind === "vineyard" && ov.id) {
          const match = vineyardById.get(ov.id);
          if (!match) {
            results.push({ ...base, destination: "conflict", message: "Selected Vineyard account no longer exists." });
            continue;
          }
          const contact = contactById.get(match.contact_id);
          const result: RowResult = {
            ...base, destination: "vineyard_update",
            matched_table: "vineyard_accounts", matched_id: match.id,
            matched_contact_id: match.contact_id, matched_contact_name: contactName(contact),
          };
          if (mode === "commit") {
            const updates: Record<string, unknown> = {};
            if (current !== null) updates.current_value = current;
            if (boy !== null) updates.book_value = boy;
            if (Object.keys(updates).length) {
              const { error } = await admin.from("vineyard_accounts").update(updates).eq("id", match.id);
              if (error) { result.message = `Update failed: ${error.message}`; results.push(result); continue; }
            }
            const snapErr = await writeSnapshot(match.contact_id, "vineyard_account_id", match.id, row, snapshotDate, boy, current);
            if (snapErr) { result.message = `Snapshot failed: ${snapErr.message}`; results.push(result); continue; }
            result.applied = true;
          }
          results.push(result);
          continue;
        }
        if (ov.kind === "holding" && ov.id) {
          const match = holdingById.get(ov.id);
          if (!match) {
            results.push({ ...base, destination: "conflict", message: "Selected Holding Tank entry no longer exists." });
            continue;
          }
          const contact = contactById.get(match.contact_id);
          const result: RowResult = {
            ...base, destination: "holding_tank_update",
            matched_table: "holding_tank", matched_id: match.id,
            matched_contact_id: match.contact_id, matched_contact_name: contactName(contact),
          };
          if (mode === "commit") {
            const updates: Record<string, unknown> = {};
            if (current !== null) updates.current_value = current;
            if (boy !== null) updates.book_value = boy;
            if (Object.keys(updates).length) {
              const { error } = await admin.from("holding_tank").update(updates).eq("id", match.id);
              if (error) { result.message = `Update failed: ${error.message}`; results.push(result); continue; }
            }
            const snapErr = await writeSnapshot(match.contact_id, "holding_tank_id", match.id, row, snapshotDate, boy, current);
            if (snapErr) { result.message = `Snapshot failed: ${snapErr.message}`; results.push(result); continue; }
            result.applied = true;
          }
          results.push(result);
          continue;
        }
        if (ov.kind === "storehouse" && ov.id) {
          const match = storehouseById.get(ov.id);
          if (!match) {
            results.push({ ...base, destination: "conflict", message: "Selected Storehouse no longer exists." });
            continue;
          }
          const contact = contactById.get(match.contact_id);
          const result: RowResult = {
            ...base, destination: "storehouse_update",
            matched_table: "storehouses", matched_id: match.id,
            matched_contact_id: match.contact_id, matched_contact_name: contactName(contact),
          };
          if (mode === "commit") {
            const updates: Record<string, unknown> = {};
            if (current !== null) updates.current_value = current;
            if (boy !== null) updates.book_value = boy;
            if (Object.keys(updates).length) {
              const { error } = await admin.from("storehouses").update(updates).eq("id", match.id);
              if (error) { result.message = `Update failed: ${error.message}`; results.push(result); continue; }
            }
            const snapErr = await writeSnapshot(match.contact_id, "storehouse_id", match.id, row, snapshotDate, boy, current);
            if (snapErr) { result.message = `Snapshot failed: ${snapErr.message}`; results.push(result); continue; }
            result.applied = true;
          }
          results.push(result);
          continue;
        }
        if (ov.kind === "holding_tank_new" && ov.contact_id) {
          const contact = contactById.get(ov.contact_id);
          if (!contact) {
            results.push({ ...base, destination: "missing_contact", message: "Selected contact not found." });
            continue;
          }
          const result: RowResult = {
            ...base, destination: "holding_tank_new",
            matched_contact_id: contact.id, matched_contact_name: contactName(contact),
          };
          if (mode === "commit") {
            let holdingId: string | null = null;
            const existingHolding = await findExistingHoldingTank(contact.id, row.account_number);
            if (existingHolding) {
              holdingId = existingHolding.id;
              const updates: Record<string, unknown> = {};
              if (current !== null) updates.current_value = current;
              if (boy !== null) updates.book_value = boy;
              if (row.custodian) updates.custodian = row.custodian;
              if (row.account_type || row.product) updates.account_type = row.account_type || row.product;
              if (Object.keys(updates).length) {
                const { error } = await admin.from("holding_tank").update(updates).eq("id", holdingId);
                if (error) { result.message = `Update failed: ${error.message}`; results.push(result); continue; }
              }
            } else {
              const insert = {
                contact_id: contact.id,
                household_id: contact.household_id || null,
                account_name: row.client_name ? `${row.client_name} — ${row.account_number || "new"}` : `Account ${row.account_number || "new"}`,
                account_number: row.account_number || null,
                account_type: row.account_type || row.product || "Portfolio",
                custodian: row.custodian || null,
                current_value: current,
                book_value: boy,
                status: "holding",
                source_file: sourceFile,
                notes: "Auto-staged via Quarterly Review — needs review.",
              };
              const { data: inserted, error } = await admin.from("holding_tank").insert(insert).select("id").single();
              if (error || !inserted) { result.message = `Insert failed: ${error?.message}`; results.push(result); continue; }
              holdingId = inserted.id;
            }
            result.matched_id = holdingId;
            result.matched_table = "holding_tank";
            const snapErr = await writeSnapshot(contact.id, "holding_tank_id", holdingId, row, snapshotDate, boy, current);
            if (snapErr) { result.message = `Snapshot failed: ${snapErr.message}`; results.push(result); continue; }
            result.applied = true;
          }
          results.push(result);
          continue;
        }
        // Override without enough info — fall through to auto-match
      }

      // 2. Auto-match by account number
      if (!acctNum) {
        results.push({ ...base, destination: "missing_account_number", message: "Account number is required." });
        continue;
      }

      const vineyardHits = vineyardByNum.get(acctNum) || [];
      const holdingHits = holdingByNum.get(acctNum) || [];

      if (vineyardHits.length + holdingHits.length > 1) {
        results.push({
          ...base,
          destination: "conflict",
          message: `Account # matches ${vineyardHits.length} Vineyard and ${holdingHits.length} Holding Tank rows. Resolve manually.`,
        });
        continue;
      }

      if (vineyardHits.length === 1) {
        const match = vineyardHits[0];
        const contact = contactById.get(match.contact_id);
        const result: RowResult = {
          ...base, destination: "vineyard_update",
          matched_table: "vineyard_accounts", matched_id: match.id,
          matched_contact_id: match.contact_id, matched_contact_name: contactName(contact),
        };
        if (mode === "commit") {
          const updates: Record<string, unknown> = {};
          if (current !== null) updates.current_value = current;
          if (boy !== null) updates.book_value = boy;
          if (row.account_type && row.account_type !== match.account_type) updates.account_type = row.account_type;
          if (Object.keys(updates).length) {
            const { error } = await admin.from("vineyard_accounts").update(updates).eq("id", match.id);
            if (error) { result.message = `Update failed: ${error.message}`; results.push(result); continue; }
          }
          const snapErr = await writeSnapshot(match.contact_id, "vineyard_account_id", match.id, row, snapshotDate, boy, current);
          if (snapErr) { result.message = `Snapshot failed: ${snapErr.message}`; results.push(result); continue; }
          result.applied = true;
        }
        results.push(result);
        continue;
      }

      if (holdingHits.length === 1) {
        const match = holdingHits[0];
        const contact = contactById.get(match.contact_id);
        const result: RowResult = {
          ...base, destination: "holding_tank_update",
          matched_table: "holding_tank", matched_id: match.id,
          matched_contact_id: match.contact_id, matched_contact_name: contactName(contact),
        };
        if (mode === "commit") {
          const updates: Record<string, unknown> = {};
          if (current !== null) updates.current_value = current;
          if (boy !== null) updates.book_value = boy;
          if (row.custodian && row.custodian !== match.custodian) updates.custodian = row.custodian;
          if (row.account_type && row.account_type !== match.account_type) updates.account_type = row.account_type;
          if (Object.keys(updates).length) {
            const { error } = await admin.from("holding_tank").update(updates).eq("id", match.id);
            if (error) { result.message = `Update failed: ${error.message}`; results.push(result); continue; }
          }
          const snapErr = await writeSnapshot(match.contact_id, "holding_tank_id", match.id, row, snapshotDate, boy, current);
          if (snapErr) { result.message = `Snapshot failed: ${snapErr.message}`; results.push(result); continue; }
          result.applied = true;
        }
        results.push(result);
        continue;
      }

      // 3. Fuzzy contact match — stage in Holding Tank
      const contact = findContact(row.client_name);
      if (!contact) {
        results.push({
          ...base, destination: "missing_contact",
          message: "No matching account or contact. Pick a contact below, or create one first.",
        });
        continue;
      }

      const result: RowResult = {
        ...base, destination: "holding_tank_new",
        matched_contact_id: contact.id, matched_contact_name: contactName(contact),
      };

      if (mode === "commit") {
        let holdingId: string | null = null;
        const existingHolding = await findExistingHoldingTank(contact.id, row.account_number);
        if (existingHolding) {
          holdingId = existingHolding.id;
          const updates: Record<string, unknown> = {};
          if (current !== null) updates.current_value = current;
          if (boy !== null) updates.book_value = boy;
          if (row.custodian) updates.custodian = row.custodian;
          if (row.account_type || row.product) updates.account_type = row.account_type || row.product;
          if (Object.keys(updates).length) {
            const { error } = await admin.from("holding_tank").update(updates).eq("id", holdingId);
            if (error) { result.message = `Update failed: ${error.message}`; results.push(result); continue; }
          }
        } else {
          const insert = {
            contact_id: contact.id,
            household_id: contact.household_id || null,
            account_name: row.client_name ? `${row.client_name} — ${row.account_number}` : `Account ${row.account_number}`,
            account_number: row.account_number,
            account_type: row.account_type || row.product || "Portfolio",
            custodian: row.custodian || null,
            current_value: current,
            book_value: boy,
            status: "holding",
            source_file: sourceFile,
            notes: "Auto-staged via Quarterly Review — needs review.",
          };
          const { data: inserted, error } = await admin.from("holding_tank").insert(insert).select("id").single();
          if (error || !inserted) { result.message = `Insert failed: ${error?.message}`; results.push(result); continue; }
          holdingId = inserted.id;
        }
        result.matched_id = holdingId;
        result.matched_table = "holding_tank";
        const snapErr = await writeSnapshot(contact.id, "holding_tank_id", holdingId, row, snapshotDate, boy, current);
        if (snapErr) { result.message = `Snapshot failed: ${snapErr.message}`; results.push(result); continue; }
        result.applied = true;
      }
      results.push(result);
    }

    const tally = (d: Destination) => results.filter((r) => r.destination === d).length;
    const summary = {
      total: results.length,
      vineyard_update: tally("vineyard_update"),
      holding_tank_update: tally("holding_tank_update"),
      storehouse_update: tally("storehouse_update"),
      holding_tank_new: tally("holding_tank_new"),
      conflict: tally("conflict"),
      missing_account_number: tally("missing_account_number"),
      missing_contact: tally("missing_contact"),
      skipped: tally("skipped"),
      applied: results.filter((r) => r.applied).length,
    };

    return new Response(JSON.stringify({ mode, summary, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[quarterly-account-sync]", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
