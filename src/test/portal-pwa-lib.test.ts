import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { fitOnPage, isIos, pushNeedsInstall, toSubscriptionJson, urlBase64ToUint8Array } from "../modules/portal/lib/pwa";
import { jpegPagesToPdf } from "../modules/portal/lib/scanPdf";

// Smallest valid 1x1 JPEG.
const JPEG_1X1 = Uint8Array.from(atob("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="), (c) => c.charCodeAt(0));

describe("urlBase64ToUint8Array", () => {
  it("decodes base64url with and without padding", () => {
    expect(Array.from(urlBase64ToUint8Array("aGk"))).toEqual([104, 105]);
    expect(Array.from(urlBase64ToUint8Array("_-8"))).toEqual([255, 239]);
  });
});

describe("toSubscriptionJson", () => {
  it("accepts a complete subscription and rejects incomplete ones", () => {
    const ok = { toJSON: () => ({ endpoint: "https://x", keys: { p256dh: "a", auth: "b" } }) };
    expect(toSubscriptionJson(ok)).toEqual({ endpoint: "https://x", keys: { p256dh: "a", auth: "b" } });
    expect(toSubscriptionJson({ toJSON: () => ({ endpoint: "https://x" }) })).toBeNull();
  });
});

describe("iOS install gate", () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";
  it("only blocks push on iOS outside the installed app", () => {
    expect(isIos(iphone)).toBe(true);
    expect(pushNeedsInstall(iphone, false)).toBe(true);
    expect(pushNeedsInstall(iphone, true)).toBe(false);
    expect(pushNeedsInstall("Mozilla/5.0 (Windows NT 10.0)", false)).toBe(false);
  });
});

describe("fitOnPage", () => {
  it("keeps aspect ratio, stays inside the margin and centres", () => {
    const r = fitOnPage(3000, 4000);
    expect(r.width / r.height).toBeCloseTo(0.75, 5);
    expect(r.x).toBeGreaterThanOrEqual(24); expect(r.y).toBeGreaterThanOrEqual(24);
    expect(r.x + r.width).toBeLessThanOrEqual(595.28 - 24 + 1e-6);
    expect(r.y + r.height).toBeLessThanOrEqual(841.89 - 24 + 1e-6);
    expect(r.x).toBeCloseTo((595.28 - r.width) / 2, 5);
  });
});

describe("jpegPagesToPdf", () => {
  it("builds one A4 page per image", async () => {
    const bytes = await jpegPagesToPdf([{ bytes: JPEG_1X1, width: 1, height: 1 }, { bytes: JPEG_1X1, width: 1, height: 1 }]);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getSize().width).toBeCloseTo(595.28, 1);
  });
  it("refuses an empty scan", async () => {
    await expect(jpegPagesToPdf([])).rejects.toThrow(/No pages/);
  });
});
