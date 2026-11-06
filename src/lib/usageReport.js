/* "Space usage by lab group" as a downloadable PDF report, for sending to
   people who don't use GrowSpace. The chart is redrawn here as a standalone
   SVG with fixed colours (the on-screen one relies on the app's CSS
   variables), turned into a PNG and placed in an A4 landscape PDF with a
   month-by-month table. jsPDF is loaded only when someone downloads. */

const INK = "#16211D", INK_SOFT = "#5C6D65", INK_FAINT = "#93A29B", GRID = "#E3E8E5", ACCENT = "#009E73";

const round1 = (n) => Math.round(n * 10) / 10;

/* Per-group figures for the chosen months. `series`: [{ name, color, values }],
   `current`: { [name]: units held right now } (null when the range doesn't
   reach this month). */
export function summariseUsage({ monthLabels, series, current = null }) {
  const rows = series.map((s) => {
    const vals = s.values.map((v) => v || 0);
    const peak = vals.length ? Math.max(...vals) : 0;
    const peakIdx = vals.indexOf(peak);
    return {
      name: s.name,
      color: s.color,
      now: current ? current[s.name] ?? 0 : null,
      average: vals.length ? round1(vals.reduce((a, b) => a + b, 0) / vals.length) : 0,
      peak,
      peakMonth: peak > 0 ? monthLabels[peakIdx] : null,
      unitMonths: vals.reduce((a, b) => a + b, 0),
    };
  });
  const totals = monthLabels.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] || 0), 0));
  const allUnitMonths = rows.reduce((a, r) => a + r.unitMonths, 0);
  for (const r of rows) r.share = allUnitMonths ? Math.round((r.unitMonths / allUnitMonths) * 100) : 0;
  return { rows, totals, allUnitMonths };
}

/* Standalone SVG line chart (no CSS variables), sized in px. */
export function buildUsageChartSvg({ monthLabels, series, width = 1600, height = 560 }) {
  const PAD_L = 56, PAD_R = 44, PAD_T = 24, PAD_B = 52;
  const plotW = width - PAD_L - PAD_R, plotH = height - PAD_T - PAD_B;
  const maxRaw = Math.max(1, ...series.flatMap((s) => s.values.map((v) => v || 0)));
  const step = Math.max(1, Math.ceil(maxRaw / 4)); // whole-unit gridlines
  const maxV = step * Math.max(1, Math.ceil(maxRaw / step));
  const n = monthLabels.length;
  const x = (i) => PAD_L + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v) => PAD_T + plotH - (v / maxV) * plotH;
  const labelStep = Math.max(1, Math.ceil(n / 12));
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Helvetica, Arial, sans-serif">`;
  out += `<rect width="${width}" height="${height}" fill="#FFFFFF"/>`;
  for (let v = 0; v <= maxV; v += step) {
    out += `<line x1="${PAD_L}" x2="${width - PAD_R}" y1="${y(v)}" y2="${y(v)}" stroke="${GRID}" stroke-width="2"/>`;
    out += `<text x="${PAD_L - 12}" y="${y(v) + 7}" font-size="20" fill="${INK_FAINT}" text-anchor="end">${v}</text>`;
  }
  monthLabels.forEach((m, i) => {
    if (i % labelStep === 0 || i === n - 1) out += `<text x="${x(i)}" y="${height - 16}" font-size="20" fill="${INK_SOFT}" text-anchor="${n > 1 && i === n - 1 ? "end" : "middle"}">${esc(m)}</text>`;
  });
  for (const s of series) {
    const pts = s.values.map((v, i) => `${x(i)},${y(v || 0)}`).join(" ");
    out += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>`;
    s.values.forEach((v, i) => { out += `<circle cx="${x(i)}" cy="${y(v || 0)}" r="6" fill="${s.color}" stroke="#FFFFFF" stroke-width="2"/>`; });
  }
  return out + "</svg>";
}

/* SVG string -> PNG data URL, via a canvas. Browser only. */
async function svgToPng(svg, width, height) {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    canvas.getContext("2d").drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

// The space-grid app icon, for the report header.
function logoSvg(size) {
  let cells = "";
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (!(r === 0 && c === 2))
    cells += `<rect x="${17 + c * 23}" y="${17 + r * 23}" width="18" height="18" rx="5" fill="${(r + c) % 2 ? "#2F6E4F" : "#52A070"}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#0E1A16"/>${cells}<path d="M63 37C63 25 70 18 83 17C83 29 76 36 63 37Z" fill="#3FCF9B"/></svg>`;
}

const listNames = (names) => (names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/* One sentence for the top of the report. Ties are named, not hidden. */
export function usageHeadline(rows, current, allUnitMonths) {
  if (current) {
    const holding = rows.filter((r) => r.now > 0);
    const held = holding.reduce((a, r) => a + r.now, 0);
    if (!held) return "No units are held by any lab group right now.";
    const max = Math.max(...holding.map((r) => r.now));
    const tops = holding.filter((r) => r.now === max);
    const lead = holding.length > 1 && tops.length === holding.length
      ? `${max} each`
      : tops.length > 1 ? `the most by ${listNames(tops.map((r) => r.name))} (${max} each)` : `the most by ${tops[0].name} (${max})`;
    return `Right now ${plural(held, "unit")} ${held === 1 ? "is" : "are"} held across ${plural(holding.length, "lab group")}; ${lead}.`;
  }
  if (!allUnitMonths) return "No units were held by any lab group in these months.";
  const max = Math.max(...rows.map((r) => r.share));
  const tops = rows.filter((r) => r.share === max);
  return `Over these months ${listNames(tops.map((r) => r.name))} used the most space (${max}% of all unit-months${tops.length > 1 ? " each" : ""}).`;
}

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/* Builds and downloads the PDF. `monthLabels` are short ("Dec 25"),
   `rangeLabel` e.g. "Dec 2025 to Nov 2026". Returns the filename. */
export async function downloadUsagePdf({ monthLabels, rangeLabel, series, current, generatedBy }) {
  const [{ jsPDF }, chartPng, logoPng] = await Promise.all([
    import("jspdf"),
    svgToPng(buildUsageChartSvg({ monthLabels, series }), 1600, 560),
    svgToPng(logoSvg(128), 128, 128),
  ]);
  const { rows, totals, allUnitMonths } = summariseUsage({ monthLabels, series, current });
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = 297, H = 210, M = 14;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const today = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
  doc.setProperties({ title: `GrowSpace - Space usage by lab group (${rangeLabel})`, creator: "GrowSpace" });

  const color = (hex) => doc.setTextColor(...hexToRgb(hex));
  const header = () => {
    doc.addImage(logoPng, "PNG", M, M - 2, 10, 10, "logo", "FAST");
    doc.setFont("helvetica", "bold"); doc.setFontSize(16); color(INK);
    doc.text("Space usage by lab group", M + 13, M + 3);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); color(INK_SOFT);
    doc.text(`GrowSpace  ·  Units occupied per month, ${rangeLabel}  ·  Generated ${today}${generatedBy ? ` by ${generatedBy}` : ""}`, M + 13, M + 8);
  };

  // Page 1: headline, chart, legend, summary table.
  header();
  let yPos = M + 17;
  doc.setFontSize(10.5); color(INK);
  doc.text(usageHeadline(rows, current, allUnitMonths), M, yPos);
  yPos += 4;

  const chartH = (W - 2 * M) * (560 / 1600);
  doc.addImage(chartPng, "PNG", M, yPos, W - 2 * M, chartH, "chart", "FAST");
  yPos += chartH + 3;

  // legend
  let lx = M + 2;
  doc.setFontSize(9);
  for (const r of rows) {
    const label = r.name;
    const wLabel = doc.getTextWidth(label) + 9;
    if (lx + wLabel > W - M) { lx = M + 2; yPos += 5; }
    doc.setFillColor(...hexToRgb(r.color)); doc.circle(lx + 1.5, yPos - 1.2, 1.5, "F");
    color(INK); doc.text(label, lx + 4.5, yPos);
    lx += wLabel + 4;
  }
  yPos += 8;

  // summary table
  const cols = [
    { h: "Lab group (PI)", w: 90, get: (r) => r.name, align: "left" },
    { h: "Units now", w: 30, get: (r) => (r.now == null ? "-" : String(r.now)) },
    { h: "Average / month", w: 36, get: (r) => String(r.average) },
    { h: "Peak", w: 22, get: (r) => String(r.peak) },
    { h: "Peak month", w: 30, get: (r) => r.peakMonth || "-" },
    { h: "Share of space", w: 34, get: (r) => `${r.share}%` },
  ];
  const tableRow = (cells, y, { bold = false, fill = null } = {}) => {
    if (fill) { doc.setFillColor(...hexToRgb(fill)); doc.rect(M, y - 4.6, W - 2 * M, 6.6, "F"); }
    doc.setFont("helvetica", bold ? "bold" : "normal");
    let cx = M + 2;
    cells.forEach((c, i) => {
      const col = cols[i] || { w: 20 };
      if (col.align === "left") doc.text(String(c), cx, y);
      else doc.text(String(c), cx + col.w - 4, y, { align: "right" });
      cx += col.w;
    });
  };
  doc.setFontSize(9.5); color(INK);
  tableRow(cols.map((c) => c.h), yPos, { bold: true, fill: "#F1F5F3" });
  yPos += 6.6;
  for (const r of rows) {
    if (yPos > H - 16) { doc.addPage(); header(); yPos = M + 20; }
    color(INK); tableRow(cols.map((c) => c.get(r)), yPos);
    doc.setDrawColor(...hexToRgb(GRID)); doc.line(M, yPos + 2, W - M, yPos + 2);
    yPos += 6.6;
  }
  doc.setFontSize(8); color(INK_FAINT);
  doc.text("Share of space = this group's unit-months as a percentage of all unit-months in the range. A unit-month is one unit held for one month.", M, yPos + 2);

  // Following page(s): the month-by-month figures, 12 months per block.
  doc.addPage(); header();
  yPos = M + 20;
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); color(INK);
  doc.text("Units occupied, month by month", M, yPos);
  yPos += 7;
  const nameW = 70;
  for (let start = 0; start < monthLabels.length; start += 12) {
    const months = monthLabels.slice(start, start + 12);
    const cellW = (W - 2 * M - nameW) / 12;
    const blockH = (rows.length + 2) * 6.4 + 6;
    if (yPos + blockH > H - 12) { doc.addPage(); header(); yPos = M + 20; }
    const line = (label, vals, y, { bold = false, fill = null } = {}) => {
      if (fill) { doc.setFillColor(...hexToRgb(fill)); doc.rect(M, y - 4.4, W - 2 * M, 6.4, "F"); }
      doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(9); color(INK);
      doc.text(String(label), M + 2, y);
      vals.forEach((v, i) => doc.text(String(v), M + nameW + cellW * (i + 1) - 2, y, { align: "right" }));
    };
    line("Lab group (PI)", months, yPos, { bold: true, fill: "#F1F5F3" });
    yPos += 6.4;
    for (const s of series) {
      line(s.name, s.values.slice(start, start + 12).map((v) => v || 0), yPos);
      doc.setDrawColor(...hexToRgb(GRID)); doc.line(M, yPos + 2, W - M, yPos + 2);
      yPos += 6.4;
    }
    line("Total", totals.slice(start, start + 12), yPos, { bold: true });
    yPos += 12;
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); color(INK_FAINT);
    doc.text(`GrowSpace  ·  Page ${p} of ${pages}`, W - M, H - 7, { align: "right" });
    doc.setDrawColor(...hexToRgb(ACCENT)); doc.setLineWidth(0.8); doc.line(M, 6, W - M, 6); doc.setLineWidth(0.2);
  }

  const filename = `GrowSpace-Space-Usage-${rangeLabel.replace(/\s+to\s+/, "-to-").replace(/\s+/g, "-")}.pdf`;
  doc.save(filename);
  return filename;
}
