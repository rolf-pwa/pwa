// Classifies a file sitting in a household's Vault "Shoebox" (the client
// upload inbox) so vault-service can propose a rename + destination folder
// for staff to approve -- never applied automatically. Mirrors
// governance-audit-generate's PDF-to-Vertex extraction pattern.

import { generateVertexContent, type ServiceAccountKey, type VertexContent, modelFromEnv, withThinking } from "./vertex-ai.ts";
import { buildProposedFilename, normalizePersonName, resolvePrimaryAdultName } from "./vault-shoebox-naming.ts";

// Migrated ahead of the global Flash tier after a 17-document A/B (photos,
// scans, a blank page, a non-document image, a French slip, a real scanned
// will, and a prompt-injection "grocery list"): 3.5 Flash at thinking
// "minimal" matched 2.5 on every document, ignored the injection, was
// identical across 3 runs, ran in ~2.4s vs ~4.5s, and filed the Sovereignty
// Charter to Charter Sources where 2.5 called it a TrustDeed. Roll back with
// no redeploy by setting secret SHOEBOX_CLASSIFY_MODEL=gemini-2.5-flash.
const MODEL = modelFromEnv("SHOEBOX_CLASSIFY_MODEL", "gemini-3.5-flash");

export const SHOEBOX_SUPPORTED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/heic",
  "image/webp",
]);

// Stay well under Vertex's ~20MB inline-request cap (same bound governance-audit-generate uses).
export const MAX_SHOEBOX_FILE_BYTES = 15 * 1024 * 1024;

const DOCUMENT_TYPES = [
  "DriversLicense", "Passport", "SIN_Card", "BirthCertificate", "MarriageCertificate", "DivorceDecree",
  "Will", "PowerOfAttorney", "RepresentationAgreement", "TrustDeed",
  "T4", "T5", "TaxReturn", "NoticeOfAssessment",
  "InsurancePolicy", "InsuranceStatement",
  "BankStatement", "InvestmentStatement", "AccountStatement",
  "MortgageStatement", "PropertyDeed", "PropertyAssessment",
  "ShareholderAgreement", "CorporateMinuteBook", "ArticlesOfIncorporation",
  "CorrespondenceLetter",
  "Other",
] as const;

// Real vault_folder_templates slugs -- the model is told to pick one of
// these (or omit the field) rather than invent a category; vault-service
// re-validates the returned value against the live, active rows before
// ever using it.
const CATEGORY_SLUGS = [
  "identity-legal", "estate", "tax", "insurance", "investments",
  "real-estate", "business", "charter-sources", "quarterly-reviews",
  "correspondence", "from-collaborators",
] as const;

const SHOEBOX_TOOL_SCHEMA = {
  functionDeclarations: [
    {
      name: "classify_shoebox_file",
      description: "Classify a client-uploaded document sitting in a Vault Shoebox inbox, for staff review before filing.",
      parameters: {
        type: "OBJECT",
        properties: {
          document_type: {
            type: "STRING",
            enum: DOCUMENT_TYPES as unknown as string[],
            description: "The single best-fitting document type. Use 'Other' only if nothing else fits.",
          },
          other_label: {
            type: "STRING",
            description: "A short (1-3 word) label, only when document_type is 'Other'.",
          },
          document_date: {
            type: "STRING",
            description: "ISO date (YYYY-MM-DD) the document itself is dated -- a statement date, date signed, issue date, etc. Omit entirely if the document does not clearly state one; never guess.",
          },
          document_subject_first_name: {
            type: "STRING",
            description: "The first name of the person this document is ABOUT (e.g. whose driver's license or tax return it is), if stated on the document. Omit if not determinable.",
          },
          document_subject_last_name: {
            type: "STRING",
            description: "The last name of the person this document is ABOUT. Omit if not determinable.",
          },
          account_number: {
            type: "STRING",
            description: "For statements, insurance policies, mortgages and similar account-based documents: the account, policy or contract number exactly as printed. Omit for documents that have none, and never guess or combine numbers.",
          },
          proposed_category_slug: {
            type: "STRING",
            enum: CATEGORY_SLUGS as unknown as string[],
            description: "Which Vault category this document belongs in. Omit entirely if you are not confident -- it is safe to leave a file in the Shoebox for a human to file by hand.",
          },
        },
        required: ["document_type"],
      },
    },
  ],
};

const PROMPT = `The attached file was uploaded by a client into their document Shoebox -- a holding inbox for \
documents staff haven't yet filed. Read it and classify it so staff can review a suggested filename and \
filing destination before anything is changed.

Rules:
- Pick exactly one document_type. Only use "Other" if none of the listed types genuinely fit, and give a \
short other_label in that case.
- Only set document_date if the document itself clearly states one (a statement period end date, a date \
signed, an issue date). Never infer or guess a date that isn't actually printed on the document.
- Only set document_subject_first_name/last_name if a person's name is clearly printed on the document as \
its subject (the account holder, the testator, the license holder, etc.).
- Only set account_number if an account, policy or contract number is clearly printed on the document \
as belonging to it (statements, policies, mortgages). If several accounts appear, use the one the document is \
mainly about, and omit it if unclear.
- Only set proposed_category_slug if you're confident; omitting it is the safe choice and just leaves the \
file in the Shoebox for a staff member to file manually.`;

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export interface ShoeboxClassification {
  document_type: string;
  other_label: string | null;
  document_date: string | null;
  document_subject_first_name: string | null;
  document_subject_last_name: string | null;
  account_number: string | null;
  proposed_category_slug: string | null;
}

/** Returns null (no proposal, not an error) for unsupported/oversized files -- staff triages those by hand. */
export async function classifyShoeboxFile(
  sa: ServiceAccountKey,
  fileBytes: ArrayBuffer,
  mimeType: string,
  fileName: string,
): Promise<ShoeboxClassification | null> {
  if (!SHOEBOX_SUPPORTED_MIME.has(mimeType)) return null;
  if (fileBytes.byteLength > MAX_SHOEBOX_FILE_BYTES) return null;

  const contents: VertexContent[] = [
    {
      role: "user",
      parts: [
        { text: `${PROMPT}\n\nOriginal filename: ${fileName}` },
        { inlineData: { mimeType, data: arrayBufferToBase64(fileBytes) } },
      ],
    },
  ];
  const result = await generateVertexContent(
    sa,
    MODEL,
    contents,
    withThinking(MODEL, { temperature: 0, maxOutputTokens: 1024 }, "minimal"),
    { tools: [SHOEBOX_TOOL_SCHEMA], toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["classify_shoebox_file"] } } },
  );
  // deno-lint-ignore no-explicit-any
  const parts = result?.candidates?.[0]?.content?.parts as any[] | undefined;
  const call = parts?.find((p) => p.functionCall)?.functionCall;
  if (!call || call.name !== "classify_shoebox_file") return null;
  const args = call.args ?? {};
  return {
    document_type: args.document_type ?? "Other",
    other_label: args.other_label ?? null,
    document_date: args.document_date ?? null,
    document_subject_first_name: normalizePersonName(args.document_subject_first_name),
    document_subject_last_name: normalizePersonName(args.document_subject_last_name),
    account_number: typeof args.account_number === "string" && args.account_number.trim() ? args.account_number.trim() : null,
    proposed_category_slug: args.proposed_category_slug ?? null,
  };
}


// Re-exported so vault-service keeps importing everything from one module.
export { buildProposedFilename, resolvePrimaryAdultName };
