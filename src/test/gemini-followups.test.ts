import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  accountSuffix,
  autoFileBlocker,
  buildProposedFilename,
  normalizePersonName,
  resolvePrimaryAdultName,
} from "../../supabase/functions/_shared/vault-shoebox-naming";
import { deriveChoiceMatchesProfile } from "../../supabase/functions/_shared/investor-profile";
import { fetchWithVertexRetry } from "../../supabase/functions/_shared/vertex-retry";

describe("normalizePersonName", () => {
  it("title-cases ALL CAPS values copied off a document", () => {
    expect(normalizePersonName("GENEVA")).toBe("Geneva");
    expect(normalizePersonName("LIVELY-LAMBERT")).toBe("Lively-Lambert");
    expect(normalizePersonName("O'BRIEN")).toBe("O'Brien");
    expect(normalizePersonName("VAN DER BERG")).toBe("Van Der Berg");
    expect(normalizePersonName("MCDONALD")).toBe("McDonald");
  });

  it("leaves mixed-case values exactly as given", () => {
    expect(normalizePersonName("McDonald")).toBe("McDonald");
    expect(normalizePersonName("de la Cruz")).toBe("de la Cruz");
    expect(normalizePersonName("Lively-Lambert")).toBe("Lively-Lambert");
  });

  it("returns null for empty input", () => {
    expect(normalizePersonName(null)).toBeNull();
    expect(normalizePersonName(undefined)).toBeNull();
    expect(normalizePersonName("   ")).toBeNull();
  });
});

describe("buildProposedFilename", () => {
  const base = {
    documentDate: "2024-03-15",
    uploadedAt: new Date("2026-10-01T12:00:00Z"),
    lastName: "Santos",
    firstInitial: "Charissa",
    documentTypeLabel: "DriversLicense",
    originalExt: ".pdf",
  };

  it("follows YY-MM-DD_LastName_FirstInitial-DocumentType.ext", () => {
    expect(buildProposedFilename(base)).toBe("24-03-15_Santos_C-DriversLicense.pdf");
  });

  it("falls back to the upload date when the document has none", () => {
    expect(buildProposedFilename({ ...base, documentDate: null })).toBe("26-10-01_Santos_C-DriversLicense.pdf");
  });

  it("strips punctuation and spaces from every token", () => {
    expect(
      buildProposedFilename({ ...base, lastName: "Lively-Lambert", documentTypeLabel: "Test Memo!" }),
    ).toBe("24-03-15_LivelyLambert_C-TestMemo.pdf");
  });

  it("appends the last 4 of the account number, and nothing when absent or too short", () => {
    expect(buildProposedFilename({ ...base, documentTypeLabel: "InvestmentStatement", accountNumber: "1819479981" })).toBe("24-03-15_Santos_C-InvestmentStatement_9981.pdf");
    expect(buildProposedFilename({ ...base, accountNumber: null })).toBe("24-03-15_Santos_C-DriversLicense.pdf");
    expect(buildProposedFilename({ ...base, accountNumber: "12" })).toBe("24-03-15_Santos_C-DriversLicense.pdf");
    expect(accountSuffix("RRSP-ab 12-34")).toBe("1234");
  });

  it("uses safe placeholders when names are empty", () => {
    expect(buildProposedFilename({ ...base, lastName: "", firstInitial: "" })).toBe("24-03-15_Client_X-DriversLicense.pdf");
  });
});

describe("resolvePrimaryAdultName", () => {
  it("prefers head_of_family, then spouse, then anyone", () => {
    const contacts = [
      { first_name: "Kid", last_name: "Testwell", family_role: "child" },
      { first_name: "Sam", last_name: "Testwell", family_role: "spouse" },
      { first_name: "Jordan", last_name: "Testwell", family_role: "head_of_family" },
    ];
    expect(resolvePrimaryAdultName(contacts)).toEqual({ firstName: "Jordan", lastName: "Testwell" });
    expect(resolvePrimaryAdultName(contacts.slice(0, 2))).toEqual({ firstName: "Sam", lastName: "Testwell" });
    expect(resolvePrimaryAdultName(contacts.slice(0, 1))).toEqual({ firstName: "Kid", lastName: "Testwell" });
    expect(resolvePrimaryAdultName([])).toBeNull();
  });
});

describe("deriveChoiceMatchesProfile", () => {
  it("is true when the stated choice names the profile category (the case the model got wrong)", () => {
    expect(deriveChoiceMatchesProfile("Growth", "Growth portfolio", false)).toBe(true);
    expect(deriveChoiceMatchesProfile("growth", "GROWTH", null)).toBe(true);
  });

  it("is false when the stated choice names a different single category", () => {
    expect(deriveChoiceMatchesProfile("Growth", "Balanced portfolio", true)).toBe(false);
    expect(deriveChoiceMatchesProfile("Prudent", "Aggressive", true)).toBe(false);
  });

  it("falls back to the model when the choice is ambiguous or unrecognised", () => {
    expect(deriveChoiceMatchesProfile("Growth", "Balanced growth portfolio", true)).toBe(true);
    expect(deriveChoiceMatchesProfile("Growth", "Balanced growth portfolio", false)).toBe(false);
    expect(deriveChoiceMatchesProfile("Growth", "Custom blend", null)).toBeNull();
  });

  it("falls back to the model when either side is missing or the category is unknown", () => {
    expect(deriveChoiceMatchesProfile(null, "Growth", true)).toBe(true);
    expect(deriveChoiceMatchesProfile("Growth", null, null)).toBeNull();
    expect(deriveChoiceMatchesProfile("Whatever", "Growth", false)).toBe(false);
  });

  it("does not match category words embedded in other words", () => {
    expect(deriveChoiceMatchesProfile("Growth", "Outgrowth strategy", null)).toBeNull();
  });
});

describe("fetchWithVertexRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const res = (status: number, headers: Record<string, string> = {}) => new Response("x", { status, headers });

  it("returns immediately on success without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200));
    vi.stubGlobal("fetch", fetchMock);
    const out = await fetchWithVertexRetry("https://x", {});
    expect(out.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries 429 and 503 then succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(res(429)).mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(200));
    vi.stubGlobal("fetch", fetchMock);
    const promise = fetchWithVertexRetry("https://x", {});
    await vi.runAllTimersAsync();
    expect((await promise).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after three retries and returns the last response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(429));
    vi.stubGlobal("fetch", fetchMock);
    const promise = fetchWithVertexRetry("https://x", {});
    await vi.runAllTimersAsync();
    expect((await promise).status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not retry other errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(400));
    vi.stubGlobal("fetch", fetchMock);
    expect((await fetchWithVertexRetry("https://x", {})).status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("honors Retry-After but caps the wait at 15s", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(res(429, { "retry-after": "600" })).mockResolvedValueOnce(res(200));
    vi.stubGlobal("fetch", fetchMock);
    const promise = fetchWithVertexRetry("https://x", {});
    await vi.advanceTimersByTimeAsync(14_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await promise).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("fetchWithVertexRetry maxRetries", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("caps retries for tight-deadline callers", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response("x", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const promise = fetchWithVertexRetry("https://x", {}, { maxRetries: 1 });
    await vi.runAllTimersAsync();
    expect((await promise).status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maxRetries 0 never retries", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response("x", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await fetchWithVertexRetry("https://x", {}, { maxRetries: 0 })).status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("autoFileBlocker", () => {
  const ok = { documentType: "InvestmentStatement", documentDate: "2026-09-30", subjectFirstName: "Colleen", subjectLastName: "Jerczynski", accountNumber: "1819071078", categorySlug: "investments" };
  it("allows a fully-read statement", () => expect(autoFileBlocker(ok)).toBeNull());
  it("allows tax slips without an account number", () => expect(autoFileBlocker({ ...ok, documentType: "T4", accountNumber: null, categorySlug: "tax" })).toBeNull());
  it("always sends identity, legal and other documents to staff", () => {
    for (const t of ["DriversLicense", "Will", "TrustDeed", "CorrespondenceLetter", "Other"]) expect(autoFileBlocker({ ...ok, documentType: t })).not.toBeNull();
  });
  it("requires everything to be read off the document", () => {
    expect(autoFileBlocker({ ...ok, documentDate: null })).toMatch(/date/);
    expect(autoFileBlocker({ ...ok, subjectLastName: null })).toMatch(/name/);
    expect(autoFileBlocker({ ...ok, categorySlug: null })).toMatch(/category/);
    expect(autoFileBlocker({ ...ok, accountNumber: "12" })).toMatch(/account number/);
  });
});
