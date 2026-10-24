// investment-service.ts: the Investments workspace (segregated funds): compliance files with the MGA's checklist, and each person's investor profile and needs
// analysis, filed as a PDF. Kept apart from Insurance: its own tables. The one shared record is the client's signed disclosure, which covers three checklist items.

// deno-lint-ignore-file no-explicit-any
import { getServiceGoogleAccessToken } from "./google-token.ts";
import { parseDriveId } from "./insurance-file-rules.ts";
import { sha256Hex } from "./insurance-doc-rules.ts";
import { createAndSend, uploadToAdvisorFiles } from "./insurance-doc-service.ts";
import { buildBrandedPdf } from "./simple-pdf.ts";
import { conventionFile, DOC_FILE_NAME } from "./file-naming.ts";
import { CHECKLIST, DISCLOSURE_ITEMS, FILE_KINDS, checklistFor, fileStatus, type FileKind } from "./investment-file-rules.ts";
import { cleanProfile, profileBlocks, type ModelLite } from "./investment-profile-rules.ts";
import { cancelWindow, cleanContract, deliveryLetter } from "./investment-contract-rules.ts";
import { investmentReportBlocks, type ReportPerson as ReportPersonData } from "./investment-report-rules.ts";
import { shareReportIn, unshareReportIn } from "./report-sharing.ts";
import { cleanRecommendation, defaultReason, reasonWhyLetter, recommendationIssues, type ModelFull } from "./investment-recommendation-rules.ts";

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
  const { data: letters } = await db.from("insurance_documents").select("id").eq("household_id", householdId).eq("kind", "investment_reason_why").eq("status", "signed").limit(1);
  if ((letters ?? []).length) covered.add("reason_why");
  const { data: deliveries } = await db.from("insurance_documents").select("id").eq("household_id", householdId).eq("kind", "investment_delivery_letter").eq("status", "signed").limit(1);
  if ((deliveries ?? []).length) covered.add("contract_delivery");
  const { data: apps } = await db.from("investment_contracts").select("id").eq("household_id", householdId).not("application_url", "is", null).limit(1);
  if ((apps ?? []).length) covered.add("application");
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
  const m = await driveMeta(db, input.driveLink);
  if ("error" in m) return m;
  await db.from("investment_file_items").insert({ file_id: fileId, kind, status: "provided", drive_file_id: m.id, drive_name: m.name, drive_url: m.url, note, added_by: who });
  return { ok: true, name: m.name };
}

/** A Drive document from a pasted link, checked to exist (and not a folder). */
async function driveMeta(db: any, link: unknown): Promise<{ id: string; name: string; url: string } | { error: string }> {
  const id = parseDriveId(String(link ?? ""));
  if (!id) return { error: "Paste the Google Drive link to the document." };
  const token = await getServiceGoogleAccessToken(db);
  const r = await fetch(`${DRIVE}/files/${id}?${new URLSearchParams({ fields: "id,name,mimeType,webViewLink", supportsAllDrives: "true" })}`, { headers: { Authorization: `Bearer ${token}` }, signal: sig() });
  if (!r.ok) return { error: r.status === 404 ? "I could not open that link. Check it, and that the file is in your Drive." : `Drive said no (${r.status}).` };
  const meta = await r.json();
  if (meta.mimeType === "application/vnd.google-apps.folder") return { error: "That is a folder. Link the document itself." };
  return { id: meta.id, name: meta.name, url: meta.webViewLink ?? `https://drive.google.com/file/d/${meta.id}/view` };
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

// ---- Recommendation and the reason why letter ----

/** iA's model portfolios (the newest set) with the funds each holds. */
export async function modelsFull(db: any): Promise<ModelFull[]> {
  const { data } = await db.from("ia_model_portfolios").select("profile_key, label, income_min, income_max, equity_min, equity_max, income_target, funds, sort_order, as_of").order("as_of", { ascending: false }).order("sort_order");
  const rows = (data ?? []) as any[];
  const latest = rows[0]?.as_of;
  return rows.filter((r) => r.as_of === latest).map(({ sort_order: _s, ...m }) => ({ ...m, funds: Array.isArray(m.funds) ? m.funds : [] }) as ModelFull);
}

/** Each person's latest profile (with the risk profile and a first draft of the reasons), their current recommendation, and the status of its letter. */
export async function listRecommendations(db: any, householdId: string) {
  const people = await adults(db, householdId);
  const ids = people.map((p) => p.id);
  const [{ data: profiles }, { data: recs }, mdl] = await Promise.all([
    ids.length ? db.from("investment_profiles").select("contact_id, inputs, risk_profile, created_at").in("contact_id", ids).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
    ids.length ? db.from("investment_recommendations").select("id, contact_id, profile_key, model_as_of, amount, accounts, guarantee, fees, reason, deviation_reason, letter_document_id, created_at").in("contact_id", ids).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
    modelsFull(db),
  ]);
  const letterIds = ((recs ?? []) as any[]).map((r) => r.letter_document_id).filter(Boolean);
  const { data: docs } = letterIds.length ? await db.from("insurance_documents").select("id, status, sent_at, completed_at, pdf_url").in("id", letterIds) : { data: [] };
  const out = people.map((p) => {
    const profile = ((profiles ?? []) as any[]).find((x) => x.contact_id === p.id) ?? null;
    const inputs = profile ? cleanProfile(profile.inputs) : null;
    const rec = ((recs ?? []) as any[]).find((r) => r.contact_id === p.id) ?? null;
    const model = inputs?.riskProfile ? mdl.find((m) => m.profile_key === inputs.riskProfile) ?? null : null;
    return { id: p.id, name: p.name, riskProfile: inputs?.riskProfile || null, suggestedReason: inputs && model ? defaultReason(inputs, model) : "", rec: rec ? { ...rec, letter: ((docs ?? []) as any[]).find((d) => d.id === rec.letter_document_id) ?? null } : null };
  });
  return { people: out, models: mdl };
}

export async function saveRecommendation(db: any, who: string, input: { householdId: string; contactId: string; rec: unknown }) {
  const people = await adults(db, input.householdId);
  if (!people.some((p) => p.id === input.contactId)) return { error: "Pick a person in this household." };
  const rec = cleanRecommendation(input.rec);
  const mdl = await modelsFull(db);
  const { data: prof } = await db.from("investment_profiles").select("risk_profile").eq("contact_id", input.contactId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const issues = recommendationIssues(rec, prof?.risk_profile ?? "", mdl);
  if (issues.length) return { error: issues.join(" ") };
  const chosen = mdl.find((m) => m.profile_key === rec.profileKey)!;
  const { data, error } = await db.from("investment_recommendations").insert({ household_id: input.householdId, contact_id: input.contactId, profile_key: rec.profileKey, model_as_of: chosen.as_of ?? null, amount: rec.amount, accounts: rec.accounts || null, guarantee: rec.guarantee || null, fees: rec.fees || null, reason: rec.reason || null, deviation_reason: rec.deviationReason || null, created_by: who }).select("id").single();
  if (error) return { error: "Could not save the recommendation." };
  return { ok: true, id: data.id };
}

async function letterFor(db: any, id: string) {
  const { data: r } = await db.from("investment_recommendations").select("*").eq("id", id).maybeSingle();
  if (!r) return { error: "Recommendation not found." } as const;
  const people = await adults(db, r.household_id);
  const person = people.find((p) => p.id === r.contact_id);
  if (!person) return { error: "The client is no longer in the household." } as const;
  const [{ data: prof }, mdl] = await Promise.all([db.from("investment_profiles").select("inputs, risk_profile").eq("contact_id", r.contact_id).order("created_at", { ascending: false }).limit(1).maybeSingle(), modelsFull(db)]);
  if (!prof) return { error: "Save the investor profile first." } as const;
  const model = mdl.find((m) => m.profile_key === r.profile_key);
  if (!model) return { error: "That model portfolio is no longer in iA's current set. Choose the recommendation again." } as const;
  const rec = cleanRecommendation({ profileKey: r.profile_key, amount: r.amount, accounts: r.accounts, guarantee: r.guarantee, fees: r.fees, reason: r.reason, deviationReason: r.deviation_reason });
  const md = reasonWhyLetter({ person: person.name, date: new Date(), profile: cleanProfile(prof.inputs), model, defaultModel: mdl.find((m) => m.profile_key === prof.risk_profile) ?? null, rec });
  return { r, person, md } as const;
}

/** The letter as Markdown to edit. Blanks (____) mark what is still to be filled in. */
export async function draftLetter(db: any, id: string) {
  const g = await letterFor(db, id);
  if ("error" in g) return g;
  return { ok: true as const, md: g.md, blanks: (g.md.match(/_{3,}/g) ?? []).length };
}

/** Sends the (edited) letter to the client's portal, where they confirm it. A letter with blanks does not go. */
export async function sendLetter(db: any, who: string, id: string, bodyMd: unknown) {
  const g = await letterFor(db, id);
  if ("error" in g) return g;
  if (g.r.letter_document_id) {
    const { data: d } = await db.from("insurance_documents").select("status").eq("id", g.r.letter_document_id).maybeSingle();
    if (d?.status === "signed") return { error: "The client has already confirmed this letter." };
  }
  const md = typeof bodyMd === "string" && bodyMd.trim() ? bodyMd.trim().slice(0, 30_000) : g.md;
  if (/_{3,}/.test(md)) return { error: "The letter still has blanks to fill in." };
  const sent: any = await createAndSend(db, who, { householdId: g.r.household_id, kind: "investment_reason_why", title: "Investment Reason Why Letter", md, hash: await sha256Hex(md), driveId: "none", modified: null, version: null, signers: [{ id: g.person.id, name: g.person.name }] });
  if (sent.error) return sent;
  await db.from("investment_recommendations").update({ letter_document_id: sent.id }).eq("id", id);
  return { ok: true as const, documentId: sent.id as string };
}

// ---- The client report ----

export interface InvReportRequest { householdId: string; contactIds?: unknown; includeFunds?: unknown; coverNote?: unknown }
type Built = { error: string } | { ok: true; pdf: Uint8Array; name: string; contactIds: string[]; includeFunds: boolean; coverNote: string | null };
const longDate = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "America/Vancouver", dateStyle: "long" });

async function buildReport(db: any, input: InvReportRequest): Promise<Built> {
  const all = await adults(db, input.householdId);
  const wanted = Array.isArray(input.contactIds) ? new Set(input.contactIds.map(String)) : null;
  const chosen = all.filter((p) => !wanted || wanted.has(p.id));
  if (!chosen.length) return { error: "Pick at least one person in this household." };
  const ids = chosen.map((p) => p.id);
  const [{ data: profiles }, { data: recs }, mdl] = await Promise.all([
    db.from("investment_profiles").select("contact_id, inputs, created_at").in("contact_id", ids).order("created_at", { ascending: false }),
    db.from("investment_recommendations").select("contact_id, profile_key, amount, accounts, guarantee, fees, reason, deviation_reason").in("contact_id", ids).order("created_at", { ascending: false }),
    modelsFull(db),
  ]);
  const people: ReportPersonData[] = chosen.map((c) => {
    const pr = ((profiles ?? []) as any[]).find((x) => x.contact_id === c.id);
    const r = ((recs ?? []) as any[]).find((x) => x.contact_id === c.id);
    return { name: c.name, profile: pr ? cleanProfile(pr.inputs) : null, profileSavedAt: pr?.created_at ?? null, rec: r ? { ...cleanRecommendation({ profileKey: r.profile_key, amount: r.amount, accounts: r.accounts, guarantee: r.guarantee, fees: r.fees, reason: r.reason, deviationReason: r.deviation_reason }) } : null };
  });
  const includeFunds = input.includeFunds !== false;
  const coverNote = String(input.coverNote ?? "").trim().slice(0, 3000) || null;
  const blocks = investmentReportBlocks({ preparedOn: longDate(), coverNote, includeFunds, models: mdl, people });
  const pdf = buildBrandedPdf({ title: "Investment Recommendation Report", subtitle: `${people.map((p) => p.name).join(" and ")} \u00B7 ${longDate()}`, footer: footer(), blocks });
  return { ok: true, pdf, name: conventionFile(ymd(), chosen, DOC_FILE_NAME.investment_report), contactIds: ids, includeFunds, coverNote };
}

/** The report as a PDF to look at before filing it. Nothing is saved. */
export async function previewInvReport(db: any, input: InvReportRequest): Promise<{ ok: true; name: string; base64: string } | { error: string }> {
  const r = await buildReport(db, input);
  if ("error" in r) return r;
  let bin = "";
  for (let i = 0; i < r.pdf.length; i += 0x8000) bin += String.fromCharCode(...r.pdf.subarray(i, i + 0x8000));
  return { ok: true, name: r.name, base64: btoa(bin) };
}

/** Files the report in Advisor Files / Reports and records what it covered. */
export async function fileInvReport(db: any, who: string, input: InvReportRequest): Promise<{ ok: true; url: string; name: string } | { error: string }> {
  const r = await buildReport(db, input);
  if ("error" in r) return r;
  let drive;
  try { drive = await uploadToAdvisorFiles(db, input.householdId, "Reports", r.name, r.pdf); } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  const { error } = await db.from("investment_reports").insert({ household_id: input.householdId, title: "Investment Recommendation Report", contact_ids: r.contactIds, include_funds: r.includeFunds, cover_note: r.coverNote, pdf_drive_id: drive.id, pdf_url: drive.url, pdf_name: drive.name, created_by: who });
  if (error) return { error: "The PDF is filed in Advisor Files, but I could not record it here." };
  return { ok: true, url: drive.url, name: drive.name };
}

export async function listInvReports(db: any, householdId: string) {
  const { data } = await db.from("investment_reports").select("id, title, contact_ids, include_funds, pdf_url, pdf_name, created_by, created_at, shared_at").eq("household_id", householdId).order("created_at", { ascending: false }).limit(20);
  return { reports: data ?? [] };
}
export const shareInvReport = (db: any, who: string, id: string, notify: boolean) => shareReportIn(db, "investment_reports", who, id, notify);
export const unshareInvReport = (db: any, id: string) => unshareReportIn(db, "investment_reports", id);

// ---- Application, contract and delivery ----

const today = () => ymd();

/** Each person's contracts: the evidence, the dates, where the right-to-cancel window stands and the state of the delivery letter. */
export async function listContracts(db: any, householdId: string) {
  const people = await adults(db, householdId);
  const ids = people.map((p) => p.id);
  const { data: rows } = ids.length ? await db.from("investment_contracts").select("*").in("contact_id", ids).order("created_at", { ascending: false }) : { data: [] };
  const letterIds = ((rows ?? []) as any[]).map((r) => r.letter_document_id).filter(Boolean);
  const { data: docs } = letterIds.length ? await db.from("insurance_documents").select("id, status, sent_at, completed_at, pdf_url").in("id", letterIds) : { data: [] };
  const { data: recs } = ids.length ? await db.from("investment_recommendations").select("contact_id, profile_key, amount, accounts").in("contact_id", ids).order("created_at", { ascending: false }) : { data: [] };
  const contracts = ((rows ?? []) as any[]).map((r) => ({ ...r, window: cancelWindow({ confirmationReceivedOn: r.confirmation_received_on ?? "", cancelBusinessDays: r.cancel_business_days ?? null }, today()), letter: ((docs ?? []) as any[]).find((d) => d.id === r.letter_document_id) ?? null }));
  return { people: people.map(({ id, name }) => ({ id, name })), contracts, recommendations: (recs ?? []) as any[] };
}

/** Adds a contract, or updates one. The cancel date is worked out from the confirmation date and the number of business days. */
export async function saveContract(db: any, who: string, input: { householdId: string; contactId: string; id?: unknown; contract: unknown }) {
  const people = await adults(db, input.householdId);
  if (!people.some((p) => p.id === input.contactId)) return { error: "Pick a person in this household." };
  const c = cleanContract(input.contract);
  // Links are checked against Drive, and the document's name is kept.
  const app = c.applicationUrl ? await driveMeta(db, c.applicationUrl) : null;
  if (app && "error" in app) return { error: `Application: ${app.error}` };
  const con = c.contractUrl ? await driveMeta(db, c.contractUrl) : null;
  if (con && "error" in con) return { error: `Contract: ${con.error}` };
  const win = cancelWindow(c, today());
  const row = {
    contract_number: c.contractNumber || null, accounts: c.accounts || null, amount: c.amount || null,
    application_url: app ? app.url : null, application_name: app ? app.name : null, contract_url: con ? con.url : null, contract_name: con ? con.name : null,
    issued_on: c.issuedOn || null, confirmation_received_on: c.confirmationReceivedOn || null, cancel_business_days: c.cancelBusinessDays, cancel_ends_on: win.endsOn,
    fund_facts_on: c.fundFactsOn || null, fund_facts_note: c.fundFactsNote || null, updated_at: new Date().toISOString(),
  };
  if (input.id) {
    const { data: ex } = await db.from("investment_contracts").select("id, letter_document_id").eq("id", String(input.id)).eq("contact_id", input.contactId).maybeSingle();
    if (!ex) return { error: "Contract not found." };
    const { error } = await db.from("investment_contracts").update(row).eq("id", ex.id);
    return error ? { error: "Could not save the contract." } : { ok: true as const, id: ex.id as string };
  }
  const { data, error } = await db.from("investment_contracts").insert({ ...row, household_id: input.householdId, contact_id: input.contactId, created_by: who }).select("id").single();
  return error ? { error: "Could not save the contract." } : { ok: true as const, id: data.id as string };
}

async function deliveryFor(db: any, id: string) {
  const { data: r } = await db.from("investment_contracts").select("*").eq("id", id).maybeSingle();
  if (!r) return { error: "Contract not found." } as const;
  const person = (await adults(db, r.household_id)).find((p) => p.id === r.contact_id);
  if (!person) return { error: "The client is no longer in the household." } as const;
  const { data: rec } = await db.from("investment_recommendations").select("profile_key").eq("contact_id", r.contact_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const model = rec ? (await modelsFull(db)).find((m) => m.profile_key === rec.profile_key) : null;
  const c = cleanContract({ contractNumber: r.contract_number, accounts: r.accounts, amount: r.amount, issuedOn: r.issued_on, confirmationReceivedOn: r.confirmation_received_on, cancelBusinessDays: r.cancel_business_days, fundFactsOn: r.fund_facts_on, fundFactsNote: r.fund_facts_note });
  return { r, person, md: deliveryLetter({ person: person.name, date: new Date(), c, modelLabel: model?.label ?? null }) } as const;
}

export async function draftDeliveryLetter(db: any, id: string) {
  const g = await deliveryFor(db, id);
  if ("error" in g) return g;
  return { ok: true as const, md: g.md, blanks: (g.md.match(/_{3,}/g) ?? []).length };
}

/** Sends the (edited) delivery letter to the client's portal to confirm. A letter with blanks does not go. */
export async function sendDeliveryLetter(db: any, who: string, id: string, bodyMd: unknown) {
  const g = await deliveryFor(db, id);
  if ("error" in g) return g;
  if (g.r.letter_document_id) {
    const { data: d } = await db.from("insurance_documents").select("status").eq("id", g.r.letter_document_id).maybeSingle();
    if (d?.status === "signed") return { error: "The client has already confirmed this letter." };
  }
  const md = typeof bodyMd === "string" && bodyMd.trim() ? bodyMd.trim().slice(0, 30_000) : g.md;
  if (/_{3,}/.test(md)) return { error: "The letter still has blanks to fill in." };
  const sent: any = await createAndSend(db, who, { householdId: g.r.household_id, kind: "investment_delivery_letter", title: "Investment Delivery Letter", md, hash: await sha256Hex(md), driveId: "none", modified: null, version: null, signers: [{ id: g.person.id, name: g.person.name }] });
  if (sent.error) return sent;
  await db.from("investment_contracts").update({ letter_document_id: sent.id, updated_at: new Date().toISOString() }).eq("id", id);
  return { ok: true as const, documentId: sent.id as string };
}
