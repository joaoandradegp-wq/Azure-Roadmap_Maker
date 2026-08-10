// lib/transform.js
// Converte work items brutos do Azure DevOps (formato { id, fields: {...} })
// na estrutura roadmap.json consumida pelo render.js (formato Gantt por quinzena).
//
// O que é dinâmico (calculado a cada execução): o ano, os meses mostrados, a
// divisão em quinzenas (com os dias reais de cada mês), a posição exata da
// linha de "hoje" dentro da quinzena, e as datas de início/fim de cada sprint
// numerada (calculadas por cadência fixa de 2 semanas a partir de uma sprint
// de referência em config.sprintCadence — não vêm de campo de data do work item).
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
  naoIniciado: "E53935",
  noPrazo: "8BC34A",
  risco: "FFC107",
  atraso: "E53935",
  pausado: "FF9800",
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

/** Extrai o número da sprint de dentro do Iteration Path (ex: "...\Sprint 09 - Livre e Fleet" -> 9) */
function extractSprintNumber(iterationPath) {
  if (!iterationPath) return null;
  const match = iterationPath.match(/Sprint\s*0*(\d+)/i);
  if (!match) return null;
  return parseInt(match[1], 10);
}

/** Formata o número da sprint como "SP09", "SP10" etc (sempre 2 dígitos, maiúsculo) */
function formatSprintLabel(sprintNumber) {
  if (sprintNumber === null || sprintNumber === undefined) return "";
  return `SP${String(sprintNumber).padStart(2, "0")}`;
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

/** Status de entrega (ícone no fim da barra): previsão, concluída no prazo, ou com atraso */
function mapDeliveryStatus(isClosed, closedRaw, plannedEndRaw) {
  if (!isClosed) return "previsao";
  if (!plannedEndRaw) return "concluidaPrazo"; // sem data planejada para comparar, assume no prazo
  const closed = new Date(closedRaw);
  const plannedEnd = new Date(plannedEndRaw);
  if (isNaN(closed.getTime()) || isNaN(plannedEnd.getTime())) return "concluidaPrazo";
  return closed <= plannedEnd ? "concluidaPrazo" : "concluidaAtraso";
}

/**
 * Transforma a lista de work items brutos + config em um objeto roadmap.json
 * completo, no formato que render.js espera.
 */
function transform(workItems, config, { today = new Date() } = {}) {
  const { fields, statusMapping, timeline: timelineCfg, project, sprintCadence } = config;

  const { start, end } = defaultWindow(timelineCfg.monthsBack, timelineCfg.monthsForward, today);
  const months = buildMonths(start, end);
  const flat = flattenMonths(months);
  const todayFlat = dateToFlatPeriod(today, flat) || flat[flat.length - 1];
  const todayFraction = fractionWithinPeriod(today);

  const roadmap = workItems.map((item) => {
    const f = item.fields;

    const iterationPathRaw = f[fields.iterationPath];
    const sprintNumber = extractSprintNumber(iterationPathRaw);
    const sprintLabel = formatSprintLabel(sprintNumber);
    const rawTitle = f[fields.title] || "";
    const title = sprintLabel ? `${sprintLabel} - ${rawTitle}` : rawTitle;

    const phaseStatus = mapPhaseStatus(f, fields, statusMapping);

    const closedRaw = f[fields.closedDate];
    const isClosed = !!closedRaw;
    const plannedEndRaw = f[fields.plannedEnd];
    const deliveryStatus = mapDeliveryStatus(isClosed, closedRaw, plannedEndRaw);

    // Datas da barra: se o item tem sprint numerada reconhecível, usa a janela
    // fixa de 2 semanas calculada dessa sprint (início = quando entrou na
    // sprint; fim = fim da sprint, ou ClosedDate se já concluído). Sem sprint
    // reconhecível, cai no fallback antigo (campos de data do próprio item).
    const sprintDates = sprintNumber !== null ? computeSprintDates(sprintNumber, sprintCadence) : null;

    let startRaw;
    if (sprintDates) {
      startRaw = sprintDates.start;
    } else {
      startRaw = f[fields.actualStart] || f[fields.plannedStart];
    }
    const startFlat = (startRaw && dateToFlatPeriod(startRaw, flat)) || flat[0];

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
    let endFlat = dateToFlatPeriod(endRaw, flat) || flat[flat.length - 1];
    if (endFlat.flatIndex < startFlat.flatIndex) endFlat = startFlat; // nunca terminar antes de começar

    return {
      id: item.id,
      title,
      phaseStatus,
      deliveryStatus,
      startPeriod: { month: startFlat.month, subcolIndex: startFlat.subcolIndex },
      endPeriod: { month: endFlat.month, subcolIndex: endFlat.subcolIndex },
    };
  });

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
  computeSprintDates,
};
