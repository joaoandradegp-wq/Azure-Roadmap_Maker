// Work items (Azure) -> modelo do "One Page Status Report".
// Reaproveita as funções de sprint/deploy do lib/transform.js do Roadmap Maker (pasta pai).
const {
  computeSprintDates,
  nextDeployDate,
  formatDateBR,
  stripTime,
  extractSprintNumber,
} = require("../../lib/transform");

const BOARD_COLUMN_FIELD = "System.BoardColumn";
const MS_DAY = 24 * 60 * 60 * 1000;

// pct: número fixo, ou "auto" = % de tempo consumido da sprint (azul: você confere depois).
// A ordem importa: a primeira regra que casar vale. "match" é regex aplicada ao nome da
// coluna SEM acento e em minúsculas. Para mudar/estender sem mexer aqui, use
// "statusReport": { "colunas": [ { "match": "...", "status": "...", "pct": 80 } ] } no config.json
// (essas regras entram na frente das abaixo).
const DEFAULT_COLUMN_RULES = [
  // --- amarelo: Em testes
  { match: "em testes.*qa|testes.*ambiente qa", status: "Em testes", pct: 80 },   // 1 - Em testes - Ambiente QA
  { match: "correcao.*qa", status: "Em testes", pct: 80 },                        // 2 - Em correção (Ambiente QA)
  { match: "pendente subida", status: "Em testes", pct: 85 },                     // 3 - Pendente subida HML
  { match: "testes.*(homologacao|hml)", status: "Em testes", pct: 95 },           // 4 - Em testes / Homologação
  { match: "correcao.*(hml|homologacao)", status: "Em testes", pct: 95 },         // 5 - Em correção (HML)
  // --- cinza: Pronto GMUD
  { match: "pronto para gmud|adicionar na gmud", status: "Pronto GMUD", pct: 100 },
  // --- azul: Andamento
  {
    match: "em desenvolvimento|pronto para desenvolvimento|spike|investigacao|aguardando retorno|aguardando confirmacao",
    status: "Andamento",
    pct: "auto",
  },
];

// Fallback (JSON sem System.BoardColumn): aproxima pelo estado do Azure.
const STATE_FALLBACK = {
  New: { status: "Andamento", pct: "auto" },
  Refinement: { status: "Andamento", pct: "auto" },
  Refined: { status: "Andamento", pct: "auto" },
  Active: { status: "Andamento", pct: "auto" },
  Resolved: { status: "Em testes", pct: 80 },
};

const WEEKDAYS = ["Domingo", "Segunda-Feira", "Terça-Feira", "Quarta-Feira", "Quinta-Feira", "Sexta-Feira", "Sábado"];

function norm(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function parseTags(raw) {
  return String(raw || "").split(";").map((t) => t.trim()).filter(Boolean);
}

function cleanTitle(t) {
  t = String(t || "").trim();
  if (t.includes(" | ")) t = t.split(" | ").slice(1).join(" | ").trim(); // "AREA | titulo"
  t = t.replace(/^\[[^\]]+\]\s*(?:[A-ZÀ-Ú ]+\s+-\s+|-\s*)?/, ""); // "[REFORMA] AREA - " / "[Tag] - "
  return t.replace(/\s*\[[A-Z]\d{4}-[^\]]*\]\s*$/, ""); // código de chamado no fim
}

function businessDays(a, b) {
  let n = 0;
  for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
    const w = d.getDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

function fmtDateFull(date) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${date.getFullYear()}`;
}

function fmtJanelaData(s) {
  const m = /^\s*(\d{2})\/(\d{2})\/(\d{4})\s*$/.exec(String(s));
  if (!m) return String(s);
  const d = new Date(+m[3], +m[2] - 1, +m[1]);
  return `${s.trim()} (${WEEKDAYS[d.getDay()]})`;
}

function compileRules(config) {
  const extra = (config.statusReport && config.statusReport.colunas) || [];
  return [...extra, ...DEFAULT_COLUMN_RULES].map((r) => ({ ...r, re: new RegExp(r.match) }));
}

// Sprint corrente pela data (cadência do config.json). Retorna número ou null.
function currentSprintNumber(config, today = new Date()) {
  const c = config.sprintCadence;
  if (!c) return null;
  const refStart = new Date(c.referenceStart + "T00:00:00");
  const diff = Math.floor((stripTime(today) - refStart) / (c.cadenceDays * MS_DAY));
  return c.referenceSprintNumber + diff;
}

function buildStatusReport(workItems, config, { sprint, includeBugs = false, today = new Date(), userCfg = {} }) {
  const F = config.fields || {};
  const fTags = F.tags || "System.Tags";
  const fState = F.state || "System.State";
  const fTitle = F.title || "System.Title";
  const fIter = F.iterationPath || "System.IterationPath";
  const fClosed = F.closedDate || "Microsoft.VSTS.Common.ClosedDate";
  const fColumn = F.boardColumn || BOARD_COLUMN_FIELD;

  if (!config.sprintCadence) throw new Error('Falta "sprintCadence" no config.json (usado para as datas da sprint).');
  const dates = computeSprintDates(sprint, config.sprintCadence);
  const nextDates = computeSprintDates(sprint + 1, config.sprintCadence);
  const sprintEndExclusive = new Date(dates.end.getTime() + MS_DAY);
  const todayMid = stripTime(today);

  // ---- tempo consumido
  let tempo;
  if (userCfg.tempo_consumido != null) tempo = +userCfg.tempo_consumido;
  else if (todayMid < dates.start) tempo = 0;
  else tempo = Math.round((100 * businessDays(dates.start, todayMid > dates.end ? dates.end : todayMid)) / businessDays(dates.start, dates.end));

  const rules = compileRules(config);
  const hasBoardColumn = workItems.some((w) => w.fields && w.fields[fColumn] !== undefined);
  const notes = { warnings: [], excluded: [], unmapped: new Map(), hasBoardColumn };
  const cfgItens = userCfg.itens || {};

  function info(w) {
    const f = w.fields;
    const tags = parseTags(f[fTags]);
    const has = (n) => tags.some((t) => t.toLowerCase() === n);
    const rawTitle = f[fTitle] || "";
    return {
      id: w.id,
      title: cleanTitle(rawTitle),
      state: f[fState],
      column: f[fColumn] || "",
      closedRaw: f[fClosed],
      tags,
      sprint: extractSprintNumber(f[fIter]) ?? extractSprintNumber(rawTitle),
      bug: has("bug"),
      rascunho: has("rascunho"),
      proativo: has("proativo"),
      reforma: has("reforma") || rawTitle.toUpperCase().startsWith("[REFORMA]"),
    };
  }

  // Regras de status/% de um item. Retorna null quando o item não entra no relatório.
  function classify(i, { strict }) {
    const ov = cfgItens[String(i.id)] || {};
    const isClosed = !!i.closedRaw || i.state === "Closed";
    let status, pct, origem;

    if (isClosed) {
      const closedAt = i.closedRaw ? new Date(i.closedRaw) : null;
      const inSprint = !closedAt || closedAt < sprintEndExclusive;
      if (!inSprint) {
        if (strict) notes.excluded.push(`${i.id} (fechado em ${formatDateBR(stripTime(closedAt))}, depois do fim da sprint)`);
        if (strict && !ov.status) return null;
      }
      status = "Publicado"; pct = 100; origem = "entrega";
    } else {
      const col = norm(i.column);
      const rule = col ? rules.find((r) => r.re.test(col)) : null;
      if (rule) {
        status = rule.status; pct = rule.pct; origem = "coluna";
      } else {
        // com BoardColumn no JSON: coluna sem regra = Andamento (e avisa); sem BoardColumn: aproxima pelo estado
        const fb = hasBoardColumn ? { status: "Andamento", pct: "auto" } : STATE_FALLBACK[i.state] || { status: "Andamento", pct: "auto" };
        status = fb.status; pct = fb.pct; origem = hasBoardColumn ? "sem-regra" : "estado";
        if (hasBoardColumn && i.column) {
          if (!notes.unmapped.has(i.column)) notes.unmapped.set(i.column, []);
          notes.unmapped.get(i.column).push(i.id);
        }
      }
    }
    const auto = pct === "auto";
    if (auto) pct = tempo;
    if (ov.status) status = ov.status;
    if (ov.pct !== undefined && ov.pct !== null) { pct = +ov.pct; }
    return { ...i, status, pct: Math.round(pct), pctAuto: auto && (ov.pct === undefined || ov.pct === null), origem };
  }

  const all = workItems.map(info);
  const byId = new Map(all.map((i) => [i.id, i]));

  const ocultar = new Set((userCfg.ocultar || []).map(Number));
  let sel = all.filter((i) => i.sprint === sprint && !i.rascunho && !ocultar.has(i.id));
  if (!includeBugs) sel = sel.filter((i) => !i.bug);
  for (const x of userCfg.ids_extras || []) {
    const b = byId.get(+x);
    if (b && !sel.includes(b)) sel.push(b);
  }
  sel.sort((a, b) => a.id - b.id);

  const itens = sel.map((i) => classify(i, { strict: true })).filter(Boolean);

  if (!hasBoardColumn) {
    notes.warnings.push(
      `O JSON não tem o campo ${fColumn}: usei o estado do Azure como aproximação (Active = Andamento, Resolved = Em testes 80%). ` +
      `Para aplicar as regras por coluna, extraia de novo incluindo ${fColumn} nos campos.`
    );
  }

  // ---- cabeçalho
  const progresso = userCfg.progresso_geral != null
    ? +userCfg.progresso_geral
    : itens.length ? Math.round(itens.reduce((a, i) => a + i.pct, 0) / itens.length) : 0;
  const gap = tempo - progresso;
  const saude = userCfg.saude || (gap <= 15 ? "Saudável" : gap <= 30 ? "Atenção" : "Crítico");
  const periodo = userCfg.periodo || `${formatDateBR(dates.start)} a ${formatDateBR(dates.end)}`;
  const proxima = userCfg.proxima_sprint || `Sprint ${sprint + 1}: ${formatDateBR(nextDates.start)} - ${formatDateBR(nextDates.end)}`;

  // ---- detalhamento (userCfg.detalhamento; se ausente, grupo Reforma automático)
  let detCfg = userCfg.detalhamento;
  if (detCfg == null) {
    const ids = itens.filter((i) => i.reforma).map((i) => i.id);
    detCfg = ids.length ? [{ tipo: "grupo", titulo: "Reforma Tributária:", ids, notas: [] }] : [];
  }
  const detalhamento = [];
  for (const d of detCfg) {
    const tipo = d.tipo || (d.id ? "item" : "grupo");
    if (tipo === "grupo") {
      detalhamento.push({ tipo: "grupo", titulo: d.titulo || "", ids: d.ids || [], notas: d.notas || [], coluna: d.coluna || "esq" });
    } else {
      const base = byId.get(+d.id);
      if (!base) { notes.warnings.push(`Item ${d.id} do detalhamento não existe no JSON.`); continue; }
      const r = classify(base, { strict: false });
      detalhamento.push({
        tipo: "item",
        item: { ...r, proativoFlag: d.proativo !== undefined ? !!d.proativo : base.proativo },
        notas: d.notas || [],
        coluna: d.coluna || "dir",
      });
    }
  }

  // ---- janelas de implantação (userCfg.janelas; se ausente, Pronto GMUD na próxima data de deploy)
  let janCfg = userCfg.janelas;
  if (janCfg == null) {
    const pronto = itens.filter((i) => i.status === "Pronto GMUD").map((i) => i.id);
    janCfg = pronto.length ? [{ data: fmtDateFull(nextDeployDate(todayMid)), itens: pronto }] : [];
  }
  const janelas = janCfg.map((j) => ({
    data: fmtJanelaData(j.data || ""),
    itens: (j.itens || []).map((x) => {
      if (typeof x === "number" || /^\d+$/.test(String(x))) {
        const b = byId.get(+x);
        return b ? b.title : `${x} (não encontrado)`;
      }
      return String(x);
    }),
  }));

  return {
    model: { sprint, periodo, tempo, saude, progresso, itens, detalhamento, janelas, proxima },
    notes,
    dates,
  };
}

module.exports = {
  buildStatusReport,
  currentSprintNumber,
  DEFAULT_COLUMN_RULES,
  BOARD_COLUMN_FIELD,
  norm,
};
