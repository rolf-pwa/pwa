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
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

const RESOURCES_FOLDER_NAME = "Resources";
const REQUIRED_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

class InsufficientScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientScopeError";
  }
}

function isScopePermissionError(status: number, message: string) {
  if (status !== 401 && status !== 403) return false;
  return /(insufficient authentication scopes?|access token scope insufficient|insufficientpermissions|request had insufficient authentication scopes)/i.test(
    message,
  );
}

async function getValidToken(supabaseAdmin: any, userId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("google_tokens")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) {
    throw new InsufficientScopeError(
      "Google not connected. Please reconnect with Drive access in Settings → Google.",
    );
  }
  const grantedScopes: string[] = Array.isArray(data.scopes) ? data.scopes : [];
  const hasDrive =
    grantedScopes.includes(REQUIRED_DRIVE_SCOPE) ||
    grantedScopes.includes("https://www.googleapis.com/auth/drive.file");
  if (!hasDrive) {
    throw new InsufficientScopeError(
      "Your Google connection is missing Drive permissions. Please go to Settings → Google, disconnect, and reconnect.",
    );
  }
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
    if (tokens.error) throw new Error(`Token refresh failed: ${tokens.error}`);
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

async function findOrCreateChildFolder(
  accessToken: string,
  parentFolderId: string,
  folderName: string,
): Promise<string> {
  // Look up existing
  const safeName = folderName.replace(/'/g, "\\'");
  const q = `'${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and name='${safeName}' and trashed=false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!res.ok) {
    const msg = data.error?.message || `Drive folder lookup failed [${res.status}]`;
    if (isScopePermissionError(res.status, msg)) {
      throw new InsufficientScopeError(
        "Your Google connection is missing Drive permissions. Please reconnect Google in Settings.",
      );
    }
    throw new Error(msg);
  }
  if (data.files && data.files.length > 0) return data.files[0].id;

  // Create folder
  const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentFolderId],
    }),
  });
  const created = await createRes.json();
  if (!createRes.ok) {
    const msg = created.error?.message || `Failed to create folder [${createRes.status}]`;
    if (isScopePermissionError(createRes.status, msg)) {
      throw new InsufficientScopeError(
        "Your Google connection is missing Drive permissions. Please reconnect Google in Settings.",
      );
    }
    throw new Error(msg);
  }
  return created.id;
}

async function uploadPdfToDrive(
  accessToken: string,
  parentFolderId: string,
  fileName: string,
  pdfBytes: Uint8Array,
): Promise<{ id: string; webViewLink: string }> {
  const boundary = "lovable_charter_boundary_" + crypto.randomUUID();
  const metadata = {
    name: fileName,
    mimeType: "application/pdf",
    parents: [parentFolderId],
  };

  // Build multipart body manually using bytes
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) +
      `\r\n--${boundary}\r\n` +
      `Content-Type: application/pdf\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.byteLength + pdfBytes.byteLength + tail.byteLength);
  body.set(head, 0);
  body.set(pdfBytes, head.byteLength);
  body.set(tail, head.byteLength + pdfBytes.byteLength);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  const json = await res.json();
  if (!res.ok) {
    const msg = json.error?.message || `Drive upload failed [${res.status}]`;
    if (isScopePermissionError(res.status, msg)) {
      throw new InsufficientScopeError(
        "Your Google connection is missing Drive permissions. Please reconnect Google in Settings.",
      );
    }
    throw new Error(`Drive upload rejected [${res.status}]: ${msg}`);
  }
  return {
    id: json.id,
    webViewLink: json.webViewLink || `https://drive.google.com/file/d/${json.id}/view`,
  };
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/^data:application\/pdf;base64,/, "").replace(/\s/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { charter_id, pdf_base64 } = body || {};
    if (!charter_id || typeof charter_id !== "string") {
      return new Response(JSON.stringify({ error: "charter_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!pdf_base64 || typeof pdf_base64 !== "string") {
      return new Response(JSON.stringify({ error: "pdf_base64 required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: charter, error: charterErr } = await supabaseAdmin
      .from("sovereignty_charters")
      .select("id, contact_id, title")
      .eq("id", charter_id)
      .maybeSingle();
    if (charterErr || !charter) throw new Error(charterErr?.message || "Charter not found");

    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("id, first_name, last_name, full_name, google_drive_url")
      .eq("id", charter.contact_id)
      .maybeSingle();
    if (!contact) throw new Error("Contact not found");
    if (!contact.google_drive_url) {
      throw new Error(
        "This contact has no Google Drive folder linked. Add a Drive folder URL on the contact before sending for signature.",
      );
    }

    const rootFolderId = extractFolderId(contact.google_drive_url);
    if (!rootFolderId) throw new Error("Invalid Google Drive folder URL on contact");

    const accessToken = await getValidToken(supabaseAdmin, user.id);

    // Locate or create the Resources subfolder
    const resourcesFolderId = await findOrCreateChildFolder(
      accessToken,
      rootFolderId,
      RESOURCES_FOLDER_NAME,
    );

    // Build filename
    const fullName =
      [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
      contact.full_name ||
      "Sovereign";
    const safeName = fullName.replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "Sovereign";
    const today = new Date().toISOString().split("T")[0];
    const fileName = `Sovereignty Charter — ${safeName} — ${today}.pdf`;

    const pdfBytes = decodeBase64ToBytes(pdf_base64);

    const uploaded = await uploadPdfToDrive(accessToken, resourcesFolderId, fileName, pdfBytes);

    // Update charter row
    const sentAt = new Date().toISOString();
    await supabaseAdmin
      .from("sovereignty_charters")
      .update({
        esign_status: "sent",
        esign_doc_id: uploaded.id,
        esign_doc_url: uploaded.webViewLink,
        esign_sent_at: sentAt,
        esign_initiated_by: user.id,
        esign_error: null,
      })
      .eq("id", charter_id);

    return new Response(
      JSON.stringify({
        ok: true,
        file_id: uploaded.id,
        file_url: uploaded.webViewLink,
        folder_name: RESOURCES_FOLDER_NAME,
        instructions:
          "PDF uploaded to the Resources folder. Open it in Drive, send via Adobe Sign, then save the signed copy back to the same folder with '(Completed-Adobe Sign)' in the filename. The charter will auto-ratify once detected.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("charter-esign-create error:", e);
    const isScopeErr = e instanceof InsufficientScopeError;
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
        code: isScopeErr ? "reconnect_google" : "unknown",
      }),
      {
        status: isScopeErr ? 412 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
