// render.js
// Lê data/roadmap.json (formato v2 - Gantt com quinzenas) e gera output/status_report.pptx.
// Se o roadmap tiver mais itens do que cabem em uma página, divide automaticamente
// em várias páginas (uma página do PPTX por página), repetindo cabeçalho/legenda/grade.
//
// Uso: node render.js [caminho_json] [caminho_saida]

const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");

const jsonPath = process.argv[2] || path.join(__dirname, "data", "roadmap.json");
const outPath = process.argv[3] || path.join(__dirname, "output", "status_report.pptx");

const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.3" x 7.5"

const PAGE_W = 13.3;
const PAGE_H = 7.5;
const MARGIN = 0.35;
const NAVY = "1B3B6F";
const NAVY_DARK = "0F2545";
const TEXT_DARK = "1A1A1A";
const GRAY_BAR = "BFBFBF";
const GRID_LINE = "D9D9D9";

const gridTop = 1.22;
const nameColW = 4.3;
const statusColW = 0.5;
const yearHeaderH = 0.24;
const monthHeaderH = 0.26;
const subHeaderH = 0.22;
const headerH = yearHeaderH + monthHeaderH + subHeaderH;
const rowH = 0.5;

// Quantas linhas cabem por página, deixando uma margem inferior de 0.3"
const ROWS_PER_PAGE = Math.max(1, Math.floor((PAGE_H - gridTop - headerH - 0.3) / rowH));

// ---------- Helpers de período ----------
function flattenPeriods(months) {
  const flat = [];
  let idx = 0;
  months.forEach((m) => {
    m.subcols.forEach((sc, i) => {
      flat.push({ month: m.name, subcolIndex: i, label: sc, flatIndex: idx });
      idx += 1;
    });
  });
  return flat;
}

function periodToFlatIndex(flatPeriods, period) {
  const found = flatPeriods.find(
    (p) => p.month === period.month && p.subcolIndex === period.subcolIndex
  );
  if (!found) {
    throw new Error(`Período não encontrado: ${JSON.stringify(period)} — confira "months" no JSON.`);
  }
  return found.flatIndex;
}

function formatDateBR(iso) {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

// Estima a largura de um texto em polegadas para o layout dinâmico da legenda
function estimateTextWidth(text, fontSize) {
  return Math.max(0.35, text.length * fontSize * 0.0092);
}

const flatPeriods = flattenPeriods(data.months);
const totalCols = flatPeriods.length;

/**
 * Desenha uma página completa (cabeçalho + legenda + grade + linhas + linha de hoje)
 * para o bloco de itens `roadmapChunk`.
 */
function renderPage(roadmapChunk, pageInfo) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };

  // ---------- Cabeçalho ----------
  let circleX = MARGIN;
  for (let i = 0; i < 4; i++) {
    slide.addShape("ellipse", {
      x: circleX, y: 0.28, w: 0.16, h: 0.16,
      fill: { color: "FFFFFF" },
      line: { color: NAVY, width: 1.25 },
    });
    circleX += 0.22;
  }

  const titleSuffix = pageInfo.totalPages > 1 ? ` (${pageInfo.pageNum}/${pageInfo.totalPages})` : "";
  slide.addText(
    [
      { text: `[Squad ${data.project.squad}] – `, options: { color: NAVY, bold: true } },
      { text: data.project.title + titleSuffix, options: { color: NAVY, bold: true } },
    ],
    {
      x: circleX + 0.08, y: 0.16, w: 9.4, h: 0.4,
      fontSize: 15, fontFace: "Arial", valign: "middle", margin: 0,
      fit: "shrink",
    }
  );

  slide.addText(`Atualizado em ${formatDateBR(data.project.reportDate)}`, {
    x: PAGE_W - MARGIN - 1.8, y: 0.16, w: 1.8, h: 0.3,
    fontSize: 10, color: "616161", fontFace: "Arial",
    align: "right", margin: 0,
  });

  // ---------- Legenda: Status – Fase ----------
  const legendY1 = 0.6;
  const legendFont = 8.5;
  slide.addText("Status – Fase", {
    x: MARGIN, y: legendY1, w: 1.3, h: 0.22,
    fontSize: 10, bold: true, color: NAVY, fontFace: "Arial", margin: 0,
  });

  const phaseOrder = ["naoIniciado", "noPrazo", "risco", "atraso", "pausado"];
  let px = MARGIN;
  const legendY1b = legendY1 + 0.25;
  phaseOrder.forEach((key) => {
    const color = data.phaseColors[key];
    const label = data.phaseLabels[key];
    slide.addShape("ellipse", {
      x: px, y: legendY1b, w: 0.15, h: 0.15,
      fill: { color },
      line: { color: "FFFFFF", width: 0.5 },
    });
    const labelW = estimateTextWidth(label, legendFont);
    slide.addText(label, {
      x: px + 0.17, y: legendY1b - 0.03, w: labelW, h: 0.22,
      fontSize: legendFont, color: TEXT_DARK, fontFace: "Arial",
      valign: "middle", margin: 0,
    });
    px += 0.17 + labelW + 0.12;
  });

  // ---------- Legenda: Status – Entregas ----------
  const legendX2 = px + 0.15;
  slide.addText("Status – Entregas", {
    x: legendX2, y: legendY1, w: 1.55, h: 0.22,
    fontSize: 10, bold: true, color: NAVY, fontFace: "Arial", margin: 0,
  });

  let dx = legendX2;
  const legendY2b = legendY1b;

  slide.addShape("triangle", {
    x: dx, y: legendY2b - 0.01, w: 0.15, h: 0.15,
    fill: { color: NAVY }, line: { color: NAVY, width: 0 },
    rotate: 90,
  });
  const inicioW = estimateTextWidth("Início", legendFont);
  slide.addText("Início", {
    x: dx + 0.18, y: legendY2b - 0.03, w: inicioW, h: 0.22,
    fontSize: legendFont, color: TEXT_DARK, fontFace: "Arial", valign: "middle", margin: 0,
  });
  dx += 0.18 + inicioW + 0.12;

  const deliveryOrder = ["previsao", "concluidaPrazo", "concluidaAtraso"];
  deliveryOrder.forEach((key) => {
    const color = data.deliveryColors[key];
    const label = data.deliveryLabels[key];
    slide.addShape("ellipse", {
      x: dx, y: legendY2b - 0.01, w: 0.17, h: 0.17,
      fill: { color },
      line: { color: "FFFFFF", width: 0.75 },
    });
    slide.addText("✓", {
      x: dx, y: legendY2b - 0.025, w: 0.17, h: 0.17,
      fontSize: 8, color: "FFFFFF", bold: true, fontFace: "Arial",
      align: "center", valign: "middle", margin: 0,
    });
    const labelW = estimateTextWidth(label, legendFont);
    slide.addText(label, {
      x: dx + 0.19, y: legendY2b - 0.05, w: labelW, h: 0.3,
      fontSize: legendFont, color: TEXT_DARK, fontFace: "Arial", valign: "middle", margin: 0,
    });
    dx += 0.19 + labelW + 0.12;
  });

  // ---------- Grade do roadmap ----------
  const gridLeft = MARGIN + nameColW + statusColW;
  const gridWidth = PAGE_W - MARGIN - gridLeft;
  const cellW = gridWidth / totalCols;

  slide.addShape("rect", {
    x: MARGIN, y: gridTop, w: nameColW, h: headerH,
    fill: { color: NAVY }, line: { color: NAVY, width: 0.5 },
  });
  slide.addText("Entrega/Fase", {
    x: MARGIN + 0.1, y: gridTop, w: nameColW - 0.2, h: headerH,
    fontSize: 10, bold: true, color: "FFFFFF", fontFace: "Arial",
    valign: "middle", margin: 0,
  });
  slide.addShape("rect", {
    x: MARGIN + nameColW, y: gridTop, w: statusColW, h: headerH,
    fill: { color: NAVY }, line: { color: NAVY, width: 0.5 },
  });
  slide.addText("Status", {
    x: MARGIN + nameColW, y: gridTop, w: statusColW, h: headerH,
    fontSize: 9, bold: true, color: "FFFFFF", fontFace: "Arial",
    align: "center", valign: "middle", margin: 0,
  });

  const yearLabel = data.project.reportDate ? data.project.reportDate.slice(0, 4) : "";
  slide.addShape("rect", {
    x: gridLeft, y: gridTop, w: gridWidth, h: yearHeaderH,
    fill: { color: NAVY_DARK }, line: { color: NAVY_DARK, width: 0.5 },
  });
  slide.addText(yearLabel, {
    x: gridLeft, y: gridTop, w: gridWidth, h: yearHeaderH,
    fontSize: 9, bold: true, color: "FFFFFF", fontFace: "Arial",
    align: "center", valign: "middle", margin: 0,
  });

  let mx = gridLeft;
  const monthY = gridTop + yearHeaderH;
  data.months.forEach((m) => {
    const w = cellW * m.subcols.length;
    slide.addShape("rect", {
      x: mx, y: monthY, w, h: monthHeaderH,
      fill: { color: NAVY }, line: { color: "FFFFFF", width: 0.75 },
    });
    slide.addText(m.name, {
      x: mx, y: monthY, w, h: monthHeaderH,
      fontSize: 10, bold: true, color: "FFFFFF", fontFace: "Arial",
      align: "center", valign: "middle", margin: 0,
    });
    mx += w;
  });

  let sx = gridLeft;
  const subY = monthY + monthHeaderH;
  flatPeriods.forEach((p) => {
    slide.addShape("rect", {
      x: sx, y: subY, w: cellW, h: subHeaderH,
      fill: { color: NAVY }, line: { color: "FFFFFF", width: 0.5 },
    });
    slide.addText(p.label, {
      x: sx, y: subY, w: cellW, h: subHeaderH,
      fontSize: 7, color: "E0E0E0", fontFace: "Arial",
      align: "center", valign: "middle", margin: 0,
    });
    sx += cellW;
  });

  // ---------- Linhas do roadmap (só o bloco desta página) ----------
  let rowY = gridTop + headerH;

  roadmapChunk.forEach((item, idx) => {
    const rowFill = idx % 2 === 0 ? "FFFFFF" : "F5F7FA";

    slide.addShape("rect", {
      x: MARGIN, y: rowY, w: PAGE_W - MARGIN * 2, h: rowH,
      fill: { color: rowFill }, line: { color: GRID_LINE, width: 0.5 },
    });

    slide.addText(item.title, {
      x: MARGIN + 0.08, y: rowY, w: nameColW - 0.16, h: rowH,
      fontSize: 9, bold: true, color: NAVY, fontFace: "Arial",
      valign: "middle", margin: 0, autoFit: false, shrinkText: true,
    });

    const phaseColor = data.phaseColors[item.phaseStatus] || "9E9E9E";
    slide.addShape("ellipse", {
      x: MARGIN + nameColW + statusColW / 2 - 0.08, y: rowY + rowH / 2 - 0.08,
      w: 0.16, h: 0.16,
      fill: { color: phaseColor },
      line: { color: "FFFFFF", width: 0.5 },
    });

    const startIdx = periodToFlatIndex(flatPeriods, item.startPeriod);
    const endIdx = periodToFlatIndex(flatPeriods, item.endPeriod);
    const barX = gridLeft + startIdx * cellW;
    const barW = (endIdx - startIdx + 1) * cellW;
    const barH = rowH * 0.42;
    const barY = rowY + (rowH - barH) / 2;

    slide.addShape("rect", {
      x: barX, y: barY, w: barW, h: barH,
      fill: { color: GRAY_BAR }, line: { color: GRAY_BAR, width: 0 },
    });

    const deliveryColor = data.deliveryColors[item.deliveryStatus] || "9E9E9E";
    const iconSize = 0.18;
    const iconX = barX + barW - iconSize / 2;
    const iconY = rowY + rowH / 2 - iconSize / 2;
    slide.addShape("ellipse", {
      x: iconX, y: iconY, w: iconSize, h: iconSize,
      fill: { color: deliveryColor }, line: { color: "FFFFFF", width: 0.75 },
    });
    slide.addText("✓", {
      x: iconX, y: iconY - 0.01, w: iconSize, h: iconSize,
      fontSize: 8, bold: true, color: "FFFFFF", fontFace: "Arial",
      align: "center", valign: "middle", margin: 0,
    });

    const dateRuns = [];
    if (item.plannedDate && item.plannedDate !== item.actualDate) {
      dateRuns.push({ text: item.plannedDate + "  ", options: { strike: true, color: "9E9E9E" } });
    }
    if (item.actualDate) {
      dateRuns.push({ text: item.actualDate, options: { color: TEXT_DARK } });
    }
    if (dateRuns.length > 0) {
      slide.addText(dateRuns, {
        x: iconX + iconSize + 0.03, y: rowY, w: 1.1, h: rowH,
        fontSize: 7.5, fontFace: "Arial", valign: "middle", margin: 0,
      });
    }

    rowY += rowH;
  });

  const tableBottom = rowY;

  // ---------- Linha vertical de "hoje" ----------
  if (data.todayPeriod) {
    const todayIdx = periodToFlatIndex(flatPeriods, data.todayPeriod);
    const fraction = typeof data.todayPeriod.fraction === "number" ? data.todayPeriod.fraction : 0;
    const todayX = gridLeft + (todayIdx + fraction) * cellW;
    slide.addShape("line", {
      x: todayX, y: gridTop, w: 0, h: tableBottom - gridTop,
      line: { color: "E53935", width: 1.5, dashType: "dash" },
    });
    slide.addShape("ellipse", {
      x: todayX - 0.04, y: tableBottom - 0.04, w: 0.08, h: 0.08,
      fill: { color: "E53935" }, line: { color: "E53935", width: 0 },
    });
  }

  slide.addShape("rect", {
    x: MARGIN, y: gridTop, w: PAGE_W - MARGIN * 2, h: tableBottom - gridTop,
    fill: { type: "none" }, line: { color: NAVY, width: 1 },
  });
}

// ---------- Divide o roadmap em páginas e desenha cada uma ----------
const roadmap = data.roadmap || [];
const totalPages = Math.max(1, Math.ceil(roadmap.length / ROWS_PER_PAGE));

for (let p = 0; p < totalPages; p++) {
  const chunk = roadmap.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE);
  renderPage(chunk, { pageNum: p + 1, totalPages });
}

if (totalPages > 1) {
  console.log(`${roadmap.length} itens não cabem em uma página só (máx. ${ROWS_PER_PAGE} linhas/página) — gerando ${totalPages} páginas.`);
}

pres.writeFile({ fileName: outPath }).then(() => {
  console.log(`Gerado: ${outPath}`);
});
