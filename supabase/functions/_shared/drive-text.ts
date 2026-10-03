// Drive fetch + text extraction, for opt-in vault-file indexing into the
// Second Brain. Adapted from drive-watch/index.ts (same Drive download /
// PDF-via-Gemini extraction approach) rather than importing it directly, so
// the already-live Drive sync in drive-watch is never at risk from changes
// made here.

import { getGcpAccessToken, parseServiceAccountKey, vertexModelUrl, type ServiceAccountKey, GEMINI_FLASH_MODEL, withThinking } from "./vertex-ai.ts";

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const PDF_MODEL = GEMINI_FLASH_MODEL;
const PDF_INLINE_MAX_BYTES = 18 * 1024 * 1024; // ~18 MB safe for inline base64

export type TokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; reason: "no_token" | "refresh_failed"; detail?: string };

/** Single staff-connected Google account used for all Drive access (same source as drive-watch). */
// deno-lint-ignore no-explicit-any
export async function getValidGoogleToken(supabaseAdmin: any): Promise<TokenResult> {
  const { data, error } = await supabaseAdmin.from("google_tokens").select("*").limit(1).maybeSingle();
  if (error || !data) return { ok: false, reason: "no_token" };

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
    if (tokens.error) {
      if (tokens.error === "invalid_grant") {
        await supabaseAdmin.from("google_tokens").delete().eq("user_id", data.user_id);
      }
      return { ok: false, reason: "refresh_failed", detail: tokens.error_description || tokens.error };
    }
    await supabaseAdmin
      .from("google_tokens")
      .update({
        access_token: tokens.access_token,
        token_expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      })
      .eq("user_id", data.user_id);
    return { ok: true, accessToken: tokens.access_token };
  }
  return { ok: true, accessToken: data.access_token };
}

export async function downloadDriveFile(accessToken: string, fileId: string, mimeType?: string): Promise<Blob> {
  const isGoogleDoc = mimeType?.startsWith("application/vnd.google-apps");
  const url = isGoogleDoc
    ? `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`
    : `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to download Drive file [${res.status}]: ${text.slice(0, 300)}`);
  }
  return res.blob();
}

function blobToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** Downloads and extracts plain text from a Drive file. PDFs are extracted via Gemini; everything else is read as text. */
export async function extractTextFromDriveFile(
  accessToken: string,
  fileId: string,
  mimeType: string | undefined,
  fileName: string | undefined,
  maxChars: number,
): Promise<string> {
  const blob = await downloadDriveFile(accessToken, fileId, mimeType);
  const type = mimeType || blob.type || "application/octet-stream";
  if (type.includes("pdf")) {
    const sa = await parseServiceAccountKey(Deno.env.get("GCP_SERVICE_ACCOUNT_KEY"));
    const text = await extractPdfTextInline(sa, blob, fileName);
    return text.slice(0, maxChars);
  }
  return (await blob.text()).slice(0, maxChars);
}

async function extractPdfTextInline(sa: ServiceAccountKey, blob: Blob, fileName?: string): Promise<string> {
  const buffer = await blob.arrayBuffer();
  if (buffer.byteLength > PDF_INLINE_MAX_BYTES) {
    throw new Error(`${fileName || "PDF"} is too large to extract inline (${Math.round(buffer.byteLength / 1024 / 1024)} MB).`);
  }
  const base64 = blobToBase64(buffer);
  const prompt = `Extract the full readable text from this PDF document titled "${fileName || "source document"}". Preserve headings, lists, and paragraph structure using plain text formatting. Do not summarize, do not add commentary, and do not wrap the output in code fences. Return only the extracted text.`;

  const accessToken = await getGcpAccessToken(sa);
  const res = await fetch(vertexModelUrl(sa.project_id, PDF_MODEL), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      contents: [
        { role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: "application/pdf", data: base64 } }] },
      ],
      generationConfig: withThinking(PDF_MODEL, { temperature: 0.1, maxOutputTokens: 8192 }, "minimal"),
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`PDF extraction failed: ${errText.slice(0, 500)}`);
  }
  const result = await res.json();
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!text.trim()) throw new Error(`PDF extraction returned no usable text for ${fileName || "source"}.`);
  return text.trim();
}
