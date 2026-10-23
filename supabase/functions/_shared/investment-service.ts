// investment-service.ts: the Investments workspace (segregated funds): compliance files with the MGA's checklist, and each person's investor profile and needs
// analysis, filed as a PDF. Kept apart from Insurance: its own tables. The one shared record is the client's signed disclosure, which covers three checklist items.

// deno-lint-ignore-file no-explicit-any
import { getServiceGoogleAccessToken } from "./google-token.ts";
import { parseDriveId } from "./insurance-file-rules.ts";
import { uploadToAdvisorFiles } from "./insurance-doc-service.ts";
import { buildBrandedPdf } from "./simple-pdf.ts";
import { conventionFile, DOC_FILE_NAME } from "./file-naming.ts";
import { CHECKLIST, DISCLOSURE_ITEMS, FILE_KINDS, checklistFor, fileStatus, type FileKind } from "./investment-file-rules.ts";
import { cleanProfile, profileBlocks, type ModelLite } from "./investment-profile-rules.ts";

const DRIVE = "https://www.googleapis.com/drive/v3";
const sig = () => AbortSignal.timeout(25_000);
const ymd = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver" }).format(d);
const footer = () => `© ${new Date().getFullYear()} Issler Group Management & Consulting Inc. o/a ProsperWise Advisors · www.prosperwise.ca`;

async function adults(db: any, householdId: string) {
  const { data } = await db.from("contacts").select("id, first_name, last_name, full_name, is_minor, email").eq("household_id", householdId).order("created_at");
  return ((data ?? []) as any[]).filter((c) => !c.is_minor).map((c) => ({ id: c.id as string, name: (c.full_name || `${c.first_name ?? ""} ${c.last_name ?? ""}`).trim() || "Client", first_name: c.first_name, last_name: c.last_name, full_name: c.full_name }));
}

/** iA's model portfolios (the newest set): the risk profiles a client can have. */
export async function models(db: any): Promise<ModelLite[]> {
  const { data } = await db.from("ia_model_portfolios").select("profile_key, label, income_min, income_max, equity_min, equity_max, sort_order, as_of").order("as_of", { ascending: false }).order("sort_order");
  const rows = (data ?? []) as any[];
  const latest = rows[0]?.as_of;
  return rows.filter((r) => r.as_of === latest).map(({ sort_order: _s, ...m }) => m as ModelLite);
}

/** The signed disclosure, which covers the disclosure, privacy and CASL items for everyone who signed it. Shared with Insurance: it belongs to the client. */
async function disclosureState(db: any, householdId: string) {
  const pick = (d: any) => (d ? { id: d.id as string, status: d.status as string, sentAt: d.sent_at as string, signedAt: (d.completed_at ?? null) as string | null } : null);
  const base = () => db.from("insurance_documents").select("id, status, sent_at, completed_at").eq("household_id", householdId).eq("kind", "disclosure_privacy");
  // A signed copy counts even when a newer copy has since been sent for signature.
  const { data: signed } = await base().eq("status", "signed").order("completed_at", { ascending: false }).limit(1).maybeSingle();
  if (signed) return pick(signed);
  const { data: waiting } = await base().neq("status", "void").order("sent_at", { ascending: false }).limit(1).maybeSingle();
  return pick(waiting);
}

export async function listFiles(db: any, householdId: string) {
  const people = await adults(db, householdId);
  const [{ data: files }, disclosure, { data: profiles }, { data: meetings }] = await Promise.all([
    db.from("investment_files").select("id, contact_id, title, kind, status, opened_at").eq("household_id", householdId).order("opened_at", { ascending: false }),
    disclosureState(db, householdId),
    people.length ? db.from("investment_profiles").select("contact_id, risk_profile").in("contact_id", people.map((p) => p.id)) : Promise.resolve({ data: [] }),
    db.from("meeting_records").select("task_id, doc_name, doc_url").eq("household_id", householdId),
  ]);
  const ids = (files ?? []).map((f: any) => f.id);
  const { data: items } = ids.length ? await db.from("investment_file_items").select("id, file_id, kind, status, drive_name, drive_url, meeting_task_id, note, added_by, added_at").in("file_id", ids).order("added_at", { ascending: true }) : { data: [] };
  // Records kept elsewhere that cover checklist items.
  const covered = new Set<string>();
  if (disclosure?.status === "signed") for (const k of DISCLOSURE_ITEMS) covered.add(k);
  if (((profiles ?? []) as any[]).some((p) => p.risk_profile)) covered.add("fact_find");
  const out = (files ?? []).map((f: any) => {
    const its = ((items ?? []) as any[]).filter((i) => i.file_id === f.id);
    const st = fileStatus(f.kind, its, covered);
    const done = (kind: string) => its.some((i) => i.kind === kind) || covered.has(kind);
    return {
      ...f, items: its,
      checklist: checklistFor(f.kind).map((c) => ({ ...c, done: done(c.kind), covered: !its.some((i) => i.kind === c.kind) && covered.has(c.kind) })),
      optional: CHECKLIST.filter((c) => c.requiredFor.length === 0).map((c) => ({ ...c, done: done(c.kind) })),
      progress: { required: st.required, done: st.done, complete: st.complete },
    };
  });
  return { files: out, meetings: meetings ?? [], disclosure, adults: people.map(({ id, name }) => ({ id, name })) };
}

export async function createFile(db: any, who: string, householdId: string, title: unknown, kind: unknown, contactId?: unknown) {
  const t = String(title ?? "").trim().slice(0, 160);
  if (t.length < 3) return { error: "Give the file a name, for example the client and the account." };
  const k = FILE_KINDS.includes(kind as FileKind) ? (kind as FileKind) : "new_sale";
  const { data, error } = await db.from("investment_files").insert({ household_id: householdId, title: t, kind: k, contact_id: contactId || null, created_by: who }).select("id").single();
  if (error) return { error: error.message };
  return { ok: true, id: data.id };
}

/** Attaches evidence: a Drive file (checked to exist, by its link) or a meeting record, or marks the item not applicable. */
export async function attachItem(db: any, who: string, fileId: string, kind: string, input: { driveLink?: unknown; meetingTaskId?: unknown; notApplicable?: unknown; note?: unknown }) {
  if (!CHECKLIST.some((c) => c.kind === kind)) return { error: "Unknown checklist item." };
  const { data: f } = await db.from("investment_files").select("id").eq("id", fileId).maybeSingle();
  if (!f) return { error: "File not found." };
  const note = String(input.note ?? "").trim().slice(0, 300) || null;
  if (input.notApplicable === true) {
    await db.from("investment_file_items").insert({ file_id: fileId, kind, status: "not_applicable", note, added_by: who });
    return { ok: true };
  }
  if (input.meetingTaskId) {
    const { data: m } = await db.from("meeting_records").select("task_id, doc_id, doc_name, doc_url").eq("task_id", String(input.meetingTaskId)).maybeSingle();
    if (!m) return { error: "That meeting has no record yet. Close its follow-up task first." };
    await db.from("investment_file_items").insert({ file_id: fileId, kind, status: "provided", drive_file_id: m.doc_id, drive_name: m.doc_name, drive_url: m.doc_url, meeting_task_id: m.task_id, note, added_by: who });
    return { ok: true };
  }
  const id = parseDriveId(String(input.driveLink ?? ""));
  if (!id) return { error: "Paste the Google Drive link to the document." };
  const token = await getServiceGoogleAccessToken(db);
  const r = await fetch(`${DRIVE}/files/${id}?${new URLSearchParams({ fields: "id,name,mimeType,webViewLink", supportsAllDrives: "true" })}`, { headers: { Authorization: `Bearer ${token}` }, signal: sig() });
  if (!r.ok) return { error: r.status === 404 ? "I could not open that link. Check it, and that the file is in your Drive." : `Drive said no (${r.status}).` };
  const meta = await r.json();
  if (meta.mimeType === "application/vnd.google-apps.folder") return { error: "That is a folder. Link the document itself." };
  await db.from("investment_file_items").insert({ file_id: fileId, kind, status: "provided", drive_file_id: meta.id, drive_name: meta.name, drive_url: meta.webViewLink ?? `https://drive.google.com/file/d/${meta.id}/view`, note, added_by: who });
  return { ok: true, name: meta.name };
}

export async function removeItem(db: any, itemId: string) {
  await db.from("investment_file_items").delete().eq("id", itemId);
  return { ok: true };
}

/** Each person's saved profile versions (newest first) and iA's models, so the risk profile is chosen from them. */
export async function listProfiles(db: any, householdId: string) {
  const people = await adults(db, householdId);
  const { data } = people.length ? await db.from("investment_profiles").select("id, contact_id, inputs, risk_profile, note, pdf_url, created_at, created_by").in("contact_id", people.map((p) => p.id)).order("created_at", { ascending: false }).limit(60) : { data: [] };
  return { adults: people.map(({ id, name }) => ({ id, name })), profiles: data ?? [], models: await models(db) };
}

export async function saveProfile(db: any, who: string, input: { householdId: string; contactId: string; inputs: unknown; note?: unknown }) {
  const people = await adults(db, input.householdId);
  if (!people.some((p) => p.id === input.contactId)) return { error: "Pick a person in this household." };
  const inputs = cleanProfile(input.inputs);
  if (inputs.riskProfile && !(await models(db)).some((m) => m.profile_key === inputs.riskProfile)) return { error: "That risk profile is not one of iA's model portfolios." };
  const { data, error } = await db.from("investment_profiles").insert({ household_id: input.householdId, contact_id: input.contactId, inputs, risk_profile: inputs.riskProfile || null, note: String(input.note ?? "").trim().slice(0, 500) || null, created_by: who }).select("id").single();
  if (error) return { error: "Could not save the profile." };
  return { ok: true, id: data.id };
}

/** Files a saved profile as a branded PDF in Advisor Files / Investor Profiles. */
export async function fileProfile(db: any, id: string): Promise<{ ok: true; url: string } | { error: string }> {
  const { data: p } = await db.from("investment_profiles").select("id, household_id, contact_id, inputs, note, created_at, pdf_drive_id, pdf_url").eq("id", id).maybeSingle();
  if (!p) return { error: "Profile not found." };
  if (p.pdf_drive_id) return { ok: true, url: p.pdf_url };
  const { data: c } = await db.from("contacts").select("full_name, first_name, last_name, household_id").eq("id", p.contact_id).maybeSingle();
  const householdId = p.household_id ?? c?.household_id;
  if (!householdId) return { error: "This person is not in a household, so there is no Advisor Files folder to put it in." };
  const person = (c?.full_name || `${c?.first_name ?? ""} ${c?.last_name ?? ""}`).trim() || "Client";
  const inputs = cleanProfile(p.inputs);
  const model = inputs.riskProfile ? (await models(db)).find((m) => m.profile_key === inputs.riskProfile) ?? null : null;
  const pdf = buildBrandedPdf({ title: "Investor Profile and Needs Analysis", subtitle: `${person} · ${new Date(p.created_at).toLocaleDateString("en-CA", { timeZone: "America/Vancouver", dateStyle: "long" })}`, footer: footer(), blocks: profileBlocks({ inputs, person, savedAt: p.created_at, note: p.note, model }) });
  let drive;
  try { drive = await uploadToAdvisorFiles(db, householdId, "Investor Profiles", conventionFile(ymd(new Date(p.created_at)), [c ?? {}], DOC_FILE_NAME.investor_profile), pdf); } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  await db.from("investment_profiles").update({ pdf_drive_id: drive.id, pdf_url: drive.url, filed_at: new Date().toISOString() }).eq("id", p.id);
  return { ok: true, url: drive.url };
}
