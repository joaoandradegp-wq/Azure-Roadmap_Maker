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
const SPRINT_TITLE_PREFIX_RE = /^\s*Sprint\s*0*\d+\s*-\s*Livre e Fleet\s*-\s*/i;
const SPRINT_DURATION_TAG_RE = /^(\d+)\s*sprints?$/i;

function extractSprintNumber(text) {
  if (!text) return null;
  const match = text.match(SPRINT_NUMBER_RE);
  if (!match) return null;
  return parseInt(match[1], 10);
}

function extractSprintDurationTag(tagsRaw) {
  if (!tagsRaw) return null;
  const tags = tagsRaw.split(";").map((t) => t.trim());
  let max = null;
  for (const tag of tags) {
    const match = tag.match(SPRINT_DURATION_TAG_RE);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > 0 && (max === null || n > max)) max = n;
    }
  }
  return max;
}

function formatSprintLabel(sprintNumber) {
  if (sprintNumber === null || sprintNumber === undefined) return "";
  return `SP${String(sprintNumber).padStart(2, "0")}`;
}

function stripSprintPrefixFromTitle(rawTitle) {
  if (!rawTitle) return rawTitle;
  return rawTitle.replace(SPRINT_TITLE_PREFIX_RE, "");
}

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

const DEPLOY_WEEKDAYS = [2, 4];

function stripTime(date) {
  if (!date) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function nextDeployDate(date) {
  if (!date) return null;
  const d = stripTime(date);
  while (!DEPLOY_WEEKDAYS.includes(d.getDay())) {
    d.setDate(d.getDate() + 1);
  }
  return avoidLastWeekOfMonth(d);
}

function isLastWeekOfMonth(date) {
  const lastDayOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return date.getDate() > lastDayOfMonth - 7;
}

function firstDeployDayOfMonth(year, month) {
  let d = new Date(year, month, 1);
  while (!DEPLOY_WEEKDAYS.includes(d.getDay())) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

function avoidLastWeekOfMonth(date) {
  if (!date) return date;
  if (isLastWeekOfMonth(date)) {
    return firstDeployDayOfMonth(date.getFullYear(), date.getMonth() + 1);
  }
  return date;
}

function deployDateForClosure(closedDate) {
  if (!closedDate) return null;
  const normalized = stripTime(closedDate);
  const prevDay = new Date(normalized.getTime());
  prevDay.setDate(prevDay.getDate() - 1);
  if (DEPLOY_WEEKDAYS.includes(prevDay.getDay())) {
    return avoidLastWeekOfMonth(prevDay);
  }
  return normalized;
}

function formatDateBR(date) {
  if (!date) return null;
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

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

function mapDeliveryStatus(isClosed, actualDeployDate, plannedDeployDate) {
  if (!isClosed) return "previsao";
  if (!plannedDeployDate || !actualDeployDate) return "concluidaPrazo";
  return actualDeployDate <= plannedDeployDate ? "concluidaPrazo" : "concluidaAtraso";
}

function toDate(x) {
  if (x instanceof Date) return stripTime(x);
  if (!x) return null;
  const d = new Date(x);
  return isNaN(d.getTime()) ? null : stripTime(d);
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !aEnd) return false;
  return aEnd >= bStart && aStart <= bEnd;
}

function transform(workItems, config, { today = new Date() } = {}) {
  const { fields, statusMapping, timeline: timelineCfg, project, sprintCadence } = config;
  const todayMidnight = stripTime(today);

  const { start: windowStart, end: windowEndMonth } = defaultWindow(
    timelineCfg.monthsBack,
    timelineCfg.monthsForward,
    today
  );

  const windowEnd = new Date(windowEndMonth.getFullYear(), windowEndMonth.getMonth() + 1, 0);

  const months = buildMonths(windowStart, windowEndMonth);
  const flat = flattenMonths(months);
  const todayFlat = dateToFlatPeriod(today, flat) || flat[flat.length - 1];
  const todayFraction = fractionWithinPeriod(today);

  const roadmap = [];

  for (const item of workItems) {
    const f = item.fields;

    const tagsRaw = f[fields.tags] || "";
    const tags = tagsRaw.split(";").map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (tags.includes("bug") || tags.includes("rascunho")) continue;

    const iterationPathRaw = f[fields.iterationPath];
    const rawTitle = f[fields.title] || "";

    const sprintNumber = extractSprintNumber(iterationPathRaw) ?? extractSprintNumber(rawTitle);
    const sprintLabel = formatSprintLabel(sprintNumber);
    const cleanedTitle = stripSprintPrefixFromTitle(rawTitle);
    const title = sprintLabel ? `${sprintLabel} - ${cleanedTitle}` : cleanedTitle;

    const phaseStatus = mapPhaseStatus(f, fields, statusMapping);

    const closedRaw = f[fields.closedDate];
    const isClosed = !!closedRaw;
    const plannedEndRaw = f[fields.plannedEnd];

    const sprintDates = sprintNumber !== null ? computeSprintDates(sprintNumber, sprintCadence) : null;

    let sprintDatesForDelivery = sprintDates;
    const sprintDurationTag = extractSprintDurationTag(tagsRaw);
    if (sprintDates && sprintDurationTag && sprintDurationTag > 1) {
      const targetSprintNumber = sprintNumber + (sprintDurationTag - 1);
      const targetSprintDates = computeSprintDates(targetSprintNumber, sprintCadence);
      if (targetSprintDates) {
        sprintDatesForDelivery = { start: sprintDates.start, end: targetSprintDates.end };
      }
    }

    let startRaw;
    if (sprintDates) {
      startRaw = sprintDates.start;
    } else {
      startRaw = f[fields.actualStart] || f[fields.plannedStart];
    }

    const referenceEndForDelivery = sprintDatesForDelivery ? sprintDatesForDelivery.end : plannedEndRaw;
    const referenceEndDate = toDate(referenceEndForDelivery);
    const plannedDeployDate = referenceEndDate ? nextDeployDate(referenceEndDate) : null;
    const actualDeployDate = isClosed ? deployDateForClosure(toDate(closedRaw)) : null;
    const forecastLapsed = !plannedDeployDate || plannedDeployDate < todayMidnight;
    let forecastDate = forecastLapsed ? nextDeployDate(todayMidnight) : plannedDeployDate;
    const forecastBeforeNaoIniciadoSkip = forecastDate;

    let skippedForNaoIniciado = false;
    if (phaseStatus === "naoIniciado" && forecastLapsed) {
      const dayAfter = new Date(forecastDate.getTime());
      dayAfter.setDate(dayAfter.getDate() + 1);
      forecastDate = nextDeployDate(dayAfter);
      skippedForNaoIniciado = true;
    }

    let endRaw;
    if (isClosed) {
      endRaw = actualDeployDate; 
    } else if (sprintDates || plannedEndRaw) {
      endRaw = forecastDate; 
    } else {
      endRaw = today;
    }

    const startDateObj = toDate(startRaw);
    const endDateObj = toDate(endRaw);


    if (!overlaps(startDateObj, endDateObj, windowStart, windowEnd)) continue;

    const deliveryStatus = mapDeliveryStatus(isClosed, actualDeployDate, plannedDeployDate);

    const isExplicitlyExempt =
      tags.includes("pausado") || tags.includes("bloqueado") || tags.includes("blocked");
    const notDeliveredInSprint =
      (isClosed && deliveryStatus === "concluidaAtraso") || (!isClosed && forecastLapsed);
    const finalPhaseStatus =
      notDeliveredInSprint && !isExplicitlyExempt ? "atraso" : phaseStatus;

    let plannedDateOut = null;
    let actualDateOut = null;
    if (!isClosed) {
      if (skippedForNaoIniciado) {
        plannedDateOut = formatDateBR(forecastBeforeNaoIniciadoSkip);
      }
      actualDateOut = formatDateBR(forecastDate);
    } else {
      const deliveredOnPlannedDate =
        plannedDeployDate &&
        actualDeployDate &&
        actualDeployDate.getTime() === plannedDeployDate.getTime();
      if (plannedDeployDate && actualDeployDate && !deliveredOnPlannedDate) {
        plannedDateOut = formatDateBR(plannedDeployDate); 
        actualDateOut = formatDateBR(actualDeployDate);
      } else {
        actualDateOut = formatDateBR(actualDeployDate); 
      }
    }

    const startFlat = (startDateObj && dateToFlatPeriod(startDateObj, flat)) || flat[0];
    let endFlat = (endDateObj && dateToFlatPeriod(endDateObj, flat)) || flat[flat.length - 1];
    let startFraction = startDateObj ? fractionWithinPeriod(startDateObj) : 0;
    let endFraction = endDateObj ? fractionWithinPeriod(endDateObj) : 0;
    if (endFlat.flatIndex < startFlat.flatIndex) {
      endFlat = startFlat; 
      endFraction = startFraction;
    }

    roadmap.push({
      id: item.id,
      title,
      phaseStatus: finalPhaseStatus,
      deliveryStatus,
      startPeriod: { month: startFlat.month, subcolIndex: startFlat.subcolIndex, fraction: startFraction },
      endPeriod: { month: endFlat.month, subcolIndex: endFlat.subcolIndex, fraction: endFraction },
      plannedDate: plannedDateOut,
      actualDate: actualDateOut,
    });
  }

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
  nextDeployDate,
  deployDateForClosure,
  formatDateBR,
  stripTime,
  isLastWeekOfMonth,
  firstDeployDayOfMonth,
  avoidLastWeekOfMonth,
};
