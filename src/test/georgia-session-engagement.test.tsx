import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { isBotUserAgent } from "../../supabase/functions/_shared/bot-detection";

describe("isBotUserAgent", () => {
  it("flags well-known crawlers and link-preview bots", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; Baiduspider-render/2.0; +http://www.baidu.com/search/spider.html)",
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
      "Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)",
      "Mozilla/5.0 (compatible; PetalBot; +https://webmaster.petalsearch.com/site/petalbot)",
      "facebookexternalhit/1.1",
      "WhatsApp/2.23.20.0",
      "Twitterbot/1.0",
    ]) {
      expect(isBotUserAgent(ua), ua).toBe(true);
    }
  });

  it("does not flag ordinary browser user agents", () => {
    for (const ua of [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    ]) {
      expect(isBotUserAgent(ua), ua).toBe(false);
    }
    expect(isBotUserAgent(null)).toBe(false);
    expect(isBotUserAgent(undefined)).toBe(false);
    expect(isBotUserAgent("")).toBe(false);
  });
});

describe("Georgia session-tracker engagement gate", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    // Each test below dynamically re-imports session-tracker.ts, which
    // registers its own window-level engagement listeners at import time --
    // on a real page there is only ever one such instance for the page's
    // whole life, but resetModules() leaves any earlier test's still-
    // unengaged instance attached to this shared jsdom window. Drain it with
    // a throwaway interaction before each test installs its own fetch spy,
    // so a straggler's belated flush never pollutes the next test's count.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    window.dispatchEvent(new Event("keydown"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not create/update the session row before the visit is engaged", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchFn);
    const { bindGeorgia2Session, trackGeorgia2 } = await import("@/modules/intake/lib/session-tracker");
    bindGeorgia2Session("zz-test-engage-a");
    trackGeorgia2({ final_phase: "chat" });
    // Past the 700ms debounce, well short of the engagement dwell.
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("flushes once the tab has stayed visible for the dwell period, with no interaction", async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchFn);
    const { bindGeorgia2Session, trackGeorgia2 } = await import("@/modules/intake/lib/session-tracker");
    bindGeorgia2Session("zz-test-engage-b");
    trackGeorgia2({ final_phase: "chat" });
    await vi.advanceTimersByTimeAsync(2600);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchFn.mock.calls[0][1]?.body as string);
    expect(body.session_key).toBe("zz-test-engage-b");
  });

  it("flushes right away on a real interaction, without waiting for the dwell period", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchFn);
    const { bindGeorgia2Session, trackGeorgia2 } = await import("@/modules/intake/lib/session-tracker");
    bindGeorgia2Session("zz-test-engage-c");
    trackGeorgia2({ final_phase: "chat" });
    window.dispatchEvent(new Event("keydown"));
    // Just past the 700ms debounce; nowhere near the 2500ms dwell.
    await vi.advanceTimersByTimeAsync(750);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("a bot that renders the page and leaves without interacting never sends anything, on exit either", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchFn);
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { ...navigator, sendBeacon });
    const { useGeorgia2ExitBeacon } = await import("@/modules/intake/lib/session-tracker");
    function Harness() {
      useGeorgia2ExitBeacon(() => ({ final_phase: "chat" }), "zz-test-engage-d");
      return null;
    }
    render(<Harness />);
    // The bot leaves almost immediately -- well before the dwell period.
    await vi.advanceTimersByTimeAsync(200);
    window.dispatchEvent(new Event("pagehide"));
    expect(fetchFn).not.toHaveBeenCalled();
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("a real visitor's exit is recorded once they've engaged", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchFn);
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { ...navigator, sendBeacon });
    const { useGeorgia2ExitBeacon } = await import("@/modules/intake/lib/session-tracker");
    function Harness() {
      useGeorgia2ExitBeacon(() => ({ final_phase: "chat" }), "zz-test-engage-e");
      return null;
    }
    render(<Harness />);
    window.dispatchEvent(new Event("keydown"));
    await vi.advanceTimersByTimeAsync(750);
    expect(fetchFn).toHaveBeenCalledTimes(1); // the initial ping
    window.dispatchEvent(new Event("pagehide"));
    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });
});
