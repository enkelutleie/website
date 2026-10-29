// Letter PDFs for the landlord templates (LandlordDocumentTemplates.swift):
// A4, Helvetica / Helvetica-Bold with WinAnsiEncoding (covers æ ø å), the app
// logo as a JPEG, blocks title/subtitle/section/row/paragraph/callout/signature.
// Pure module (no DOM) so it can be checked in node.

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 56;
const BOTTOM = 64;
const LABEL_W = 150;
const INK = "0.106 0.227 0.42";
const MUTED = "0.392 0.475 0.604";
const BRAND = "0.184 0.502 0.929";
const SOFT = "0.918 0.949 0.992";
const LINE = "0.82 0.87 0.94";
export const TAGLINE = "Tryggere utleie. Enklere hverdag.";

// AFM advance widths (1/1000 em) for ASCII 32–126.
const REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
const EXTRA = { "æ": [889, 889], "ø": [611, 611], "å": [556, 556], "Æ": [1000, 1000], "Ø": [778, 778], "Å": [667, 722], "–": [556, 556], "—": [1000, 1000], "…": [1000, 1000], "«": [556, 556], "»": [556, 556], "·": [278, 278], "\u00a0": [278, 278], "§": [556, 556] };
const WIN = { "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f };

const codeOf = (ch) => {
  const c = ch.codePointAt(0);
  if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff)) return c;
  return WIN[ch] ?? null;
};
// Characters the PDF fonts cannot draw (iOS: unsupportedCharacters).
export const unsupportedCharacters = (text) =>
  [...new Set([...String(text ?? "").replace(/[\n\r\t]/g, " ")].filter((ch) => codeOf(ch) == null))];

const width = (text, size, bold) => {
  let w = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0);
    w += c >= 32 && c <= 126 ? (bold ? BOLD : REG)[c - 32] : (EXTRA[ch]?.[bold ? 1 : 0] ?? 556);
  }
  return (w * size) / 1000;
};
const hex = (text) => {
  let out = "";
  for (const ch of text) out += (codeOf(ch) ?? 0x3f).toString(16).padStart(2, "0");
  return `<${out}>`;
};
const n = (v) => (Math.round(v * 100) / 100).toString();

export function wrap(text, size, bold, maxWidth) {
  const lines = [];
  for (const para of String(text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    let line = "";
    for (const word of para.replace(/\t/g, " ").split(/ +/)) {
      let w = word;
      const candidate = line ? `${line} ${w}` : w;
      if (width(candidate, size, bold) <= maxWidth) { line = candidate; continue; }
      if (line) lines.push(line);
      line = "";
      while (width(w, size, bold) > maxWidth) {
        let i = w.length - 1;
        while (i > 1 && width(w.slice(0, i), size, bold) > maxWidth) i--;
        lines.push(w.slice(0, i));
        w = w.slice(i);
      }
      line = w;
    }
    lines.push(line);
  }
  return lines;
}

// Characters outside WinAnsi that the report uses.
const pdfText = (v) => String(v ?? "").replace(/→/g, "->").replace(/\u2212/g, "-").replace(/\u202f/g, "\u00a0");
const clip = (s, size, bold, maxW) => {
  let v = pdfText(s);
  if (width(v, size, bold) <= maxW) return v;
  while (v.length > 1 && width(`${v}…`, size, bold) > maxW) v = v.slice(0, -1);
  return `${v}…`;
};
const dash = (v) => (String(v ?? "").trim() ? String(v).trim() : "–");

/**
 * blocks: [{type:"title",text}|{type:"subtitle",text}|{type:"section",text}|{type:"row",label,value}
 *          |{type:"paragraph",text}|{type:"item",text,indent,bold}|{type:"callout",title,body}
 *          |{type:"signature",place,date,name,strokes:[[{x,y}]]}]
 * logo: { jpeg: Uint8Array, width, height } or null.
 */
export function letterPdf(blocks, { logo = null, title = "Dokument" } = {}) {
  const pages = [];
  let ops;
  let y;
  const newPage = () => {
    ops = [];
    pages.push(ops);
    y = PAGE_H - MARGIN;
    // Header: app logo, name and tagline.
    if (logo) ops.push(`q 30 0 0 30 ${n(MARGIN)} ${n(y - 30)} cm /Im1 Do Q`);
    const textX = logo ? MARGIN + 40 : MARGIN;
    ops.push(text("Enkel Utleie", textX, y - 13, 12, true, INK));
    ops.push(text(TAGLINE, textX, y - 27, 9, false, MUTED));
    y -= 44;
    ops.push(`${LINE} RG 0.75 w ${n(MARGIN)} ${n(y)} m ${n(PAGE_W - MARGIN)} ${n(y)} l S`);
    y -= 26;
  };
  const text = (s, x, yy, size, bold, color) =>
    `BT ${color} rg /${bold ? "F2" : "F1"} ${size} Tf ${n(x)} ${n(yy)} Td ${hex(s)} Tj ET`;
  const ensure = (h) => { if (y - h < BOTTOM) newPage(); };
  const lines = (s, x, size, bold, color, maxW, lead) => {
    for (const l of wrap(s, size, bold, maxW)) {
      ensure(lead);
      ops.push(text(l, x, y - size, size, bold, color));
      y -= lead;
    }
  };
  const contentW = PAGE_W - 2 * MARGIN;
  newPage();
  for (const b of blocks) {
    if (b.type === "title") { lines(b.text, MARGIN, 22, true, INK, contentW, 28); y -= 2; }
    else if (b.type === "subtitle") { lines(b.text, MARGIN, 12, false, MUTED, contentW, 17); y -= 4; }
    else if (b.type === "section") {
      y -= 14;
      ensure(40);
      ops.push(text(b.text, MARGIN, y - 11.5, 11.5, true, INK));
      y -= 18;
      ops.push(`${LINE} RG 0.75 w ${n(MARGIN)} ${n(y)} m ${n(PAGE_W - MARGIN)} ${n(y)} l S`);
      y -= 8;
    } else if (b.type === "row") {
      const values = wrap(dash(b.value), 10, false, contentW - LABEL_W);
      const labels = wrap(b.label, 10, false, LABEL_W - 10);
      const count = Math.max(values.length, labels.length);
      ensure(Math.min(count, 3) * 14 + 4);
      for (let i = 0; i < count; i++) {
        ensure(14);
        if (labels[i]) ops.push(text(labels[i], MARGIN, y - 10, 10, false, MUTED));
        if (values[i]) ops.push(text(values[i], MARGIN + LABEL_W, y - 10, 10, false, INK));
        y -= 14;
      }
      y -= 4;
    } else if (b.type === "paragraph") {
      y -= 2;
      lines(dash(b.text), MARGIN, 10.5, false, INK, contentW, 15);
      y -= 4;
    } else if (b.type === "item") {
      // Indented outline row (privacy export: PrivacyExportPDFRow).
      const x = MARGIN + Math.min(b.indent ?? 0, 8) * 14;
      lines(b.text, x, 10, Boolean(b.bold), INK, PAGE_W - MARGIN - x, 14);
      y -= 2;
    } else if (b.type === "callout") {
      const pad = 12;
      const tl = wrap(b.title, 11, true, contentW - 2 * pad);
      const bl = wrap(b.body, 10, false, contentW - 2 * pad);
      const h = pad * 2 + tl.length * 15 + bl.length * 14 + 4;
      y -= 10;
      ensure(h);
      ops.push(`${SOFT} rg ${n(MARGIN)} ${n(y - h)} ${n(contentW)} ${n(h)} re f`);
      ops.push(`${BRAND} rg ${n(MARGIN)} ${n(y - h)} 3 ${n(h)} re f`);
      let yy = y - pad;
      for (const l of tl) { ops.push(text(l, MARGIN + pad, yy - 11, 11, true, INK)); yy -= 15; }
      yy -= 4;
      for (const l of bl) { ops.push(text(l, MARGIN + pad, yy - 10, 10, false, INK)); yy -= 14; }
      y -= h + 6;
    } else if (b.type === "infocard") {
      // AnnualReportPDF.infoCard: label/value pairs in two columns on a soft card.
      const pad = 12;
      const h = pad * 2 + b.rows.length * 22 - 6;
      y -= 4;
      ensure(h);
      ops.push(`${SOFT} rg ${n(MARGIN)} ${n(y - h)} ${n(contentW)} ${n(h)} re f`);
      let yy = y - pad;
      const col = contentW / 2;
      for (const r of b.rows) {
        for (let i = 0; i < r.length; i += 2) {
          const x = MARGIN + pad + (i / 2) * col;
          ops.push(text(r[i], x, yy - 9, 8, false, MUTED));
          ops.push(text(clip(dash(r[i + 1]), 10, true, col - pad - 70), x + 64, yy - 10, 10, true, INK));
        }
        yy -= 22;
      }
      y -= h + 10;
    } else if (b.type === "table") {
      // AnnualReportPDF sections: numbered title, optional note, column header, rows, sum row.
      const cols = b.columns;
      const fixed = cols.reduce((a, c) => a + (c.w || 0), 0);
      const flex = cols.filter((c) => !c.w).length;
      const widths = cols.map((c) => c.w || Math.max(40, (contentW - fixed) / Math.max(flex, 1)));
      const xs = widths.map((_, i) => MARGIN + widths.slice(0, i).reduce((a, w) => a + w, 0));
      const cell = (s, i, yy, size, bold, color) => {
        const v = pdfText(s);
        const x = cols[i].align === "right" ? xs[i] + widths[i] - 4 - width(v, size, bold) : xs[i];
        ops.push(text(v, x, yy, size, bold, color));
      };
      const header = () => {
        if (!cols.some((c) => c.label)) return;
        cols.forEach((c, i) => cell(c.label, i, y - 8.5, 8, true, MUTED));
        y -= 13;
        ops.push(`${LINE} RG 0.5 w ${n(MARGIN)} ${n(y)} m ${n(PAGE_W - MARGIN)} ${n(y)} l S`);
        y -= 5;
      };
      y -= 14;
      ensure(70);
      ops.push(text(pdfText(b.title), MARGIN, y - 11.5, 11.5, true, INK));
      if (b.trailing) {
        const t = pdfText(b.trailing);
        ops.push(text(t, PAGE_W - MARGIN - width(t, 8.5, false), y - 11, 8.5, false, MUTED));
      }
      y -= 18;
      ops.push(`${LINE} RG 0.75 w ${n(MARGIN)} ${n(y)} m ${n(PAGE_W - MARGIN)} ${n(y)} l S`);
      y -= 8;
      if (b.note) { lines(pdfText(b.note), MARGIN, 8.5, false, MUTED, contentW, 12); y -= 2; }
      header();
      if (!b.rows.length) {
        ops.push(text("Ingen poster", MARGIN, y - 9, 9, false, MUTED));
        y -= 16;
      }
      for (const row of b.rows) {
        const wrapped = row.map((v, i) => wrap(pdfText(v ?? ""), 9, false, widths[i] - 6));
        const h = Math.max(...wrapped.map((w) => w.length)) * 12 + 4;
        if (y - h < BOTTOM) { newPage(); header(); }
        wrapped.forEach((ls, i) => ls.forEach((l, k) => cell(l, i, y - 9 - k * 12, 9, false, INK)));
        y -= h;
        ops.push(`${LINE} RG 0.25 w ${n(MARGIN)} ${n(y + 1)} m ${n(PAGE_W - MARGIN)} ${n(y + 1)} l S`);
      }
      if (b.sum) {
        ensure(24);
        y -= 2;
        ops.push(`${SOFT} rg ${n(MARGIN)} ${n(y - 20)} ${n(contentW)} 20 re f`);
        ops.push(text(pdfText(b.sum[0]), MARGIN + 6, y - 13.5, 9.5, true, INK));
        const v = pdfText(b.sum[1]);
        ops.push(text(v, PAGE_W - MARGIN - 4 - width(v, 9.5, true), y - 13.5, 9.5, true, INK));
        y -= 24;
      }
    } else if (b.type === "signature") {
      y -= 16;
      ensure(170);
      ops.push(text("Sted og dato", MARGIN, y - 11.5, 11.5, true, INK));
      y -= 18;
      ops.push(`${LINE} RG 0.75 w ${n(MARGIN)} ${n(y)} m ${n(PAGE_W - MARGIN)} ${n(y)} l S`);
      y -= 8;
      for (const [label, value] of [["Sted", b.place], ["Dato", b.date]]) {
        ops.push(text(label, MARGIN, y - 10, 10, false, MUTED), text(dash(value), MARGIN + LABEL_W, y - 10, 10, false, INK));
        y -= 14;
      }
      y -= 14;
      const boxW = 210;
      const boxH = 70;
      const top = y;
      const inBox = (v) => Number.isFinite(v) && v >= 0 && v <= 1;
      const strokes = (Array.isArray(b.strokes) ? b.strokes : [])
        .map((s) => (Array.isArray(s) ? s.filter((p) => inBox(p?.x) && inBox(p?.y)) : []))
        .filter((s) => s.length);
      if (strokes.length) {
        const parts = [`q ${INK} RG 1.4 w 1 J 1 j`];
        for (const s of strokes) {
          const pt = (p) => `${n(MARGIN + p.x * boxW)} ${n(top - p.y * boxH)}`;
          parts.push(`${pt(s[0])} m`);
          if (s.length === 1) parts.push(`${pt({ x: s[0].x + 0.002, y: s[0].y })} l`);
          for (const p of s.slice(1)) parts.push(`${pt(p)} l`);
          parts.push("S");
        }
        parts.push("Q");
        ops.push(parts.join(" "));
      }
      y = top - boxH - 4;
      ops.push(`${INK} RG 0.75 w ${n(MARGIN)} ${n(y)} m ${n(MARGIN + boxW + 40)} ${n(y)} l S`);
      y -= 4;
      ops.push(text(dash(b.name), MARGIN, y - 10, 10, true, INK));
      y -= 14;
      ops.push(text("Signatur (utleier)", MARGIN, y - 9, 9, false, MUTED));
      y -= 14;
    }
  }
  // Footer with page numbers.
  pages.forEach((p, i) => {
    p.push(text(`${title} · side ${i + 1} av ${pages.length}`, MARGIN, 36, 8, false, MUTED));
    const made = "Laget med Enkel Utleie";
    p.push(text(made, PAGE_W - MARGIN - width(made, 8, false), 36, 8, false, MUTED));
  });
  return writePdf(pages.map((p) => p.join("\n")), logo);
}

const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
function writePdf(streams, logo) {
  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (bytes) => { chunks.push(bytes); length += bytes.length; };
  const obj = (id, body, stream) => {
    offsets[id] = length;
    push(ascii(`${id} 0 obj\n${body}\n`));
    if (stream) { push(ascii("stream\n")); push(stream); push(ascii("\nendstream\n")); }
    push(ascii("endobj\n"));
  };
  // 1 catalog, 2 pages, 3 F1, 4 F2, 5 image, then page/content pairs.
  const pageIds = streams.map((_, i) => 6 + i * 2);
  push(ascii("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"));
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${streams.length} >>`);
  obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  obj(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  if (logo) obj(5, `<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.jpeg.length} >>`, logo.jpeg);
  else obj(5, "<< >>");
  const resources = `<< /Font << /F1 3 0 R /F2 4 0 R >>${logo ? " /XObject << /Im1 5 0 R >>" : ""} >>`;
  streams.forEach((s, i) => {
    const content = ascii(s);
    obj(pageIds[i], `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources ${resources} /Contents ${pageIds[i] + 1} 0 R >>`);
    obj(pageIds[i] + 1, `<< /Length ${content.length} >>`, content);
  });
  const total = 6 + streams.length * 2;
  const xref = length;
  let table = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let id = 1; id < total; id++) table += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  push(ascii(`${table}trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
