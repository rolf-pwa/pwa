// simple-pdf.ts: a small PDF writer for ProsperWise documents built on the server (the signed copy of a document, and the reports that follow). It has the
// house look of the Sovereignty Charter and Transition Map: a slate header band with the white logo, a small uppercase line, a serif title, a bronze
// rule, slate body text and a bronze footer bar. Standard fonts only (Helvetica and Times, Latin-1 plus the usual curly quotes and dashes); anything else
// prints as "?". US Letter, wrapped text, paginated. Pure: no Deno APIs.
import { LOGO_ALPHA_FLATE_B64, LOGO_H, LOGO_W } from "./brand-logo.ts";

export type Block =
  | { kind: "h"; text: string }
  | { kind: "p"; text: string; bold?: boolean; small?: boolean }
  | { kind: "gap"; h?: number }
  | { kind: "kv"; label: string; value: string }
  | { kind: "card"; title: string; lines: string[] };

export interface BrandedDoc {
  /** An optional small uppercase line under the logo. Left out of the insurance documents: the entity is in the footer and the header breathes. */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** Left side of the bronze footer bar; the page number goes on the right. */
  footer: string;
  blocks: Block[];
}

const SLATE = "0.118 0.161 0.231", TEXT = "0.2 0.255 0.333", BRONZE = "0.639 0.486 0.345", MUTED = "0.58 0.639 0.722", RULE = "0.886 0.91 0.941";
const W = 612, H = 792, M = 54, FOOT = 26;
const HEAD1 = 122, HEAD2 = 40;

const WIN_ANSI: Record<string, number> = { "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "–": 0x96, "—": 0x97, "…": 0x85, "•": 0x95, "™": 0x99 };
const byteFor = (ch: string): number => { const c = ch.codePointAt(0)!; if (WIN_ANSI[ch]) return WIN_ANSI[ch]; return c >= 0x20 && c <= 0xff ? c : 0x3f; };
const esc = (s: string) => Array.from(s).map(byteFor).map((b) => (b === 0x28 || b === 0x29 || b === 0x5c ? `\\${String.fromCharCode(b)}` : b < 0x20 || b > 0x7e ? `\\${b.toString(8).padStart(3, "0")}` : String.fromCharCode(b))).join("");

type Face = "F1" | "F2" | "F3";
// Average glyph widths as a fraction of the size; for wrapping only, so they err a little wide.
const FACTOR: Record<Face, number> = { F1: 0.5, F2: 0.54, F3: 0.47 };
const widthOf = (s: string, size: number, face: Face) => s.length * size * FACTOR[face];
export function wrap(text: string, size: number, bold: boolean, maxWidth: number, face?: Face): string[] {
  const f = face ?? (bold ? "F2" : "F1");
  const out: string[] = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && widthOf(next, size, f) > maxWidth) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out;
}

const text = (face: Face, size: number, x: number, y: number, s: string, rgb = TEXT) => `${rgb} rg BT /${face} ${size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${esc(s)}) Tj ET`;
const rect = (x: number, y: number, w: number, h: number, rgb: string) => `${rgb} rg ${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f`;
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

/** Lays the blocks out on pages (below the header band, above the footer bar). Returns each page's drawing operations. */
function layout(blocks: Block[]): string[][] {
  const pages: string[][] = [[]];
  let y = H - HEAD1 - 26;
  const room = (need: number) => { if (y - need < FOOT + 22) { pages.push([]); y = H - HEAD2 - 26; } };
  const put = (op: string) => pages[pages.length - 1].push(op);
  for (const b of blocks) {
    if (b.kind === "gap") { y -= b.h ?? 8; continue; }
    if (b.kind === "h") {
      const size = 14, lines = wrap(b.text, size, false, W - 2 * M, "F3");
      room(size * 1.3 * lines.length + 18 + 44); y -= 8;
      for (const l of lines) { y -= size * 1.3; put(text("F3", size, M, y, l, SLATE)); }
      y -= 10; put(rect(M, y, 30, 2, BRONZE)); y -= 8;
      continue;
    }
    if (b.kind === "kv") {
      // A label on the left and its value beside it, for facts ("Occupation: Dentist").
      const LW = 150, VX = M + LW + 10, size = 9.5, lead = size * 1.42;
      const ls = wrap(b.label, size, true, LW), vs = wrap(b.value, size, false, W - M - VX);
      const rows = Math.max(ls.length, vs.length);
      room(lead * Math.min(rows, 3));
      ls.forEach((l, i) => { if (y - lead * (i + 1) < FOOT + 22) return; });
      const top = y;
      for (let i = 0; i < rows; i++) {
        if (i > 0 && y - lead < FOOT + 22) { pages.push([]); y = H - HEAD2 - 26; }
        y -= lead;
        if (ls[i]) put(text("F2", size, M, y, ls[i], SLATE));
        if (vs[i]) put(text("F1", size, VX, y, vs[i]));
      }
      void top; y -= 5;
      continue;
    }
    if (b.kind === "card") {
      const size = 9.5, body = b.lines.flatMap((l) => wrap(l, size, false, W - 2 * M - 22));
      room(Math.min(40 + body.length * size * 1.4, 160));
      const h = 24 + body.length * size * 1.4 + 6;
      // A card that will not fit on the rest of the page starts on the next one.
      if (y - h < FOOT + 22) { pages.push([]); y = H - HEAD2 - 26; }
      put(rect(M, y - h, W - 2 * M, h, "0.98 0.98 0.98")); put(rect(M, y - h, 3, h, BRONZE));
      put(text("F2", 8.5, M + 12, y - 15, b.title, SLATE));
      let yy = y - 15;
      for (const l of body) { yy -= size * 1.4; put(text("F1", size, M + 12, yy, l)); }
      y -= h + 8;
      continue;
    }
    const size = b.small ? 8 : 10, lead = size * 1.42, face: Face = b.bold ? "F2" : "F1";
    for (const l of wrap(b.text, size, !!b.bold, W - 2 * M)) {
      room(lead); y -= lead;
      if (l) put(text(face, size, M, y, l, b.small ? "0.392 0.455 0.545" : TEXT));
    }
    y -= b.small ? 4 : 5;
  }
  return pages;
}

/** The PDF bytes for a branded document. */
export function buildBrandedPdf(doc: BrandedDoc): Uint8Array {
  const pages = layout(doc.blocks);
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const emit = (c: string | Uint8Array) => { const b = typeof c === "string" ? ascii(c) : c; chunks.push(b); size += b.length; };
  emit("%PDF-1.4\n");

  // Object numbers: 1 catalog, 2 page tree, 3-5 fonts, 6 logo mask, 7 logo (white, painted through the mask), then a content stream and a page per page.
  const n = pages.length;
  const kid = (i: number) => 10 + i * 2; // the page; its content stream is the object just before it
  const obj = (num: number, body: string | Uint8Array[]) => {
    offsets[num] = size;
    emit(`${num} 0 obj\n`);
    if (typeof body === "string") emit(body); else for (const p of body) emit(p);
    emit("\nendobj\n");
  };
  const stream = (dict: string, data: Uint8Array): Uint8Array[] => [ascii(`<< ${dict} /Length ${data.length} >>\nstream\n`), data, ascii("\nendstream")];

  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${kid(i)} 0 R`).join(" ")}] /Count ${n} >>`);
  obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  obj(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  obj(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>");
  obj(6, stream(`/Type /XObject /Subtype /Image /Width ${LOGO_W} /Height ${LOGO_H} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, b64(LOGO_ALPHA_FLATE_B64)));
  obj(7, stream("/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /SMask 6 0 R", Uint8Array.of(255)));
  obj(8, "<< /Producer (ProsperWise) >>");

  pages.forEach((ops, i) => {
    const first = i === 0;
    const chrome: string[] = [];
    if (first) {
      chrome.push(rect(0, H - HEAD1, W, HEAD1, SLATE));
      const lw = 150, lh = (lw * LOGO_H) / LOGO_W;
      chrome.push(`q ${lw} 0 0 ${lh.toFixed(1)} ${M} ${(H - 20 - lh).toFixed(1)} cm /Logo Do Q`);
      if (doc.eyebrow) chrome.push(text("F1", 7.5, M, H - 20 - lh - 16, doc.eyebrow.toUpperCase(), MUTED));
      chrome.push(text("F3", 24, M, H - 20 - lh - 44, doc.title, "1 1 1"));
      if (doc.subtitle) chrome.push(text("F1", 8.5, M, H - 20 - lh - 60, doc.subtitle, "0.8 0.84 0.88"));
    } else {
      chrome.push(rect(0, H - HEAD2, W, HEAD2, SLATE));
      const lw = 78, lh = (lw * LOGO_H) / LOGO_W;
      chrome.push(`q ${lw} 0 0 ${lh.toFixed(1)} ${M} ${(H - (HEAD2 + lh) / 2).toFixed(1)} cm /Logo Do Q`);
      chrome.push(text("F1", 7.5, W - M - Math.min(widthOf(doc.title, 7.5, "F1"), 300), H - HEAD2 / 2 - 3, doc.title, MUTED));
    }
    chrome.push(rect(0, 0, W, FOOT, BRONZE));
    chrome.push(text("F1", 7.5, M, 9, doc.footer, "1 1 1"));
    const pg = `Page ${i + 1} of ${n}`;
    chrome.push(text("F1", 7.5, W - M - widthOf(pg, 7.5, "F1"), 9, pg, "1 1 1"));
    const content = ascii([...chrome, ...ops].join("\n"));
    obj(kid(i) - 1, stream("", content));
    obj(kid(i), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> /XObject << /Logo 7 0 R >> >> /Contents ${kid(i) - 1} 0 R >>`);
  });

  const total = 9 + n * 2; // the free entry 0, objects 1 to 8, then a content stream and a page per page
  const xref = size;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let k = 1; k < total; k++) x += `${String(offsets[k] ?? 0).padStart(10, "0")} 00000 n \n`;
  emit(`${x}trailer\n<< /Size ${total} /Root 1 0 R /Info 8 0 R >>\nstartxref\n${xref}\n%%EOF`);
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
