import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanProfile, isStale, loadVoice, MAX_VOICE_CHARS, voiceBlock, VOICE_REFRESH_MS, WRITTEN_RULES } from "../../supabase/functions/_shared/voice-profile";

const token = async () => "tok";

const NOW = new Date("2026-10-19T17:00:00Z");

/** A database stub holding the one voice_profile row. */
function db(row: { doc_id: string; content: string; fetched_at: string | null } | null) {
  const updates: object[] = [];
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: row }), update: (v: object) => { updates.push(v); return chain; } };
  return { client: { from: () => chain } as any, updates };
}

describe("voice profile", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("tidies the Doc's text and bounds it", () => {
    expect(cleanProfile("  \n\n\nHello  \n\n\n\nWorld\n⁂\n")).toBe("Hello\n\nWorld");
    expect(cleanProfile("x".repeat(MAX_VOICE_CHARS + 500))).toHaveLength(MAX_VOICE_CHARS);
  });

  it("is stale with no fetch time or after a day, fresh before", () => {
    expect(isStale(null, NOW)).toBe(true);
    expect(isStale(new Date(NOW.getTime() - VOICE_REFRESH_MS - 1000).toISOString(), NOW)).toBe(true);
    expect(isStale(new Date(NOW.getTime() - 60_000).toISOString(), NOW)).toBe(false);
  });

  it("adds nothing without a profile, and rules plus the profile with one", () => {
    expect(voiceBlock("   ")).toBe("");
    const b = voiceBlock("Warm and plain.");
    expect(b).toContain(WRITTEN_RULES);
    expect(b).toContain("Warm and plain.");
    expect(WRITTEN_RULES).toMatch(/no "um"/);
  });

  it("uses the saved copy without touching Drive while it is fresh", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const { client } = db({ doc_id: "d", content: "Saved voice", fetched_at: new Date(NOW.getTime() - 3600_000).toISOString() });
    expect(await loadVoice(client, token, NOW)).toContain("Saved voice");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes a stale copy from Drive and saves it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => "Fresh voice from the Doc" })));
    const { client, updates } = db({ doc_id: "d", content: "Old", fetched_at: null });
    expect(await loadVoice(client, token, NOW)).toContain("Fresh voice from the Doc");
    expect(updates[0]).toMatchObject({ content: "Fresh voice from the Doc" });
  });

  it("keeps the last copy when Drive fails, and never throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, text: async () => "" })));
    const { client } = db({ doc_id: "d", content: "Old voice", fetched_at: null });
    expect(await loadVoice(client, token, NOW)).toContain("Old voice");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await loadVoice(client, token, NOW)).toContain("Old voice");
  });

  it("returns nothing when there is no row or the database fails", async () => {
    expect(await loadVoice(db(null).client, token, NOW)).toBe("");
    expect(await loadVoice({ from: () => { throw new Error("db down"); } } as any, token, NOW)).toBe("");
  });
});
