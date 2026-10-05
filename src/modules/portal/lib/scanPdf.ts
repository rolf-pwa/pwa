import { PDFDocument } from "pdf-lib";
import { fitOnPage } from "./pwa";

/** One A4 page per captured JPEG, in order. Pure bytes in, bytes out, so it's testable without a browser. */
export async function jpegPagesToPdf(pages: Array<{ bytes: Uint8Array; width: number; height: number }>): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error("No pages to send");
  const doc = await PDFDocument.create();
  for (const p of pages) {
    const img = await doc.embedJpg(p.bytes);
    const page = doc.addPage([595.28, 841.89]);
    const r = fitOnPage(p.width, p.height);
    page.drawImage(img, { x: r.x, y: r.y, width: r.width, height: r.height });
  }
  return doc.save();
}
