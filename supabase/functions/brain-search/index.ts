// brain-search — staff-facing retrieval over the Second Brain.
// Actions: `search` (ranked chunks, no LLM call — powers the ⌘K palette)
// and `ask` (retrieval + grounded Gemini answer with numbered citations).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateVertexContent, parseServiceAccountKey, GEMINI_FLASH_MODEL, withThinking } from "../_shared/vertex-ai.ts";
import { retrieveBrainContext } from "../_shared/brain-retrieval.ts";

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
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ASK_MODEL = GEMINI_FLASH_MODEL;

const ASK_SYSTEM_PROMPT = `You are the retrieval assistant for ProsperWise's private Second Brain.
Answer ONLY from the "Second Brain Context" provided below — never from general knowledge.
Cite every claim inline as [^n], matching the numbered context entries.
If the context doesn't contain an answer, say plainly: "I don't have anything on that in the brain yet." Do not guess or invent.
Keep answers concise — a few sentences unless the question needs a list.`;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

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

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const staff = await requireStaff(req);
    if (!staff) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");
    const query = String(body?.query || body?.question || "").trim();
    if (!query) return json({ ok: false, error: "query is required" }, 400);

    const db = admin();
    const sa = await parseServiceAccountKey(Deno.env.get("GCP_SERVICE_ACCOUNT_KEY"));
    const entityType = body?.entityType ? String(body.entityType) : undefined;
    const entityId = body?.entityId ? String(body.entityId) : undefined;
    const docTypes = Array.isArray(body?.docTypes) ? body.docTypes.map(String) : undefined;

    if (action === "search") {
      const result = await retrieveBrainContext(db, sa, query, {
        matchCount: 20,
        threshold: 0.25,
        entityType,
        entityId,
        docTypes,
        maxChars: 100000, // search just wants ranked results, not a packed context block
      });
      return json({ ok: true, citations: result.citations });
    }

    if (action === "ask") {
      const start = Date.now();
      const context = await retrieveBrainContext(db, sa, query, { entityType, entityId, docTypes });

      if (!context.citations.length) {
        const answer = "I don't have anything on that in the brain yet.";
        await db.from("brain_queries").insert({
          user_id: staff.userId,
          question: query,
          answer,
          citations: [],
          chunk_ids: [],
          latency_ms: Date.now() - start,
        });
        return json({ ok: true, text: answer, citations: [] });
      }

      const result = await generateVertexContent(
        sa,
        ASK_MODEL,
        [
          {
            role: "user",
            parts: [{ text: `${ASK_SYSTEM_PROMPT}\n\n${context.block}\n\nQUESTION:\n${query}` }],
          },
        ],
        withThinking(ASK_MODEL, { temperature: 0.2, maxOutputTokens: 1024 }, "low"),
      );
      const text = result?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ||
        "I couldn't generate an answer from the brain.";

      await db.from("brain_queries").insert({
        user_id: staff.userId,
        question: query,
        answer: text,
        citations: context.citations,
        chunk_ids: context.chunkIds,
        latency_ms: Date.now() - start,
      });

      return json({ ok: true, text, citations: context.citations });
    }

    return json({ ok: false, error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    console.error("brain-search error:", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
