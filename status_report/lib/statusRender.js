// Render (pptxgenjs) do "One Page Status Report" a partir do modelo de lib/statusTransform.js
const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");

const FONT = "Segoe UI";

const C = {
  bg: "F5F7FA", white: "FFFFFF", border: "E2E8F0", navy: "1E3A5F", blue: "3B82F6",
  text: "334155", muted: "64748B", soft: "F8FAFC", strip: "EEF2F7",
  pill: "DBEAFE", pillTxt: "1E40AF",
};
const STATUS_FILL = { "Andamento": C.soft, "Em testes": "FFF2CC", "Pronto GMUD": "D9D9D9", "Publicado": "E2EFDA" };
const STATUS_SWATCH = { "Andamento": "DBEAFE", "Em testes": "FFE699", "Pronto GMUD": "A6A6A6", "Publicado": "C5E0B3" };
const STATUS_ORDER = ["Andamento", "Em testes", "Pronto GMUD", "Publicado"];
const HEALTH = { "Saudável": ["E2EFDA", "375623"], "Atenção": ["FFF2CC", "7F6000"], "Crítico": ["FDE2E2", "9B1C1C"] };
const WEEKDAYS = ["Domingo", "Segunda-Feira", "Terça-Feira", "Quarta-Feira", "Quinta-Feira", "Sexta-Feira", "Sábado"];


const estLines = (txt, w, size) => Math.max(1, Math.ceil(String(txt).length / Math.max(8, Math.floor(w / (size * 0.0078)))));
const rr = (adj, w, h) => Math.min(adj, 0.5) * Math.min(w, h);

async function renderStatusReport(m, outPath, assetsDir) {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE"; // 13.33 x 7.5
  pres.title = `One Page Status Report - Sprint ${m.sprint}`;
  const s = pres.addSlide();
  const warnings = [];
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
  const bullets = (items, x, y, w, h, size, name) => {
    const runs = items.map((it, i) => {
      const sub = String(it).startsWith(">");
      return {
        text: String(it).replace(/^>+/, "").trim(),
        options: { bullet: { indent: 10 }, indentLevel: sub ? 1 : 0, breakLine: i < items.length - 1 },
      };
    });
    s.addText(runs, {
      x, y, w, h, fontFace: FONT, fontSize: size, color: C.text, valign: "top", margin: 0,
      isTextBox: true, paraSpaceAfter: 0, objectName: name,
    });
  };

  rect(0, 0, 13.333, 7.5, C.bg, "Fundo");

  rrect(0.31, 0.21, 12.71, 0.62, C.white, 0.4267, null, "Cabecalho");
  s.addImage({ path: img("icon_chart.png"), x: 0.52, y: 0.43, w: 0.21, h: 0.21, altText: "Icone titulo" });
  txt(`One Page Status Report - Sprint ${m.sprint}`, 0.89, 0.21, 4.4, 0.62, { size: 15, bold: true, color: C.navy, wrap: false, name: "Titulo" });
  txt(`${m.periodo} | ${m.tempo}% consumida (tempo)`, 5.45, 0.21, 3.9, 0.62, { size: 9, color: C.muted, name: "Periodo" });

  const [hf, hc] = HEALTH[m.saude] || HEALTH["Saudável"];
  rrect(9.7, 0.38, 1.55, 0.29, hf, 0.5, null, "Saude");
  s.addShape(pres.ShapeType.ellipse, { x: 9.83, y: 0.49, w: 0.08, h: 0.08, fill: { color: hc } });
  txt(m.saude, 10.0, 0.38, 1.2, 0.29, { size: 9, bold: true, color: hc });
  rrect(11.45, 0.49, 1.04, 0.06, C.border, 0.5, null, "Progresso trilho");
  rrect(11.45, 0.49, Math.max(0.06, (1.04 * m.progresso) / 100), 0.06, C.blue, 0.5, null, "Progresso");
  txt(`${m.progresso}%`, 12.56, 0.38, 0.4, 0.29, { size: 8, color: C.muted });

  rrect(0.31, 0.94, 12.71, 3.15, C.white, 0.0227, C.border, "Painel Andamento");
  rrect(0.49, 1.12, 0.25, 0.25, C.blue, 0.5);
  s.addImage({ path: img("icon_spinner.png"), x: 0.55, y: 1.185, w: 0.13, h: 0.13, altText: "Icone andamento" });
  txt("Em Andamento (DEV + QA)", 0.85, 1.12, 4.0, 0.25, { size: 10, bold: true, color: C.navy, name: "Titulo andamento" });
  pill(12.3, 1.14, 0.55, 0.21, `${m.itens.length} US`);
  rect(0.47, 1.44, 12.4, 0.01, C.border, "Divisor andamento");

  const n = m.itens.length;
  const ncol = n <= 8 ? 2 : 3;
  const xs = ncol === 2 ? [0.5, 4.51] : [0.5, 4.65, 8.8];
  const cw = ncol === 2 ? 3.79 : 3.95;
  const rows = Math.max(1, Math.ceil(n / ncol));
  const pitch = Math.min(0.61, (4.0 - 1.58) / rows);
  const ch = Math.min(0.53, pitch - 0.07);
  if (ch < 0.34) warnings.push(`${n} itens em Andamento: cards ficaram muito apertados.`);
  m.itens.forEach((it, i) => {
    const col = Math.floor(i / rows), row = i % rows; 
    const x = xs[col], y = 1.58 + row * pitch;
    rrect(x, y, cw, ch, STATUS_FILL[it.status] || C.soft, 0.2566, it.status === "Andamento" ? C.border : null, `Card ${it.id}`);
    if (it.bug) s.addImage({ path: img("icon_bug.png"), x: x - 0.02, y: y + (ch - 0.4) / 2, w: 0.4, h: 0.4, altText: `Bug ${it.id}` });
    txt(String(it.id), x + 0.1, y, 0.58, ch, { size: 9, bold: true, color: C.blue, name: `ID ${it.id}` });
    const tw = cw - 0.72 - 0.52;
    const tsz = estLines(it.title, tw, 9) <= 3 ? 9 : 8;
    let title = it.title;
    if (estLines(title, tw, tsz) > 3) title = title.slice(0, Math.floor(tw / (tsz * 0.0078)) * 3 - 3).trimEnd() + "…";
    txt(title, x + 0.72, y + 0.02, tw, ch - 0.04, { size: tsz, name: `Titulo ${it.id}` });
    pill(x + cw - 0.5, y + (ch - 0.2) / 2, 0.42, 0.2, `${it.pct}%`);
  });

  rrect(0.28, 4.2, 8.43, 2.41, C.white, 0.0227, C.border, "Painel Detalhamento");
  s.addShape(pres.ShapeType.ellipse, { x: 0.45, y: 4.35, w: 0.25, h: 0.25, fill: { color: "FFD966" } });
  s.addShape(pres.ShapeType.lightningBolt, { x: 0.49, y: 4.395, w: 0.16, h: 0.16, fill: { color: C.white } });
  txt("Detalhamento", 0.8, 4.35, 3.0, 0.25, { size: 10, bold: true, color: C.navy });
  rect(0.49, 4.63, 8.07, 0.01, C.border, "Divisor detalhamento");

  const cols = { esq: { x: 0.44, w: 3.79, y: 4.75 }, dir: { x: 4.51, w: 3.79, y: 4.75 } };
  for (const d of m.detalhamento) {
    const c = cols[d.coluna] || cols.esq;
    const { x, w } = c;
    let y = c.y, h;
    if (d.tipo === "grupo") {
      h = 0.43;
      rrect(x, y, w, h, C.soft);
      txt(d.titulo, x + 0.18, y + 0.04, w - 0.3, 0.16, { valign: "top" });
      txt(d.ids.join("  –  "), x + 0.18, y + 0.21, w - 0.3, 0.18, { bold: true, color: C.blue, valign: "top" });
    } else {
      const it = d.item;
      h = it.proativoFlag ? 0.42 : 0.39;
      rrect(x, y, w, h, C.soft, 0.2566, null, `Detalhe ${it.id}`);
      txt(String(it.id), x + 0.09, y + (it.proativoFlag ? 0.12 : 0), 0.58, it.proativoFlag ? 0.27 : h, { bold: true, color: C.blue });
      if (it.proativoFlag) {
        rrect(x + 0.09, y + 0.27, 0.54, 0.1, "00B050", 0.5);
        txt("PROATIVO", x + 0.09, y + 0.27, 0.54, 0.1, { size: 5.5, color: C.white, align: "center" });
      }
      txt(it.title, x + 0.72, y + 0.02, w - 0.72 - 0.52, h - 0.04, { size: it.title.length < 75 ? 9 : 8 });
      pill(x + w - 0.5, y + (h - 0.2) / 2, 0.42, 0.2, `${it.pct}%`);
    }
    y += h + 0.06;
    const notas = d.notas || [];
    if (notas.length) {
      const nw = w - 0.38;
      const lines = notas.reduce((a, t) => a + estLines(String(t).replace(/^>+/, ""), nw - 0.3, 7), 0);
      const nh = 0.09 + 0.118 * lines;
      rrect(x + 0.36, y, nw, nh, C.soft);
      bullets(notas, x + 0.46, y + 0.05, nw - 0.2, nh - 0.08, 7);
      y += nh + 0.08;
    }
    c.y = y;
    if (y > 6.52) warnings.push(`Detalhamento: conteudo passou do limite do painel (coluna ${d.coluna}); reduza as notas.`);
  }

  rrect(8.82, 4.2, 4.2, 2.41, C.white, 0.0227, C.border, "Painel Janelas");
  rrect(9.05, 4.32, 0.25, 0.25, "2E75B6", 0.5);
  s.addImage({ path: img("icon_bars.png"), x: 9.08, y: 4.35, w: 0.19, h: 0.19, altText: "Icone janelas" });
  txt("Janelas de Implantação - Planejamento", 9.4, 4.32, 3.5, 0.25, { size: 10, bold: true, color: C.navy });
  rect(9.06, 4.63, 3.75, 0.01, C.border, "Divisor janelas");
  let jy = 4.74;
  if (!m.janelas.length) {
    txt('Sem janelas planejadas (informe em "janelas" no config).', 9.06, jy, 3.7, 0.3, { size: 8, color: C.muted, valign: "top" });
  }
  for (const j of m.janelas) {
    rrect(9.05, jy, 3.69, 0.19, C.strip, 0.2);
    s.addImage({ path: img("icon_clock.png"), x: 9.09, y: jy + 0.005, w: 0.18, h: 0.18, altText: "Icone data" });
    txt(j.data, 9.34, jy, 3.3, 0.19, { size: 8.5, bold: true });
    jy += 0.24;
    const lines = j.itens.reduce((a, t) => a + estLines(t, 3.0, 8), 0);
    const hh = 0.145 * lines;
    bullets(j.itens, 9.2, jy, 3.5, hh, 8);
    jy += hh + 0.1;
    if (jy > 6.55) warnings.push("Janelas: conteudo passou do limite do painel.");
  }

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

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await pres.writeFile({ fileName: outPath });
  return warnings;
}


module.exports = { renderStatusReport, STATUS_FILL };
