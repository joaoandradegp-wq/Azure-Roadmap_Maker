// Render (pptxgenjs) do "One Page Status Report" a partir do modelo de lib/statusTransform.js
// Slide 1: One Page (demandas). Slide 2 (opcional): somente Bugs.
const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");

const FONT = "Segoe UI";

// ------------------------------------------------------------ paleta (do modelo)
const C = {
  bg: "F5F7FA", white: "FFFFFF", border: "E2E8F0", navy: "1E3A5F", blue: "3B82F6",
  text: "334155", muted: "64748B", soft: "F8FAFC", strip: "EEF2F7",
  pill: "DBEAFE", pillTxt: "1E40AF", green: "00B050",
};
const STATUS_FILL = { "Andamento": C.soft, "Em testes": "FFF2CC", "Pronto GMUD": "D9D9D9", "Publicado": "E2EFDA" };
const STATUS_SWATCH = { "Andamento": "DBEAFE", "Em testes": "FFE699", "Pronto GMUD": "A6A6A6", "Publicado": "C5E0B3" };
const STATUS_ORDER = ["Andamento", "Em testes", "Pronto GMUD", "Publicado"];
const HEALTH = { "Saudável": ["E2EFDA", "375623"], "Atenção": ["FFF2CC", "7F6000"], "Crítico": ["FDE2E2", "9B1C1C"] };

const rr = (adj, w, h) => Math.min(adj, 0.5) * Math.min(w, h); // adj (ratio OOXML) -> raio em polegadas
const estLines = (txt, w, size) => Math.max(1, Math.ceil(String(txt).length / Math.max(8, Math.floor(w / (size * 0.0078)))));

// ------------------------------------------------------------ slide
function drawSlide(pres, m, opts, assetsDir, warnings) {
  const bugs = !!opts.bugs;
  const items = opts.itens;
  const s = pres.addSlide();
  const img = (f) => path.join(assetsDir, f);

  const rrect = (x, y, w, h, fill, adj = 0.2566, line, name) =>
    s.addShape(pres.ShapeType.roundRect, {
      x, y, w, h, fill: { color: fill }, rectRadius: rr(adj, w, h),
      line: line ? { color: line, width: 0.75 } : undefined, objectName: name,
    });
  const rect = (x, y, w, h, fill, name) =>
    s.addShape(pres.ShapeType.rect, { x, y, w, h, fill: { color: fill }, objectName: name });
  const txt = (t, x, y, w, h, o = {}) =>
    s.addText(t, {
      x, y, w, h, fontFace: FONT, fontSize: o.size || 9, bold: !!o.bold, color: o.color || C.text,
      align: o.align || "left", valign: o.valign || "middle", margin: 0, wrap: o.wrap !== false,
      isTextBox: true, objectName: o.name,
    });
  const pill = (x, y, w, h, label, fill = C.pill, color = C.pillTxt, size = 8, bold = false) => {
    rrect(x, y, w, h, fill, 0.5);
    txt(label, x, y, w, h, { size, color, bold, align: "center" });
  };

  rect(0, 0, 13.333, 7.5, C.bg, "Fundo");

  // ---- cabecalho
  rrect(0.31, 0.21, 12.71, 0.62, C.white, 0.4267, null, "Cabecalho");
  s.addImage({ path: img("icon_chart.png"), x: 0.52, y: 0.43, w: 0.21, h: 0.21, altText: "Icone titulo" });
  const titulo = `One Page Status Report - Sprint ${m.sprint}${bugs ? " Bugs" : ""}`;
  txt(titulo, 0.89, 0.21, 5.4, 0.62, { size: 15, bold: true, color: C.navy, wrap: false, name: "Titulo" });
  if (!bugs) {
    const px = Math.max(4.44, 0.89 + titulo.length * 0.117 + 0.3); // logo apos o titulo (sem sobrepor)
    txt(`${m.periodo} | ${m.tempo}% consumida (tempo)`, px, 0.21, 3.9, 0.62, { size: 9, color: C.muted, name: "Periodo" });
    const [hf, hc] = HEALTH[m.saude] || HEALTH["Saudável"];
    rrect(9.7, 0.38, 1.55, 0.29, hf, 0.5, null, "Saude");
    s.addShape(pres.ShapeType.ellipse, { x: 9.83, y: 0.49, w: 0.08, h: 0.08, fill: { color: hc } });
    txt(m.saude, 10.0, 0.38, 1.2, 0.29, { size: 9, bold: true, color: hc });
    rrect(11.45, 0.49, 1.04, 0.06, C.border, 0.5, null, "Progresso trilho");
    rrect(11.45, 0.49, Math.max(0.06, (1.04 * m.progresso) / 100), 0.06, C.blue, 0.5, null, "Progresso");
    txt(`${m.progresso}%`, 12.56, 0.38, 0.4, 0.29, { size: 8, color: C.muted });
  }

  // ---- painel Em Andamento
  rrect(0.31, 0.94, 8.39, 5.67, C.white, 0.0227, C.border, "Painel Andamento");
  rrect(0.49, 1.12, 0.25, 0.25, C.blue, 0.5);
  s.addImage({ path: img("icon_spinner.png"), x: 0.55, y: 1.185, w: 0.13, h: 0.13, altText: "Icone andamento" });
  txt("Em Andamento (DEV + QA)", 0.85, 1.12, 4.0, 0.25, { size: 10, bold: true, color: C.navy, name: "Titulo andamento" });
  const cw0 = bugs ? 0.8 : 0.55;
  pill(8.55 - cw0, 1.14, cw0, 0.21, `${items.length} ${bugs ? "Bugs" : "US"}`);
  rect(0.47, 1.44, 8.07, 0.01, C.border, "Divisor andamento");

  const n = items.length;
  const rows = Math.max(1, Math.ceil(n / 2));
  const pitch = Math.min(0.6, (6.5 - 1.58) / rows);
  const ch = Math.min(0.53, pitch - 0.07);
  if (ch < 0.38) warnings.push(`${n} itens no painel${bugs ? " de Bugs" : ""}: cards ficaram muito apertados.`);
  const xs = [0.5, 4.61], cw = 3.95;
  items.forEach((it, i) => {
    const col = Math.floor(i / rows), row = i % rows; // coluna a coluna (como no modelo)
    const x = xs[col], y = 1.58 + row * pitch;
    rrect(x, y, cw, ch, STATUS_FILL[it.status] || C.soft, 0.2566, it.status === "Andamento" ? C.border : null, `Card ${it.id}`);
    if (it.bug) s.addImage({ path: img("icon_bug.png"), x: x - 0.02, y: y + (ch - 0.4) / 2, w: 0.4, h: 0.4, transparency: 75, altText: `Bug ${it.id}` });
    const proativo = !!it.proativo;
    txt(String(it.id), x + 0.1, y + (proativo ? 0.02 : 0), 0.62, proativo ? ch - 0.18 : ch, { size: 9, bold: true, color: C.blue, name: `ID ${it.id}` });
    if (proativo) {
      rrect(x + 0.1, y + ch - 0.17, 0.54, 0.1, C.green, 0.5);
      txt("PROATIVO", x + 0.1, y + ch - 0.17, 0.54, 0.1, { size: 5.5, color: C.white, align: "center" });
    }
    // REFORMA ocupa o lugar do % (como no modelo)
    const tw = cw - 0.72 - (it.reforma ? 0.92 : 0.52);
    const tsz = estLines(it.title, tw, 9) <= 3 ? 9 : 8;
    let title = it.title;
    if (estLines(title, tw, tsz) > 3) title = title.slice(0, Math.floor(tw / (tsz * 0.0078)) * 3 - 3).trimEnd() + "…";
    txt(title, x + 0.72, y + 0.02, tw, ch - 0.04, { size: tsz, name: `Titulo ${it.id}` });
    if (it.reforma) pill(x + cw - 0.88, y + (ch - 0.2) / 2, 0.8, 0.2, "REFORMA", C.pill, C.pillTxt, 8, true);
    else pill(x + cw - 0.5, y + (ch - 0.2) / 2, 0.42, 0.2, `${it.pct}%`);
  });

  // ---- painel Janelas de Implantacao
  rrect(8.82, 0.95, 4.2, 5.66, C.white, 0.0227, C.border, "Painel Janelas");
  rrect(9.05, 1.12, 0.25, 0.25, "2E75B6", 0.5);
  s.addImage({ path: img("icon_bars.png"), x: 9.08, y: 1.15, w: 0.19, h: 0.19, altText: "Icone janelas" });
  txt("Janelas de Implantação - Planejamento", 9.4, 1.12, 3.5, 0.25, { size: 10, bold: true, color: C.navy });
  rect(9.06, 1.43, 3.75, 0.01, C.border, "Divisor janelas");

  if (!bugs) drawJanelas(s, m, { rrect, txt, img }, warnings);

  // ---- rodape
  rrect(0.31, 6.77, 12.71, 0.52, C.white, 0.614, null, "Rodape");
  STATUS_ORDER.forEach((st, i) => {
    const cx = 0.56 + (i % 2) * 1.45, cy = 6.82 + Math.floor(i / 2) * 0.22;
    rect(cx, cy, 1.4, 0.2, C.strip);
    rrect(cx + 0.08, cy + 0.05, 0.21, 0.1, STATUS_SWATCH[st], 0.5);
    txt(st, cx + 0.38, cy, 1.0, 0.2, { size: 8, color: C.muted });
  });
  if (m.proxima) {
    rrect(11.0, 6.91, 1.85, 0.24, C.strip, 0.5, null, "Proxima sprint");
    s.addImage({ path: img("icon_calendar.png"), x: 11.12, y: 6.975, w: 0.1, h: 0.12, altText: "Icone calendario" });
    txt(m.proxima, 11.3, 6.91, 1.5, 0.24, { size: 8, color: "475569" });
  }
}

// ---- conteudo do painel de Janelas: datas de deploy + demandas represadas em GMUD
function drawJanelas(s, m, h, warnings) {
  const { rrect, txt, img } = h;
  const BOTTOM = 6.5;
  const LH = 0.0183; // altura de linha por pt de fonte
  const cpl = (size, w) => Math.floor(w / (size * 0.0072));
  const lines = (t, size, w) => Math.max(1, Math.ceil(String(t).length / cpl(size, w)));

  const rep = m.represadas || { demandas: [], bugs: [] };
  const hasRep = rep.demandas.length > 0 || rep.bugs.length > 0;
  if (!m.janelas.length && !hasRep) return;

  // altura total em funcao do tamanho da fonte
  const total = (size) => {
    let y = 1.59;
    for (const j of m.janelas) y += 0.24 + LH * size * j.itens.reduce((a, t) => a + lines(t, size, 3.35), 0) + 0.08;
    if (hasRep) {
      y += 0.24;
      for (const grp of [rep.demandas, rep.bugs]) {
        if (!grp.length) continue;
        y += LH * size * (1 + grp.reduce((a, t) => a + lines(t, size, 3.2), 0)) + 0.1;
      }
    }
    return y;
  };
  let size = 8;
  for (const sz of [8, 7.5, 7, 6.5]) { size = sz; if (total(sz) <= BOTTOM) break; }
  if (total(size) > BOTTOM) warnings.push("Janelas: conteudo passou do limite do painel (muitos itens).");

  const strip = (y, label) => {
    rrect(9.05, y, 3.69, 0.19, C.strip, 0.2);
    s.addImage({ path: img("icon_clock.png"), x: 9.09, y: y + 0.005, w: 0.18, h: 0.18, altText: "Icone data" });
    txt(label, 9.34, y, 3.3, 0.19, { size: 8.5, bold: true });
  };
  const list = (items, x, y, w, hh) => {
    const runs = items.map((it, i) => ({
      text: it.text,
      options: { bullet: { indent: it.sub ? 10 : 12 }, indentLevel: it.sub ? 1 : 0, breakLine: i < items.length - 1 },
    }));
    s.addText(runs, { x, y, w, h: hh, fontFace: FONT, fontSize: size, color: C.text, valign: "top", margin: 0, isTextBox: true });
  };

  let y = 1.59;
  for (const j of m.janelas) {
    strip(y, j.data);
    y += 0.24;
    const hh = LH * size * j.itens.reduce((a, t) => a + lines(t, size, 3.35), 0);
    list(j.itens.map((t) => ({ text: t })), 9.2, y, 3.5, hh);
    y += hh + 0.08;
  }
  if (hasRep) {
    strip(y, "Demandas Represadas em GMUD");
    y += 0.24;
    const groups = [["Demandas:", rep.demandas], ["Bugs:", rep.bugs]].filter(([, g]) => g.length);
    for (const [label, g] of groups) {
      const hh = LH * size * (1 + g.reduce((a, t) => a + lines(t, size, 3.2), 0));
      list([{ text: label }, ...g.map((t) => ({ text: t, sub: true }))], 9.2, y, 3.5, hh);
      y += hh + 0.1;
    }
  }
}

// ------------------------------------------------------------ entrada
async function renderStatusReport(m, outPath, assetsDir) {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE"; // 13.33 x 7.5
  pres.title = `One Page Status Report - Sprint ${m.sprint}`;
  const warnings = [];

  drawSlide(pres, m, { itens: m.itens, bugs: false }, assetsDir, warnings);
  if (m.bugs) drawSlide(pres, m, { itens: m.bugs, bugs: true }, assetsDir, warnings);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await pres.writeFile({ fileName: outPath });
  return warnings;
}

module.exports = { renderStatusReport, STATUS_FILL };
