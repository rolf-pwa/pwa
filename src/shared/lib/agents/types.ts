/**
 * Agent adapter contracts (Phase 2 of the modular monolith).
 *
 * The UI never talks to an agent directly — it talks to one of these
 * interfaces. Today's implementations proxy our edge functions; tomorrow they
 * can point at Cloud Run without any UI change.
 */

export interface IntakeUpload {
  fileName?: string;
  folderName?: string;
  createdAt?: string;
  classification?: {
    status?: string;
    category?: string;
    typeTag?: string;
    identifier?: string;
  } | null;
}

export interface IntakeChecklistItem {
  name: string;
  category?: string | null;
  ownerInitials?: string | null;
  subType?: string | null;
  status?: string | null;
  receivedCount?: number;
  requirement?: "required" | "optional" | null;
}

export interface IntakeAuditSummary {
  track?: "PERSONAL" | "CORPORATE";
  criticalTotal?: number;
  criticalSatisfied?: number;
  total?: number;
  satisfiedTotal?: number;
  percent?: number;
  criticalComplete?: boolean;
  processing?: number;
  missingCritical?: string[];
  missingRecommended?: string[];
}

export interface IntakeManifest {
  enabled: boolean;
  ready?: boolean;
  status?: string;
  familyName?: string;
  householdName?: string;
  /** Set once the client has explicitly finished all 4 onboarding steps — not
   *  just the document checklist, which can read "complete" for an existing
   *  client whose Vault was already stocked before they even started step 1. */
  onboardingCompletedAt?: string | null;
  completion?: {
    status?: "not_started" | "in_progress" | "complete";
    expectedItems?: number;
    uploadedFiles?: number;
    percent?: number;
    lastUploadAt?: string;
    classification?: {
      pending?: number;
      filed?: number;
      needsReview?: number;
      failed?: number;
    };
    audit?: IntakeAuditSummary | null;
  } | null;
  checklist?: IntakeChecklistItem[];
  uploads?: IntakeUpload[];
  limits?: { maxBytes?: number; allowedTypes?: string[] } | null;
}

/** Portal-scoped credentials handed to an agent call. */
export interface AgentContext {
  portalToken: string;
}

export interface UploadHandlers {
  onProgress?: (percent: number) => void;
}

export interface UploadResult {
  ok: boolean;
  error?: string;
}

export interface IOnboardingAgentProvider {
  /** Stable id for logging/diagnostics. */
  readonly id: string;
  getManifest(ctx: AgentContext): Promise<IntakeManifest>;
  uploadDocument(ctx: AgentContext, file: File, handlers?: UploadHandlers): Promise<UploadResult>;
}

/** @deprecated Use IOnboardingAgentProvider. Kept for backward compatibility. */
export type IIntakeAgentProvider = IOnboardingAgentProvider;

/** Stage of the staged Onboarding -> Audit -> VFO flow. */
export type AuditStage = "intake" | "audit" | "vfo";

export interface AuditState {
  stage: AuditStage;
  /** True once the audit agent has produced a reviewable result. */
  ready: boolean;
  percent: number;
  track?: "PERSONAL" | "CORPORATE";
  missingCritical?: string[];
  note?: string;
}

export interface IAuditAgentProvider {
  readonly id: string;
  getState(ctx: AgentContext): Promise<AuditState>;
}

export interface LibrarianEntry {
  id: string;
  name: string;
  mimeType?: string | null;
  size?: number | null;
  modifiedAt?: string | null;
  isFolder?: boolean;
}

export interface ILibrarianProvider {
  readonly id: string;
  listFolder(ctx: AgentContext, folderId?: string): Promise<LibrarianEntry[]>;
  getDownloadUrl(ctx: AgentContext, fileId: string): Promise<string | null>;
}

/** Result of an AI invoice draft. Nothing is sent until an advisor approves. */
export interface InvoiceDraftResult {
  ok: boolean;
  invoiceId: string;
  contact?: { id: string; full_name: string } | null;
  total?: number;
  lineCount?: number;
  needsContact?: boolean;
}

export interface IInvoiceAgentProvider {
  readonly id: string;
  /** Drafts an invoice from a plain-language prompt (status stays `draft`). */
  draftInvoice(prompt: string): Promise<InvoiceDraftResult>;
  /** Advisor-approved send: pushes to Square and emails the client. */
  sendInvoice(invoiceId: string): Promise<{ ok: boolean; publicUrl?: string; status?: string }>;
  refreshInvoice(invoiceId: string): Promise<{ ok: boolean; status?: string }>;
  cancelInvoice(invoiceId: string): Promise<{ ok: boolean }>;
  /** Interac e-Transfer: issue the invoice without charging a card. */
  markSentManually(invoiceId: string): Promise<{ ok: boolean; status?: string }>;
  /** Interac e-Transfer: advisor confirms funds landed; records payment + revenue. */
  markPaidManually(invoiceId: string, reference?: string): Promise<{ ok: boolean; status?: string }>;
  /** Permanent removal. Paid invoices are refused server-side. */
  deleteInvoice(invoiceId: string): Promise<{ ok: boolean }>;

  syncService(serviceId: string): Promise<{ ok: boolean; squareId?: string }>;
  /** Permanent removal. Services with bookings attached are refused server-side. */
  deleteService(serviceId: string): Promise<{ ok: boolean }>;
  getStatus(): Promise<{ configured: boolean; environment: string }>;
}

export interface PmProject {
  id: string;
  name: string;
  description: string | null;
  status: string;
  household_id: string | null;
  contact_id: string | null;
  corporation_id: string | null;
  family_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PmTask {
  id: string;
  project_id: string | null;
  parent_task_id: string | null;
  title: string;
  description: string | null;
  status: string;
  due_date: string | null;
  assignee_id: string | null;
  household_id: string | null;
  contact_id: string | null;
  corporation_id: string | null;
  family_id: string | null;
  completed_at: string | null;
  client_visible: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PmTaskComment {
  id: string;
  task_id: string;
  author_id: string;
  author_professional_id?: string | null;
  body: string;
  created_at: string;
}

export interface PmTaskCollaborator {
  id: string;
  task_id: string;
  professional_id: string | null;
  contact_id: string | null;
  tagged_by: string | null;
  created_at: string;
  professionals?: { id: string; full_name: string; firm: string | null; professional_type: string } | null;
  contacts?: { id: string; first_name: string; last_name: string | null } | null;
}

export interface PmTaskFilter {
  project_id?: string;
  /** Pass "me" to resolve to the calling staff member. */
  assignee_id?: string;
  household_id?: string;
  contact_id?: string;
  corporation_id?: string;
  family_id?: string;
  status?: string;
  parent_task_id?: string;
  professional_id?: string;
}

export interface ITaskAgentProvider {
  readonly id: string;
  listProjects(): Promise<PmProject[]>;
  createProject(input: {
    name: string;
    description?: string;
    status?: string;
    household_id?: string;
    contact_id?: string;
    corporation_id?: string;
    family_id?: string;
  }): Promise<PmProject>;
  updateProject(id: string, updates: Partial<PmProject>): Promise<PmProject>;
  listTasks(filter?: PmTaskFilter): Promise<PmTask[]>;
  createTask(input: {
    title: string;
    description?: string;
    project_id?: string;
    parent_task_id?: string;
    due_date?: string;
    assignee_id?: string;
    household_id?: string;
    contact_id?: string;
    corporation_id?: string;
    family_id?: string;
    client_visible?: boolean;
  }): Promise<PmTask>;
  updateTask(
    id: string,
    updates: Partial<Pick<PmTask, "title" | "description" | "status" | "due_date" | "assignee_id" | "client_visible" | "family_id">>,
  ): Promise<PmTask>;
  getTaskComments(taskId: string): Promise<PmTaskComment[]>;
  postTaskComment(taskId: string, body: string): Promise<PmTaskComment>;
  listTaskCollaborators(taskId: string): Promise<PmTaskCollaborator[]>;
  tagProfessional(taskId: string, professionalId: string): Promise<PmTaskCollaborator>;
  untagProfessional(taskId: string, professionalId: string): Promise<void>;
  tagContact(taskId: string, contactId: string): Promise<PmTaskCollaborator>;
  untagContact(taskId: string, contactId: string): Promise<void>;
}
