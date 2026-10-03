// invoice-agent — drafts an invoice from a plain-language prompt.
// Project Glass Box: the model only sees the advisor's prompt and the
// (non-PII) service catalog. Contact resolution happens in code, never in the
// model context, and nothing is sent to Square until an advisor approves.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateVertexContent, parseServiceAccountKey, GEMINI_FLASH_MODEL, withThinking } from "../_shared/vertex-ai.ts";

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
const MODEL = GEMINI_FLASH_MODEL;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

const SYSTEM_PROMPT = `You are the invoicing assistant for a Canadian wealth governance firm.
From the advisor's request, produce a DRAFT invoice. Rules:
- Only use services from the provided catalog. Match by name; never invent a service.
- If the request describes work not in the catalog, add it as a custom line item with a sensible description.
- Quantities default to 1. Unit amounts default to the catalog price when a catalog service is matched.
- Currency is always CAD. Never apply tax unless the advisor explicitly asks.
- Keep notes under 300 characters and free of personal identifiers.
Return JSON only, no markdown fences.`;

interface DraftLine {
  service_name?: string;
  description: string;
  quantity?: number;
  unit_amount?: number;
}

interface Draft {
  client_hint?: string;
  line_items: DraftLine[];
  notes?: string;
  due_in_days?: number;
  discount_amount?: number;
  tax_amount?: number;
}

function extractJson(text: string): any {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("The assistant did not return a usable draft.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

/** Resolve a contact from the advisor's own words — no PII enters the model. */
async function resolveContact(prompt: string, hint?: string) {
  const db = admin();
  const haystack = `${hint || ""} ${prompt}`;
  const tokens = Array.from(
    new Set(
      haystack
        .split(/[^A-Za-zÀ-ÿ'-]+/)
        .filter((t) => t.length > 2)
        .map((t) => t.toLowerCase()),
    ),
  ).slice(0, 12);
  if (!tokens.length) return null;

  const { data } = await db.from("contacts").select("id, full_name, email").limit(2000);
  if (!data?.length) return null;

  let best: { id: string; full_name: string; email: string | null; score: number } | null = null;
  for (const c of data) {
    const nameTokens = String(c.full_name || "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (!nameTokens.length) continue;
    const score = nameTokens.reduce((acc, nt) => acc + (tokens.includes(nt) ? 1 : 0), 0);
    if (score > 0 && (!best || score > best.score)) best = { ...c, score } as any;
  }
  return best && best.score > 0 ? best : null;
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json({ ok: false, error: "Missing authorization header" }, 401);
    const supabaseUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !userData?.user) return json({ ok: false, error: "Not authenticated" }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const prompt = String(body?.prompt || "").trim();
    if (!prompt) return json({ ok: false, error: "Describe the invoice you want to draft." }, 400);

    const db = admin();
    const { data: services } = await db
      .from("services")
      .select("id, name, description, category, price, duration_minutes")
      .eq("is_active", true)
      .order("name");

    const catalog = (services || []).map((s) => ({
      name: s.name,
      category: s.category,
      price: Number(s.price),
      description: s.description,
    }));

    const sa = await parseServiceAccountKey(Deno.env.get("GCP_SERVICE_ACCOUNT_KEY"));
    const result = await generateVertexContent(
      sa,
      MODEL,
      [
        {
          role: "user",
          parts: [
            {
              text: `${SYSTEM_PROMPT}

SERVICE CATALOG (JSON):
${JSON.stringify(catalog)}

ADVISOR REQUEST:
${prompt}

Respond with JSON shaped exactly as:
{"client_hint":"","line_items":[{"service_name":"","description":"","quantity":1,"unit_amount":0}],"notes":"","due_in_days":14,"discount_amount":0,"tax_amount":0}`,
            },
          ],
        },
      ],
      withThinking(MODEL, { temperature: 0.2, maxOutputTokens: 1500, responseMimeType: "application/json" }, "low"),
    );

    const text = result?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") || "";
    const draft = extractJson(text) as Draft;
    const rawLines = Array.isArray(draft.line_items) ? draft.line_items : [];
    if (!rawLines.length) return json({ ok: false, error: "The assistant could not build any line items." }, 422);

    const byName = new Map((services || []).map((s) => [String(s.name).toLowerCase(), s]));
    const lines = rawLines.slice(0, 25).map((l) => {
      const match = l.service_name ? byName.get(String(l.service_name).toLowerCase()) : undefined;
      const quantity = Math.max(Number(l.quantity || 1), 0.01);
      const unit = Number(l.unit_amount ?? match?.price ?? 0);
      return {
        service_id: match?.id ?? null,
        description: String(l.description || match?.name || "Professional services").slice(0, 300),
        quantity,
        unit_amount: unit,
        line_total: Math.round(quantity * unit * 100) / 100,
      };
    });

    const contact = await resolveContact(prompt, draft.client_hint);
    const subtotal = Math.round(lines.reduce((a, l) => a + l.line_total, 0) * 100) / 100;
    const discount = Math.max(Number(draft.discount_amount || 0), 0);
    const tax = Math.max(Number(draft.tax_amount || 0), 0);
    const total = Math.round((subtotal - discount + tax) * 100) / 100;
    const dueDays = Math.min(Math.max(Number(draft.due_in_days || 14), 0), 180);
    const dueDate = new Date(Date.now() + dueDays * 86400000).toISOString().slice(0, 10);
    const notes = String(draft.notes || "").slice(0, 300) || null;

    // Draft only — an advisor must approve before anything reaches Square.
    const { data: review } = await db
      .from("review_queue")
      .insert({
        contact_id: contact?.id ?? null,
        action_type: "invoice_draft",
        action_description: `AI drafted an invoice${contact ? ` for ${contact.full_name}` : ""} totalling ${total.toFixed(2)} CAD`,
        proposed_data: { prompt, lines, subtotal, discount, tax, total, due_date: dueDate, notes },
        logic_trace: `invoice-agent (${MODEL}, Montreal). Draft for CFO Review — no Square call made.`,
        created_by: userId,
      })
      .select("id")
      .maybeSingle();

    const { data: invoice, error: invErr } = await db
      .from("invoices")
      .insert({
        contact_id: contact?.id ?? null,
        status: "draft",
        subtotal,
        discount_amount: discount,
        tax_amount: tax,
        total,
        due_date: dueDate,
        notes,
        is_ai_draft: true,
        ai_prompt: prompt,
        review_queue_id: review?.id ?? null,
        created_by: userId,
      })
      .select("id")
      .maybeSingle();
    if (invErr || !invoice) throw new Error(invErr?.message || "Could not save the draft invoice.");

    await db.from("invoice_line_items").insert(
      lines.map((l, i) => ({
        invoice_id: invoice.id,
        service_id: l.service_id,
        description: l.description,
        quantity: l.quantity,
        unit_amount: l.unit_amount,
        line_total: l.line_total,
        sort_order: i,
      })),
    );

    return json({
      ok: true,
      invoiceId: invoice.id,
      contact: contact ? { id: contact.id, full_name: contact.full_name } : null,
      total,
      lineCount: lines.length,
      needsContact: !contact,
    });
  } catch (e) {
    console.error("invoice-agent error:", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
