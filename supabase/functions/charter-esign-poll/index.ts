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
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-region",
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

const RESOURCES_FOLDER_NAME = "Sovereignty Charter Sources";
const SIGNED_FILENAME_MARKER = "completed-adobe sign"; // case-insensitive substring

async function getValidTokenForUser(supabaseAdmin: any, userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("google_tokens")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  if (new Date(data.token_expiry) <= new Date()) {
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
    await supabaseAdmin
      .from("google_tokens")
      .update({ access_token: tokens.access_token, token_expiry: newExpiry })
      .eq("user_id", userId);
    return tokens.access_token;
  }
  return data.access_token;
}

function extractFolderId(driveUrl: string | null): string | null {
  if (!driveUrl) return null;
  const m = driveUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

async function findChildFolder(
  accessToken: string,
  parentFolderId: string,
  folderName: string,
): Promise<string | null> {
  const safeName = folderName.replace(/'/g, "\\'");
  const q = `'${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and name='${safeName}' and trashed=false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!res.ok) return null;
  return data.files?.[0]?.id || null;
}

async function findSignedPdfInFolder(
  accessToken: string,
  folderId: string,
): Promise<{ id: string; name: string; modifiedTime?: string } | null> {
  const q = `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!res.ok) return null;
  const files: Array<{ id: string; name: string; modifiedTime?: string }> = data.files || [];
  // Match either "(completed-adobe sign)" anywhere or the literal "completed-adobe sign"
  const signed = files.find((f) =>
    f.name.toLowerCase().includes(SIGNED_FILENAME_MARKER),
  );
  return signed || null;
}

async function downloadPdfBytes(accessToken: string, fileId: string): Promise<Uint8Array | null> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    console.error("PDF download failed:", await res.text());
    return null;
  }
  return new Uint8Array(await res.arrayBuffer());
}

async function pollOne(
  supabaseAdmin: any,
  charter: any,
): Promise<{ id: string; status: string; note?: string }> {
  const userId = charter.esign_initiated_by;
  if (!userId) return { id: charter.id, status: "skipped", note: "missing initiator" };

  // Look up contact's Drive folder
  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("id, google_drive_url")
    .eq("id", charter.contact_id)
    .maybeSingle();
  if (!contact?.google_drive_url) {
    return { id: charter.id, status: "skipped", note: "contact has no Drive folder" };
  }
  const rootFolderId = extractFolderId(contact.google_drive_url);
  if (!rootFolderId) {
    return { id: charter.id, status: "skipped", note: "invalid Drive folder URL" };
  }

  const accessToken = await getValidTokenForUser(supabaseAdmin, userId);
  if (!accessToken) {
    return { id: charter.id, status: "skipped", note: "initiator has no valid Google token" };
  }

  const resourcesFolderId = await findChildFolder(accessToken, rootFolderId, RESOURCES_FOLDER_NAME);
  if (!resourcesFolderId) {
    await supabaseAdmin
      .from("sovereignty_charters")
      .update({
        esign_last_checked_at: new Date().toISOString(),
        esign_error: null,
      })
      .eq("id", charter.id);
    return { id: charter.id, status: "pending", note: "Sovereignty Charter Sources folder not found yet" };
  }

  const signed = await findSignedPdfInFolder(accessToken, resourcesFolderId);
  if (!signed) {
    await supabaseAdmin
      .from("sovereignty_charters")
      .update({
        esign_last_checked_at: new Date().toISOString(),
        esign_error: null,
      })
      .eq("id", charter.id);
    return { id: charter.id, status: "pending", note: "no signed PDF detected yet" };
  }

  // Download and store the signed PDF
  let storedPath: string | null = null;
  const pdfBytes = await downloadPdfBytes(accessToken, signed.id);
  if (pdfBytes) {
    const path = `signed-charters/${charter.contact_id}/${charter.id}-${Date.now()}.pdf`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("charter-source-uploads")
      .upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (!upErr) storedPath = path;
    else console.error("PDF upload failed:", upErr);
  }

  const signedAt = new Date().toISOString();
  // Mark as 'signed' and queue for advisor ratification review (HITL gate).
  await supabaseAdmin
    .from("sovereignty_charters")
    .update({
      esign_status: "signed",
      esign_signed_at: signedAt,
      esign_signed_pdf_path: storedPath,
      esign_doc_id: signed.id,
      esign_doc_url: `https://drive.google.com/file/d/${signed.id}/view`,
      esign_last_checked_at: signedAt,
      esign_error: null,
      draft_status: "signed",
      footer_status: "Signed — awaiting advisor ratification",
    })
    .eq("id", charter.id);

  // Link in contact charter_url if not set
  await supabaseAdmin
    .from("contacts")
    .update({ charter_url: `/sovereignty-charter/contact/${charter.contact_id}` })
    .eq("id", charter.contact_id);

  return { id: charter.id, status: "signed", note: signed.name };
}


serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let charterId: string | null = null;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body?.charter_id) charterId = String(body.charter_id);
      } catch {
        // no body, treat as cron run
      }
    }

    let query = supabaseAdmin
      .from("sovereignty_charters")
      .select("id, contact_id, esign_initiated_by, esign_status")
      .eq("esign_status", "sent")
      .limit(50);

    if (charterId) {
      query = supabaseAdmin
        .from("sovereignty_charters")
        .select("id, contact_id, esign_initiated_by, esign_status")
        .eq("id", charterId);
    }

    const { data: charters, error } = await query;
    if (error) throw new Error(error.message);

    const results = [];
    for (const c of charters || []) {
      try {
        results.push(await pollOne(supabaseAdmin, c));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`pollOne failed for ${c.id}:`, msg);
        results.push({ id: c.id, status: "error", note: msg });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, checked: results.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("charter-esign-poll error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
