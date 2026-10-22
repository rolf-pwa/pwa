// simple-pdf.ts: a small text-only PDF writer for the frozen copy of a signed document. Pure; no Deno APIs. Standard Helvetica (Latin-1 plus the usual
// curly quotes and dashes), US Letter, wrapped lines, bold headings. Anything outside that set prints as "?".

export type PdfLine = { text: string; bold?: boolean; size?: number; gap?: number };

const WIN_ANSI: Record<string, number> = { "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "–": 0x96, "—": 0x97, "…": 0x85, "•": 0x95 };
const byteFor = (ch: string): number => {
  const c = ch.codePointAt(0)!;
  if (WIN_ANSI[ch]) return WIN_ANSI[ch];
  return c >= 0x20 && c <= 0xff ? c : 0x3f;
};
const esc = (s: string) => Array.from(s).map(byteFor).map((b) => (b === 0x28 || b === 0x29 || b === 0x5c ? `\\${String.fromCharCode(b)}` : b < 0x20 || b > 0x7e ? `\\${b.toString(8).padStart(3, "0")}` : String.fromCharCode(b))).join("");

// Average Helvetica glyph is about half the font size wide; this is only for wrapping, so it errs a little narrow.
const widthOf = (s: string, size: number, bold: boolean) => s.length * size * (bold ? 0.54 : 0.5);
export function wrap(text: string, size: number, bold: boolean, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && widthOf(next, size, bold) > maxWidth) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out;
}

const PAGE_W = 612, PAGE_H = 792, MARGIN = 54;
/** The PDF bytes for the lines, paginated. */
export function buildPdf(lines: PdfLine[], footer = ""): Uint8Array {
  const pages: string[][] = [[]];
  let y = PAGE_H - MARGIN;
  for (const l of lines) {
    const size = l.size ?? 10.5, lead = size * 1.35;
    for (const w of wrap(l.text, size, !!l.bold, PAGE_W - 2 * MARGIN)) {
      if (y - lead < MARGIN + 18) { pages.push([]); y = PAGE_H - MARGIN; }
      y -= lead;
      if (w) pages[pages.length - 1].push(`BT /${l.bold ? "F2" : "F1"} ${size} Tf ${MARGIN} ${y.toFixed(1)} Td (${esc(w)}) Tj ET`);
    }
    y -= l.gap ?? 4;
  }
  const objs: string[] = [];
  const add = (s: string) => { objs.push(s); return objs.length; };
  const catalog = add("");
  const tree = add("");
  const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const kids: number[] = [];
  pages.forEach((p, i) => {
    const body = [...p, footer ? `BT /F1 8 Tf ${MARGIN} 30 Td (${esc(`${footer}  |  Page ${i + 1} of ${pages.length}`)}) Tj ET` : ""].join("\n");
    const content = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`));
  });
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`;
  objs[tree - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  // Every character is a single byte: the text was reduced to ASCII escapes above.
  return Uint8Array.from(out, (c) => c.charCodeAt(0) & 0xff);
}
