// lib/transform.js
// Converte work items brutos do Azure DevOps (formato { id, fields: {...} })
// na estrutura roadmap.json consumida pelo render.js (formato Gantt por quinzena).
//
// O que é dinâmico (calculado a cada execução): o ano, os meses mostrados, a
// divisão em quinzenas (com os dias reais de cada mês), a posição exata da
// linha de "hoje" dentro da quinzena, e as datas de início/fim de cada sprint
// numerada (calculadas por cadência fixa a partir de config.sprintCadence).
//
// Regras de negócio aplicadas aqui (não vêm do Azure prontas):
//   - Número da sprint: procurado no Iteration Path OU, se não achar, no
//     próprio texto do título (alguns cards têm "Sprint NN - Livre e Fleet -"
//     digitado manualmente no título, sem estar de fato na iteration certa).
//     O prefixo é removido do texto e recolocado formatado como "SPNN".
//   - Item só entra no roadmap.json se a sprint dele (início OU fim) cair
//     dentro da janela monthsBack/monthsForward — sprints muito antigas ou
//     muito futuras são descartadas, não "espremidas" na borda da janela.
//   - Itens com a tag "Bug" são ignorados (mesmo que a WIQL já filtre isso,
//     aqui fica como segunda camada de proteção).
//   - "Concluída com atraso" = fechou depois do fim da sprint dele (ou seja,
//     transbordou pra uma sprint futura). "Concluída no prazo" = fechou
//     dentro da janela da própria sprint.
//   - Lista final ordenada alfabeticamente pelo título exibido.
//
// Datas planejada/real por item (mostradas do lado do checkmark) ficam de
// fora por enquanto — o render.js já lida bem com a ausência delas.

const {
  buildMonths,
  flattenMonths,
  dateToFlatPeriod,
  fractionWithinPeriod,
  defaultWindow,
} = require("./period");

const DEFAULT_PHASE_COLORS = {
  naoIniciado: "BFBFBF",
  noPrazo: "70AD47",
  risco: "FFC000",
  atraso: "C00000",
  pausado: "E97132",
};
const DEFAULT_PHASE_LABELS = {
  naoIniciado: "Não iniciado",
  noPrazo: "No prazo",
  risco: "Risco de atraso",
  atraso: "Atraso",
  pausado: "Pausado",
};
const DEFAULT_DELIVERY_COLORS = {
  previsao: "9E9E9E",
  concluidaPrazo: "4CAF50",
  concluidaAtraso: "E67E22",
};
const DEFAULT_DELIVERY_LABELS = {
  previsao: "Previsão",
  concluidaPrazo: "Concluída no prazo",
  concluidaAtraso: "Concluída com atraso",
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SPRINT_NUMBER_RE = /Sprint\s*0*(\d+)/i;
// Remove um prefixo tipo "Sprint 09 - Livre e Fleet - " digitado no início do título
const SPRINT_TITLE_PREFIX_RE = /^\s*Sprint\s*0*\d+\s*-\s*Livre e Fleet\s*-\s*/i;

/** Extrai o número da sprint de um texto qualquer (Iteration Path ou título) */
function extractSprintNumber(text) {
  if (!text) return null;
  const match = text.match(SPRINT_NUMBER_RE);
  if (!match) return null;
  return parseInt(match[1], 10);
}

/** Formata o número da sprint como "SP09", "SP10" etc (sempre 2 dígitos, maiúsculo) */
function formatSprintLabel(sprintNumber) {
  if (sprintNumber === null || sprintNumber === undefined) return "";
  return `SP${String(sprintNumber).padStart(2, "0")}`;
}

/** Tira o prefixo "Sprint NN - Livre e Fleet - " do início do título, se existir */
function stripSprintPrefixFromTitle(rawTitle) {
  if (!rawTitle) return rawTitle;
  return rawTitle.replace(SPRINT_TITLE_PREFIX_RE, "");
}

/**
 * Calcula o início/fim (Date) de uma sprint numerada, a partir de uma sprint
 * de referência com cadência fixa (ex: 14 dias entre início de sprints
 * consecutivas). Funciona pra frente e pra trás automaticamente.
 */
function computeSprintDates(sprintNumber, sprintCadence) {
  if (!sprintCadence) return null;
  const { referenceSprintNumber, referenceStart, referenceEnd, cadenceDays } = sprintCadence;
  const diffSprints = sprintNumber - referenceSprintNumber;
  const offsetMs = diffSprints * cadenceDays * MS_PER_DAY;

  const refStart = new Date(referenceStart + "T00:00:00");
  const refEnd = new Date(referenceEnd + "T00:00:00");

  return {
    start: new Date(refStart.getTime() + offsetMs),
    end: new Date(refEnd.getTime() + offsetMs),
  };
}

/** Status de fase (coluna "Status" / legenda superior) — tag tem prioridade sobre o state */
function mapPhaseStatus(fieldsRaw, fields, statusMapping) {
  const tagsRaw = fieldsRaw[fields.tags] || "";
  const tags = tagsRaw.split(";").map((t) => t.trim()).filter(Boolean);

  for (const tag of tags) {
    if (statusMapping.byTag && statusMapping.byTag[tag]) {
      return statusMapping.byTag[tag];
    }
  }

  const state = fieldsRaw[fields.state];
  return (statusMapping.byState && statusMapping.byState[state]) || "naoIniciado";
}

/**
 * Status de entrega (ícone no fim da barra). "referenceEndRaw" é a data contra
 * a qual comparamos o fechamento — o fim da sprint do item quando disponível,
 * senão o campo de data planejada (fallback pra itens sem sprint numerada).
 * Fechou depois dessa referência = transbordou pra uma sprint futura = atraso.
 */
function mapDeliveryStatus(isClosed, closedRaw, referenceEndRaw) {
  if (!isClosed) return "previsao";
  if (!referenceEndRaw) return "concluidaPrazo";
  const closed = new Date(closedRaw);
  const referenceEnd = new Date(referenceEndRaw);
  if (isNaN(closed.getTime()) || isNaN(referenceEnd.getTime())) return "concluidaPrazo";
  return closed <= referenceEnd ? "concluidaPrazo" : "concluidaAtraso";
}

function toDate(x) {
  if (x instanceof Date) return x;
  if (!x) return null;
  const d = new Date(x);
  return isNaN(d.getTime()) ? null : d;
}

/** true se [aStart,aEnd] tem qualquer sobreposição com [bStart,bEnd] */
function overlaps(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !aEnd) return false;
  return aEnd >= bStart && aStart <= bEnd;
}

/**
 * Transforma a lista de work items brutos + config em um objeto roadmap.json
 * completo, no formato que render.js espera.
 */
function transform(workItems, config, { today = new Date() } = {}) {
  const { fields, statusMapping, timeline: timelineCfg, project, sprintCadence } = config;

  const { start: windowStart, end: windowEndMonth } = defaultWindow(
    timelineCfg.monthsBack,
    timelineCfg.monthsForward,
    today
  );
  // fim de verdade da janela = último dia do mês final (não o dia 1 dele),
  // pra não excluir itens que caem no meio/fim desse último mês
  const windowEnd = new Date(windowEndMonth.getFullYear(), windowEndMonth.getMonth() + 1, 0);

  const months = buildMonths(windowStart, windowEndMonth);
  const flat = flattenMonths(months);
  const todayFlat = dateToFlatPeriod(today, flat) || flat[flat.length - 1];
  const todayFraction = fractionWithinPeriod(today);

  const roadmap = [];

  for (const item of workItems) {
    const f = item.fields;

    // ---- Tag "Bug": ignora o item inteiro ----
    const tagsRaw = f[fields.tags] || "";
    const tags = tagsRaw.split(";").map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (tags.includes("bug")) continue;

    const iterationPathRaw = f[fields.iterationPath];
    const rawTitle = f[fields.title] || "";

    // sprint: tenta pelo Iteration Path primeiro, senão procura no próprio título
    const sprintNumber = extractSprintNumber(iterationPathRaw) ?? extractSprintNumber(rawTitle);
    const sprintLabel = formatSprintLabel(sprintNumber);
    const cleanedTitle = stripSprintPrefixFromTitle(rawTitle);
    const title = sprintLabel ? `${sprintLabel} - ${cleanedTitle}` : cleanedTitle;

    const phaseStatus = mapPhaseStatus(f, fields, statusMapping);

    const closedRaw = f[fields.closedDate];
    const isClosed = !!closedRaw;
    const plannedEndRaw = f[fields.plannedEnd];

    const sprintDates = sprintNumber !== null ? computeSprintDates(sprintNumber, sprintCadence) : null;

    let startRaw;
    if (sprintDates) {
      startRaw = sprintDates.start;
    } else {
      startRaw = f[fields.actualStart] || f[fields.plannedStart];
    }

    let endRaw;
    if (isClosed) {
      endRaw = closedRaw;
    } else if (sprintDates) {
      endRaw = sprintDates.end;
    } else if (plannedEndRaw) {
      endRaw = plannedEndRaw;
    } else {
      endRaw = today;
    }

    const startDateObj = toDate(startRaw);
    const endDateObj = toDate(endRaw);

    // ---- Filtro de janela: sprint (ou datas) tem que tocar os N meses pra trás/frente ----
    if (!overlaps(startDateObj, endDateObj, windowStart, windowEnd)) continue;

    const referenceEndForDelivery = sprintDates ? sprintDates.end : plannedEndRaw;
    const deliveryStatus = mapDeliveryStatus(isClosed, closedRaw, referenceEndForDelivery);

    const startFlat = (startDateObj && dateToFlatPeriod(startDateObj, flat)) || flat[0];
    let endFlat = (endDateObj && dateToFlatPeriod(endDateObj, flat)) || flat[flat.length - 1];
    if (endFlat.flatIndex < startFlat.flatIndex) endFlat = startFlat; // nunca terminar antes de começar

    roadmap.push({
      id: item.id,
      title,
      phaseStatus,
      deliveryStatus,
      startPeriod: { month: startFlat.month, subcolIndex: startFlat.subcolIndex },
      endPeriod: { month: endFlat.month, subcolIndex: endFlat.subcolIndex },
    });
  }

  // ---- Ordenação alfabética pelo título exibido ----
  roadmap.sort((a, b) => a.title.localeCompare(b.title, "pt-BR", { sensitivity: "base" }));

  return {
    project: {
      squad: project.squad,
      title: project.title || project.name || "",
      reportDate: today.toISOString().slice(0, 10),
    },
    months: months.map((m) => ({ name: m.name, subcols: m.subcols })),
    todayPeriod: {
      month: todayFlat.month,
      subcolIndex: todayFlat.subcolIndex,
      fraction: todayFraction,
    },
    phaseColors: DEFAULT_PHASE_COLORS,
    phaseLabels: DEFAULT_PHASE_LABELS,
    deliveryColors: DEFAULT_DELIVERY_COLORS,
    deliveryLabels: DEFAULT_DELIVERY_LABELS,
    roadmap,
  };
}

module.exports = {
  transform,
  mapPhaseStatus,
  mapDeliveryStatus,
  extractSprintNumber,
  formatSprintLabel,
  stripSprintPrefixFromTitle,
  computeSprintDates,
};
