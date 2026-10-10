import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.25.76";
import { getServiceGoogleAccessToken } from "../_shared/google-token.ts";

const ALLOWED_ORIGINS = [
  "https://prosperwise-portal.web.app",
  "https://prosperwise.lovable.app",
  "https://app.prosperwise.ca",
  "https://id-preview--339dfc8f-3e82-4b05-8a36-a9f66fc58449.lovable.app",
];

const GATEWAY_URL = "https://sheets.googleapis.com/v4";
const PAGE_SIZE = 1000;

const BodySchema = z.object({
  action: z.literal("sync").optional().default("sync"),
});

type SessionStartRow = {
  session_key: string;
  source: string;
  landing_path: string | null;
  referrer: string | null;
  user_agent: string | null;
  started_at: string;
  ended_at: string | null;
  last_activity_at: string | null;
  message_count: number | null;
  reached_lead_capture: boolean | null;
  lead_captured: boolean | null;
  final_phase: string | null;
};

type LeadRow = {
  id: string;
  first_name: string;
  email: string | null;
  transition_type: string | null;
  sovereignty_status: string;
  created_at: string;
};

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-region",
  };
}

function isAuthorized(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  const apikeyHeader = req.headers.get("apikey") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  return authHeader === `Bearer ${anonKey}`
    || authHeader === `Bearer ${publishableKey}`
    || authHeader === `Bearer ${serviceKey}`
    || apikeyHeader === anonKey
    || apikeyHeader === publishableKey
    || apikeyHeader === serviceKey;
}

function sheetRange(title: string, range: string) {
  const escaped = title.replace(/'/g, "''");
  return `'${escaped}'!${range}`;
}

function toDateKey(value: string) {
  return value.slice(0, 10);
}

async function gatewayFetch(accessToken: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`${GATEWAY_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google Sheets gateway call failed [${response.status}]: ${body}`);
  }

  if (response.status === 204) return null;
  return await response.json();
}

async function fetchAllRows<T>(queryFactory: (from: number, to: number) => any): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await queryFactory(from, to);
    if (error) throw error;
    const batch = (data || []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

function buildSummaryRows(starts: SessionStartRow[], leads: LeadRow[]) {
  const perDay = new Map<string, { starts: number; leads: number }>();

  for (const row of starts) {
    const key = toDateKey(row.started_at);
    const current = perDay.get(key) || { starts: 0, leads: 0 };
    current.starts += 1;
    perDay.set(key, current);
  }

  for (const row of leads) {
    const key = toDateKey(row.created_at);
    const current = perDay.get(key) || { starts: 0, leads: 0 };
    current.leads += 1;
    perDay.set(key, current);
  }

  const rows = [["Date", "Session Starts", "Lead Submissions", "Conversion Rate"]];
  for (const key of Array.from(perDay.keys()).sort()) {
    const current = perDay.get(key)!;
    rows.push([key, current.starts, current.leads, current.starts > 0 ? current.leads / current.starts : 0]);
  }
  return rows;
}

function buildTrafficRows(starts: SessionStartRow[]) {
  const rows: (string | number | boolean)[][] = [[
    "Started At", "Date", "Session Key", "Source", "Landing Path", "Referrer", "User Agent",
    "Last Activity", "Ended At", "Message Count", "Reached Lead Form", "Lead Captured", "Final Phase",
  ]];
  for (const row of starts) {
    rows.push([
      row.started_at,
      toDateKey(row.started_at),
      row.session_key,
      row.source,
      row.landing_path || "",
      row.referrer || "",
      row.user_agent || "",
      row.last_activity_at || "",
      row.ended_at || "",
      row.message_count ?? 0,
      row.reached_lead_capture ?? false,
      row.lead_captured ?? false,
      row.final_phase || "",
    ]);
  }
  return rows;
}

function buildAbandonedRows(starts: SessionStartRow[]) {
  const rows: (string | number | boolean)[][] = [[
    "Started At", "Date", "Session Key", "Referrer",
    "Last Activity", "Ended At", "Message Count", "Reached Lead Form", "Final Phase",
  ]];
  const abandoned = starts.filter((row) => !row.lead_captured);
  for (const row of abandoned) {
    rows.push([
      row.started_at,
      toDateKey(row.started_at),
      row.session_key,
      row.referrer || "",
      row.last_activity_at || "",
      row.ended_at || "",
      row.message_count ?? 0,
      row.reached_lead_capture ?? false,
      row.final_phase || "",
    ]);
  }
  return rows;
}

async function ensureSheets(accessToken: string, spreadsheetId: string, titles: string[]) {
  const metadata = await gatewayFetch(accessToken, `/spreadsheets/${spreadsheetId}`) as { sheets?: Array<{ properties?: { title?: string } }> };
  const existing = new Set((metadata.sheets || []).map((sheet) => sheet.properties?.title).filter(Boolean));
  const missing = titles.filter((title) => !existing.has(title));

  if (missing.length === 0) return;

  await gatewayFetch(accessToken, `/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
    }),
  });
}

async function writeSheetData(
  accessToken: string,
  spreadsheetId: string,
  summaryTitle: string,
  trafficTitle: string,
  abandonedTitle: string,
  summaryRows: (string | number)[][],
  trafficRows: (string | number | boolean)[][],
  abandonedRows: (string | number | boolean)[][],
) {
  await gatewayFetch(accessToken, `/spreadsheets/${spreadsheetId}/values:batchClear`, {
    method: "POST",
    body: JSON.stringify({
      ranges: [
        sheetRange(summaryTitle, "A:Z"),
        sheetRange(trafficTitle, "A:Z"),
        sheetRange(abandonedTitle, "A:Z"),
      ],
    }),
  });

  await gatewayFetch(accessToken, `/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data: [
        { range: sheetRange(summaryTitle, "A1"), majorDimension: "ROWS", values: summaryRows },
        { range: sheetRange(trafficTitle, "A1"), majorDimension: "ROWS", values: trafficRows },
        { range: sheetRange(abandonedTitle, "A1"), majorDimension: "ROWS", values: abandonedRows },
      ],
    }),
  });
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!isAuthorized(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten().formErrors[0] || "Invalid request" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl) throw new Error("SUPABASE_URL is not configured");

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: config, error: configError } = await supabase
      .from("georgia_analytics_sync_configs")
      .select("id, spreadsheet_id, worksheet_summary_name, worksheet_traffic_name, worksheet_abandoned_name")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (configError) throw configError;
    if (!config) throw new Error("No active Georgia analytics sync configuration found");

    const abandonedTitle = (config as any).worksheet_abandoned_name || "Abandoned Sessions";

    const starts = await fetchAllRows<SessionStartRow>((from, to) =>
      supabase
        .from("georgia_session_starts")
        .select("session_key, source, landing_path, referrer, user_agent, started_at, ended_at, last_activity_at, message_count, reached_lead_capture, lead_captured, final_phase")
        .order("started_at", { ascending: true })
        .range(from, to)
    );

    const leads = await fetchAllRows<LeadRow>((from, to) =>
      supabase
        .from("discovery_leads")
        .select("id, first_name, email, transition_type, sovereignty_status, created_at")
        .order("created_at", { ascending: true })
        .range(from, to)
    );

    const summaryRows = buildSummaryRows(starts, leads);
    const trafficRows = buildTrafficRows(starts);
    const abandonedRows = buildAbandonedRows(starts);

    const accessToken = await getServiceGoogleAccessToken(supabase);

    await ensureSheets(accessToken, config.spreadsheet_id, [config.worksheet_summary_name, config.worksheet_traffic_name, abandonedTitle]);
    await writeSheetData(
      accessToken,
      config.spreadsheet_id,
      config.worksheet_summary_name,
      config.worksheet_traffic_name,
      abandonedTitle,
      summaryRows,
      trafficRows,
      abandonedRows,
    );

    const syncedAt = new Date().toISOString();
    await supabase
      .from("georgia_analytics_sync_configs")
      .update({ last_synced_at: syncedAt, last_run_status: "success", last_error: null })
      .eq("id", config.id);

    return new Response(JSON.stringify({
      success: true,
      syncedAt,
      summaryRows: Math.max(summaryRows.length - 1, 0),
      trafficRows: Math.max(trafficRows.length - 1, 0),
      abandonedRows: Math.max(abandonedRows.length - 1, 0),
      spreadsheetId: config.spreadsheet_id,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseUrl && serviceRoleKey) {
      const supabase = createClient(supabaseUrl, serviceRoleKey);
      await supabase
        .from("georgia_analytics_sync_configs")
        .update({ last_run_status: "error", last_error: error instanceof Error ? error.message : "Unknown error" })
        .eq("is_active", true);
    }

    console.error("georgia-analytics-sync error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});