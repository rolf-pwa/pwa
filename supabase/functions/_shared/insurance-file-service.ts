// insurance-file-service.ts: insurance files with a compliance checklist, the audit package built in the household's Advisor Files, and Georgia's
// morning check for what is missing. Additive in Drive: copies and new documents only; nothing is moved, renamed or deleted.

// deno-lint-ignore-file no-explicit-any
import { ADMIN_INBOX_EMAIL, getServiceGoogleAccessToken, resolveUserIdByEmail } from "./google-token.ts";
import { driveCreateDoc, driveEnsureFolder, driveFindFolder } from "./meeting-record-service.ts";
import { CHECKLIST, KIND_LABEL, checklistFor, fileStatus, indexHtml, parseDriveId, type FileKind, type IndexInput } from "./insurance-file-rules.ts";

const DRIVE = "https://www.googleapis.com/drive/v3";
const ADVISOR_FILES = "Advisor Files";
const AUDIT_PACKAGES = "Audit Packages";
const sig = () => AbortSignal.timeout(25_000);
const ymd = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver" }).format(d);
const FILE_KINDS: FileKind[] = ["new_sale", "replacement", "in_force_review"];

export async function listFiles(db: any, householdId: string) {
  const { data: files } = await db.from("insurance_files").select("id, policy_id, contact_id, title, kind, status, opened_at, package_url, packaged_at").eq("household_id", householdId).order("opened_at", { ascending: false });
  const ids = (files ?? []).map((f: any) => f.id);
  const { data: items } = ids.length ? await db.from("insurance_file_items").select("id, file_id, kind, status, drive_name, drive_url, meeting_task_id, note, added_by, added_at").in("file_id", ids).order("added_at", { ascending: true }) : { data: [] as any[] };
  const { data: policies } = await db.from("insurance_policies").select("id, carrier, policy_type, policy_number, insured_name, contact_id, coverage_amount, premium_amount, premium_frequency").in("contact_id", (await db.from("contacts").select("id").eq("household_id", householdId)).data?.map((c: any) => c.id) ?? []);
  const { data: meetings } = await db.from("meeting_records").select("task_id, doc_name, doc_url, filed_for_completion").eq("household_id", householdId);
  const out = (files ?? []).map((f: any) => {
    const its = ((items ?? []) as any[]).filter((i) => i.file_id === f.id);
    const st = fileStatus(f.kind, its);
    return { ...f, items: its, checklist: checklistFor(f.kind).map((c) => ({ ...c, done: its.some((i) => i.kind === c.kind) })), optional: CHECKLIST.filter((c) => c.requiredFor.length === 0), progress: { required: st.required, done: st.done, complete: st.complete } };
  });
  return { files: out, policies: policies ?? [], meetings: meetings ?? [] };
}

export async function createFile(db: any, who: string, householdId: string, title: unknown, kind: unknown, policyId?: unknown, contactId?: unknown) {
  const t = String(title ?? "").trim().slice(0, 160);
  if (t.length < 3) return { error: "Give the file a name, for example the client and the product." };
  const k = FILE_KINDS.includes(kind as FileKind) ? (kind as FileKind) : "new_sale";
  const { data, error } = await db.from("insurance_files").insert({ household_id: householdId, title: t, kind: k, policy_id: policyId || null, contact_id: contactId || null, created_by: who }).select("id").single();
  if (error) return { error: error.message };
  return { ok: true, id: data.id };
}

/** Attaches evidence: a Drive file (checked to exist, by its link) or a meeting record, or marks the item not applicable. */
export async function attachItem(db: any, who: string, fileId: string, kind: string, input: { driveLink?: unknown; meetingTaskId?: unknown; notApplicable?: unknown; note?: unknown }) {
  if (!CHECKLIST.some((c) => c.kind === kind)) return { error: "Unknown checklist item." };
  const { data: f } = await db.from("insurance_files").select("id, status").eq("id", fileId).maybeSingle();
  if (!f) return { error: "File not found." };
  const note = String(input.note ?? "").trim().slice(0, 300) || null;
  if (input.notApplicable === true) {
    await db.from("insurance_file_items").insert({ file_id: fileId, kind, status: "not_applicable", note, added_by: who });
    return { ok: true };
  }
  if (input.meetingTaskId) {
    const { data: m } = await db.from("meeting_records").select("task_id, doc_id, doc_name, doc_url").eq("task_id", String(input.meetingTaskId)).maybeSingle();
    if (!m) return { error: "That meeting has no record yet. Close its follow-up task first." };
    await db.from("insurance_file_items").insert({ file_id: fileId, kind, status: "provided", drive_file_id: m.doc_id, drive_name: m.doc_name, drive_url: m.doc_url, meeting_task_id: m.task_id, note, added_by: who });
    return { ok: true };
  }
  const id = parseDriveId(String(input.driveLink ?? ""));
  if (!id) return { error: "Paste the Google Drive link to the document." };
  const token = await getServiceGoogleAccessToken(db);
  const r = await fetch(`${DRIVE}/files/${id}?${new URLSearchParams({ fields: "id,name,mimeType,webViewLink", supportsAllDrives: "true" })}`, { headers: { Authorization: `Bearer ${token}` }, signal: sig() });
  if (!r.ok) return { error: r.status === 404 ? "I could not open that link. Check it, and that the file is in your Drive." : `Drive said no (${r.status}).` };
  const meta = await r.json();
  if (meta.mimeType === "application/vnd.google-apps.folder") return { error: "That is a folder. Link the document itself." };
  await db.from("insurance_file_items").insert({ file_id: fileId, kind, status: "provided", drive_file_id: meta.id, drive_name: meta.name, drive_url: meta.webViewLink ?? `https://drive.google.com/file/d/${meta.id}/view`, note, added_by: who });
  return { ok: true, name: meta.name };
}

export async function removeItem(db: any, itemId: string) {
  await db.from("insurance_file_items").delete().eq("id", itemId);
  return { ok: true };
}

/** Builds the audit package: a dated folder in the household's Advisor Files with copies of each piece of evidence and an index document. */
export async function buildPackage(db: any, who: string, fileId: string) {
  const { data: f } = await db.from("insurance_files").select("id, household_id, contact_id, policy_id, title, kind, opened_at").eq("id", fileId).maybeSingle();
  if (!f) return { error: "File not found." };
  const [{ data: hh }, { data: items }, { data: contact }, { data: policy }] = await Promise.all([
    db.from("households").select("id, label, vault_folder_id").eq("id", f.household_id).maybeSingle(),
    db.from("insurance_file_items").select("id, kind, status, drive_file_id, drive_name, drive_url, note, added_by, added_at").eq("file_id", fileId).order("added_at", { ascending: true }),
    f.contact_id ? db.from("contacts").select("full_name").eq("id", f.contact_id).maybeSingle() : Promise.resolve({ data: null }),
    f.policy_id ? db.from("insurance_policies").select("carrier, policy_type, policy_number").eq("id", f.policy_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!hh?.vault_folder_id) return { error: "This household has no Vault folder yet, so there is nowhere to put the package." };
  const token = await getServiceGoogleAccessToken(db);
  const advisor = await driveFindFolder(hh.vault_folder_id, ADVISOR_FILES, token);
  if (!advisor) return { error: "I could not find this household's Advisor Files folder." };
  const packages = await driveEnsureFolder(advisor, AUDIT_PACKAGES, token);
  const today = ymd();
  const folderName = `${f.title} (${today})`.replace(/[\\/]/g, "-").slice(0, 120);
  const mk = await fetch(`${DRIVE}/files?supportsAllDrives=true&fields=id,webViewLink`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: folderName, mimeType: "application/vnd.google-apps.folder", parents: [packages] }), signal: sig() });
  if (!mk.ok) return { error: `Could not create the package folder (${mk.status}).` };
  const folder = await mk.json();

  const rows: IndexInput["rows"] = [];
  const failed: string[] = [];
  const required = new Set(checklistFor(f.kind).map((c) => c.kind));
  let n = 0;
  for (const c of CHECKLIST) {
    const mine = ((items ?? []) as any[]).filter((i) => i.kind === c.kind);
    if (!mine.length) { if (required.has(c.kind)) rows.push({ label: c.label, required: true, status: "missing", evidence: "", url: null, addedYmd: null, addedBy: null, note: null }); continue; }
    for (const it of mine) {
      if (it.status === "not_applicable") { rows.push({ label: c.label, required: required.has(c.kind), status: "not_applicable", evidence: "Marked not applicable", url: null, addedYmd: ymd(new Date(it.added_at)), addedBy: it.added_by, note: it.note }); continue; }
      let url = it.drive_url as string | null, name = it.drive_name as string;
      try {
        n++;
        const cp = await fetch(`${DRIVE}/files/${it.drive_file_id}/copy?supportsAllDrives=true&fields=id,name,webViewLink`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: `${String(n).padStart(2, "0")} ${c.label}: ${it.drive_name}`.slice(0, 180), parents: [folder.id] }), signal: sig() });
        if (cp.ok) { const j = await cp.json(); url = j.webViewLink ?? url; name = j.name ?? name; } else failed.push(`${c.label} (${cp.status})`);
      } catch { failed.push(c.label); }
      rows.push({ label: c.label, required: required.has(c.kind), status: "provided", evidence: name, url, addedYmd: ymd(new Date(it.added_at)), addedBy: it.added_by, note: it.note });
    }
  }
  const st = fileStatus(f.kind, items ?? []);
  const html = indexHtml({ title: f.title, kindLabel: KIND_LABEL[f.kind as FileKind], household: hh.label ?? "Household", client: contact?.full_name ?? null, policy: policy ? [policy.carrier, String(policy.policy_type).replace(/_/g, " "), policy.policy_number].filter(Boolean).join(", ") : null, openedYmd: ymd(new Date(f.opened_at)), createdYmd: today, createdBy: who, rows, complete: st.complete });
  const doc = await driveCreateDoc(`00 Index: ${f.title}`, folder.id, html, token);
  await db.from("insurance_files").update({ package_folder_id: folder.id, package_url: folder.webViewLink ?? `https://drive.google.com/drive/folders/${folder.id}`, packaged_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...(st.complete ? { status: "complete", closed_at: new Date().toISOString() } : {}) }).eq("id", fileId);
  return { ok: true, url: folder.webViewLink ?? `https://drive.google.com/drive/folders/${folder.id}`, indexUrl: doc.url, complete: st.complete, missing: st.missing.map((m) => m.label), copyFailures: failed };
}

/** Each morning: for open files older than a week with required items missing, one task for Rolf (at most one a week per file). */
export async function checkOpenFiles(db: any): Promise<string[]> {
  const out: string[] = [];
  const rolf = await resolveUserIdByEmail(db, ADMIN_INBOX_EMAIL);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: files } = await db.from("insurance_files").select("id, household_id, contact_id, title, kind, last_nudged_at, opened_at").eq("status", "open").lte("opened_at", weekAgo);
  for (const f of (files ?? []) as any[]) {
    if (f.last_nudged_at && f.last_nudged_at > weekAgo) continue;
    const { data: items } = await db.from("insurance_file_items").select("kind, status").eq("file_id", f.id);
    const st = fileStatus(f.kind, items ?? []);
    if (st.complete) continue;
    const { data: hh } = await db.from("households").select("family_id").eq("id", f.household_id).maybeSingle();
    const list = st.missing.map((m) => m.label).join(", ");
    await db.from("pm_tasks").insert({ title: `Insurance file: ${f.title}: ${st.missing.length} item${st.missing.length === 1 ? "" : "s"} missing`, description: `Required for the ${KIND_LABEL[f.kind as FileKind].toLowerCase()} file and not yet in it: ${list}.\n\nAdd each on the household page under Insurance files (paste the Drive link, attach a meeting record, or mark it not applicable). When every item is in, create the audit package.`, status: "open", client_visible: false, assignee_id: rolf, created_by: rolf, household_id: f.household_id, family_id: hh?.family_id ?? null, contact_id: f.contact_id ?? null, due_date: ymd(new Date(Date.now() + 7 * 86_400_000)) });
    await db.from("insurance_files").update({ last_nudged_at: new Date().toISOString() }).eq("id", f.id);
    out.push(`${f.title}: ${st.missing.length} missing`);
  }
  return out;
}
