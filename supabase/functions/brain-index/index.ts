// brain-index — writes and (re-)embeds Second Brain documents.
// Actions: indexDocument, drain, syncKnowledgeBase, syncRecaps, indexVaultFile.
// Staff-auth'd like every other AI function here (verify_jwt=false at the
// gateway, manual check inside); `drain` additionally accepts a shared
// secret so it can be invoked by a scheduler with no user session.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { embedTexts, parseServiceAccountKey } from "../_shared/vertex-ai.ts";
import { chunkText, hashText } from "../_shared/brain-text.ts";
import { extractTextFromDriveFile, getValidGoogleToken } from "../_shared/drive-text.ts";

const VAULT_TEXT_LIMIT = 20000; // matches CHARTER_TEXT_LIMIT in drive-watch

const ALLOWED_ORIGINS = [
  "https://prosperwise-portal.web.app",
  "https://prosperwise.lovable.app",
  "https://app.prosperwise.ca",
  "https://id-preview--339dfc8f-3e82-4b05-8a36-a9f66fc58449.lovable.app",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowed =
    ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".lovable.app") || origin.endsWith(".lovableproject.com")
      ? origin
      : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-brain-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-region",
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const CRON_SECRET = Deno.env.get("BRAIN_CRON_SECRET");
const DRAIN_LIMIT = 15;
const DRAIN_STALE_SECONDS = 30;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

/** Staff-auth check shared by every interactive action. Returns the user id, or null if unauthorized. */
async function requireStaff(req: Request): Promise<{ userId: string } | null> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return null;
  const supabaseUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await supabaseUser.auth.getUser();
  if (error || !data?.user) return null;
  if (!data.user.email?.toLowerCase().endsWith("@prosperwise.ca")) return null;
  return { userId: data.user.id };
}

function isCronCaller(req: Request): boolean {
  if (!CRON_SECRET) return false;
  return req.headers.get("x-brain-cron-secret") === CRON_SECRET;
}

/** Chunks, embeds, and stores a single brain_documents row. Idempotent via content_hash. */
async function indexDocument(documentId: string): Promise<{ status: string; chunkCount: number }> {
  const db = admin();
  const { data: doc, error } = await db
    .from("brain_documents")
    .select("id, body, is_active")
    .eq("id", documentId)
    .maybeSingle();
  if (error || !doc) throw new Error(`Document ${documentId} not found.`);

  const body = String(doc.body || "").trim();
  if (!body || !doc.is_active) {
    await db
      .from("brain_documents")
      .update({ index_status: "skipped", chunk_count: 0, indexed_at: new Date().toISOString() })
      .eq("id", documentId);
    return { status: "skipped", chunkCount: 0 };
  }

  await db.from("brain_documents").update({ index_status: "processing" }).eq("id", documentId);

  try {
    const hash = await hashText(body);
    const { data: current } = await db
      .from("brain_documents")
      .select("content_hash, chunk_count")
      .eq("id", documentId)
      .maybeSingle();

    if (current?.content_hash === hash && (current?.chunk_count || 0) > 0) {
      await db
        .from("brain_documents")
        .update({ index_status: "ready", indexed_at: new Date().toISOString() })
        .eq("id", documentId);
      return { status: "ready", chunkCount: current.chunk_count };
    }

    const chunks = chunkText(body);
    if (!chunks.length) {
      await db
        .from("brain_documents")
        .update({ index_status: "skipped", chunk_count: 0, indexed_at: new Date().toISOString() })
        .eq("id", documentId);
      return { status: "skipped", chunkCount: 0 };
    }

    const sa = await parseServiceAccountKey(Deno.env.get("GCP_SERVICE_ACCOUNT_KEY"));
    const embeddings = await embedTexts(
      sa,
      chunks.map((c) => ({ title: c.heading ?? undefined, content: c.content })),
      "RETRIEVAL_DOCUMENT",
    );

    await db.from("brain_chunks").delete().eq("document_id", documentId);
    const rows = chunks.map((c, i) => ({
      document_id: documentId,
      chunk_index: c.chunkIndex,
      content: c.content,
      heading: c.heading,
      token_estimate: Math.ceil(c.content.length / 4),
      embedding: embeddings[i],
    }));
    const { error: insertErr } = await db.from("brain_chunks").insert(rows);
    if (insertErr) throw new Error(insertErr.message);

    await db
      .from("brain_documents")
      .update({
        index_status: "ready",
        index_error: null,
        content_hash: hash,
        chunk_count: rows.length,
        indexed_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    return { status: "ready", chunkCount: rows.length };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.from("brain_documents").update({ index_status: "error", index_error: message.slice(0, 500) }).eq(
      "id",
      documentId,
    );
    throw e;
  }
}

/** Processes a batch of pending/error documents. Safe to call repeatedly (e.g. from pg_cron). */
async function drain(): Promise<{ processed: number; results: Array<{ id: string; status: string }> }> {
  const db = admin();
  const staleBefore = new Date(Date.now() - DRAIN_STALE_SECONDS * 1000).toISOString();
  const { data: pending, error } = await db
    .from("brain_documents")
    .select("id")
    .in("index_status", ["pending", "error"])
    .lt("updated_at", staleBefore)
    .order("created_at", { ascending: true })
    .limit(DRAIN_LIMIT);
  if (error) throw new Error(error.message);

  const results: Array<{ id: string; status: string }> = [];
  for (const row of pending || []) {
    try {
      const { status } = await indexDocument(row.id);
      results.push({ id: row.id, status });
    } catch (e) {
      results.push({ id: row.id, status: "error" });
      console.error(`[brain-index] drain failed for ${row.id}:`, e);
    }
  }
  return { processed: results.length, results };
}

/** One-way sync from the hand-curated knowledge_base admin table into the brain. */
async function syncKnowledgeBase(): Promise<{ synced: number }> {
  const db = admin();
  const { data: entries, error } = await db
    .from("knowledge_base")
    .select("id, title, content, category, updated_at")
    .eq("is_active", true);
  if (error) throw new Error(error.message);

  let synced = 0;
  for (const entry of entries || []) {
    if (!entry.content) continue;
    const { error: upsertErr } = await db
      .from("brain_documents")
      .upsert(
        {
          title: entry.title,
          body: entry.content,
          doc_type: "kb_entry",
          source_system: "knowledge_base",
          source_table: "knowledge_base",
          source_record_id: entry.id,
          tags: entry.category ? [entry.category] : [],
          occurred_at: entry.updated_at,
          index_status: "pending",
        },
        { onConflict: "source_system,source_record_id" },
      );
    if (!upsertErr) synced++;
  }
  return { synced };
}

/** One-way sync from daily_recaps — highest-signal existing staff narrative data. */
async function syncRecaps(): Promise<{ synced: number }> {
  const db = admin();
  const { data: recaps, error } = await db
    .from("daily_recaps")
    .select("id, recap_date, body, ai_draft, author_id, updated_at");
  if (error) throw new Error(error.message);

  let synced = 0;
  for (const recap of recaps || []) {
    const body = recap.body || recap.ai_draft;
    if (!body) continue;
    const { error: upsertErr } = await db
      .from("brain_documents")
      .upsert(
        {
          title: `Daily recap — ${recap.recap_date}`,
          body,
          doc_type: "recap",
          source_system: "daily_recap",
          source_table: "daily_recaps",
          source_record_id: recap.id,
          occurred_at: recap.recap_date,
          created_by: recap.author_id,
          index_status: "pending",
        },
        { onConflict: "source_system,source_record_id" },
      );
    if (!upsertErr) synced++;
  }
  return { synced };
}

/**
 * Opt-in, per-file vault ingestion: fetch a Drive file's text, store it as a
 * brain_documents row keyed on external_id (Drive file ids aren't UUIDs), and
 * link it to whichever contact/household it belongs to. Deliberately not a
 * bulk sync — each call indexes exactly one file the staff member chose.
 */
async function indexVaultFile(input: {
  driveId: string;
  name: string;
  mimeType?: string;
  contactId?: string;
  householdId?: string;
}): Promise<{ status: string; chunkCount: number; documentId: string }> {
  const db = admin();

  const tokenResult = await getValidGoogleToken(db);
  if (!tokenResult.ok) {
    throw new Error(
      tokenResult.reason === "no_token"
        ? "No Google account is connected — connect Drive access before indexing vault files."
        : `Google Drive token refresh failed: ${tokenResult.detail || tokenResult.reason}`,
    );
  }

  const text = await extractTextFromDriveFile(
    tokenResult.accessToken,
    input.driveId,
    input.mimeType,
    input.name,
    VAULT_TEXT_LIMIT,
  );

  const { data: doc, error: upsertErr } = await db
    .from("brain_documents")
    .upsert(
      {
        title: input.name,
        body: text,
        doc_type: "vault_file",
        source_system: "vault",
        source_table: "vault_files",
        external_id: input.driveId,
        file_name: input.name,
        mime_type: input.mimeType || null,
        index_status: "pending",
      },
      { onConflict: "source_system,external_id" },
    )
    .select("id")
    .single();
  if (upsertErr || !doc) throw new Error(upsertErr?.message || "Could not save vault document.");

  if (input.contactId) {
    await db
      .from("brain_entity_links")
      .upsert(
        { document_id: doc.id, entity_type: "contact", entity_id: input.contactId, link_source: "manual" },
        { onConflict: "document_id,entity_type,entity_id" },
      );
  }
  if (input.householdId) {
    await db
      .from("brain_entity_links")
      .upsert(
        { document_id: doc.id, entity_type: "household", entity_id: input.householdId, link_source: "manual" },
        { onConflict: "document_id,entity_type,entity_id" },
      );
  }

  const result = await indexDocument(doc.id);
  return { ...result, documentId: doc.id };
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    // `drain` is the only action a scheduler (no user session) can invoke.
    if (action === "drain" && isCronCaller(req)) {
      const result = await drain();
      return json({ ok: true, ...result });
    }

    const staff = await requireStaff(req);
    if (!staff) return json({ ok: false, error: "Unauthorized" }, 401);

    switch (action) {
      case "indexDocument": {
        const documentId = String(body?.documentId || "");
        if (!documentId) return json({ ok: false, error: "documentId is required" }, 400);
        const result = await indexDocument(documentId);
        return json({ ok: true, ...result });
      }
      case "drain": {
        const result = await drain();
        return json({ ok: true, ...result });
      }
      case "syncKnowledgeBase": {
        const result = await syncKnowledgeBase();
        return json({ ok: true, ...result });
      }
      case "syncRecaps": {
        const result = await syncRecaps();
        return json({ ok: true, ...result });
      }
      case "indexVaultFile": {
        const driveId = String(body?.driveId || "");
        const name = String(body?.name || "");
        if (!driveId || !name) return json({ ok: false, error: "driveId and name are required" }, 400);
        const result = await indexVaultFile({
          driveId,
          name,
          mimeType: body?.mimeType ? String(body.mimeType) : undefined,
          contactId: body?.contactId ? String(body.contactId) : undefined,
          householdId: body?.householdId ? String(body.householdId) : undefined,
        });
        return json({ ok: true, ...result });
      }
      default:
        return json({ ok: false, error: `Unknown action: ${action}` }, 400);
    }
  } catch (e) {
    console.error("brain-index error:", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
