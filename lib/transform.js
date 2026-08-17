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

// Dias fixos de deploy: terça (2) e quinta (4) — getDay(): dom=0, seg=1, ter=2, qua=3, qui=4, sex=5, sáb=6
const DEPLOY_WEEKDAYS = [2, 4];

/** Remove a hora, deixando só a data (meia-noite local) — evita bugs de comparação
 * entre uma data "só dia" (ex: fim de sprint calculado) e uma data com timestamp
 * de hora dentro (ex: ClosedDate do Azure, tipo "2026-08-11T14:32:00Z"). Sem isso,
 * "11/08 14:32" comparava como "depois de" "11/08 00:00", mesmo sendo o mesmo dia. */
function stripTime(date) {
  if (!date) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Primeira terça ou quinta-feira a partir da data informada (inclusive).
 * Se a própria data já for terça/quinta, retorna ela mesma. Nunca cai na
 * última semana do mês (ver avoidLastWeekOfMonth) — não tem deploy nessa janela.
 */
function nextDeployDate(date) {
  if (!date) return null;
  const d = stripTime(date);
  while (!DEPLOY_WEEKDAYS.includes(d.getDay())) {
    d.setDate(d.getDate() + 1);
  }
  return avoidLastWeekOfMonth(d);
}

/** true se a data cai nos últimos 7 dias do mês dela (não tem deploy nessa janela) */
function isLastWeekOfMonth(date) {
  const lastDayOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return date.getDate() > lastDayOfMonth - 7;
}

/** Primeira terça ou quinta-feira do mês informado (0-indexado, como Date.getMonth()) */
function firstDeployDayOfMonth(year, month) {
  let d = new Date(year, month, 1);
  while (!DEPLOY_WEEKDAYS.includes(d.getDay())) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

/**
 * Regra de negócio: não tem deploy na última semana do mês. Se a data cair
 * nela, recalcula pra primeira terça/quinta do mês SEGUINTE.
 */
function avoidLastWeekOfMonth(date) {
  if (!date) return date;
  if (isLastWeekOfMonth(date)) {
    return firstDeployDayOfMonth(date.getFullYear(), date.getMonth() + 1);
  }
  return date;
}

/**
 * Data real de deploy a partir do fechamento (ClosedDate) do card, corrigindo
 * a defasagem comum de "moveram o card pra Closed na manhã seguinte ao deploy
 * de verdade". Se o dia anterior ao fechamento já é dia de deploy (terça ou
 * quinta), assume que foi entregue nesse dia anterior — não avança pra próxima
 * janela. Só corrige 1 dia pra trás; qualquer defasagem maior é tratada como
 * fechamento de fato fora do dia de deploy, e aí sim avança pro próximo.
 */
function deployDateForClosure(closedDate) {
  if (!closedDate) return null;
  const normalized = stripTime(closedDate);
  const prevDay = new Date(normalized.getTime());
  prevDay.setDate(prevDay.getDate() - 1);
  if (DEPLOY_WEEKDAYS.includes(prevDay.getDay())) {
    return avoidLastWeekOfMonth(prevDay);
  }
  return nextDeployDate(normalized);
}

/** Formata uma Date como "DD/MM" */
function formatDateBR(date) {
  if (!date) return null;
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
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
 * Status de entrega (ícone no fim da barra). Compara as datas de DEPLOY já
 * calculadas (não as datas brutas do Azure) — "actualDeployDate" já vem
 * corrigida pela defasagem de fechamento tardio (ver deployDateForClosure),
 * então esse é o critério certo pra decidir se foi no prazo ou atrasou.
 */
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
  const todayMidnight = stripTime(today);

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

    // ---- Tags "Bug" e "RASCUNHO": ignora o item inteiro ----
    const tagsRaw = f[fields.tags] || "";
    const tags = tagsRaw.split(";").map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (tags.includes("bug") || tags.includes("rascunho")) continue;

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

    // ---- Data de deploy: sempre a próxima terça/quinta a partir da referência ----
    // Calculada ANTES de decidir o fim da barra, porque o fim da barra (e o
    // ícone) precisam usar exatamente essa mesma data — não a data crua da
    // sprint — senão a barra fica num dia e o texto/linha de "hoje" em outro.
    const referenceEndForDelivery = sprintDates ? sprintDates.end : plannedEndRaw;
    const referenceEndDate = toDate(referenceEndForDelivery);
    const plannedDeployDate = referenceEndDate ? nextDeployDate(referenceEndDate) : null;
    const actualDeployDate = isClosed ? deployDateForClosure(toDate(closedRaw)) : null;

    // Previsão nunca mostra (nem posiciona a barra em) uma data que já passou:
    // se o deploy previsto já ficou pra trás e o item ainda está aberto, empurra
    // pro próximo dia de deploy a partir de hoje.
    const forecastLapsed = !plannedDeployDate || plannedDeployDate < todayMidnight;
    let forecastDate = forecastLapsed ? nextDeployDate(todayMidnight) : plannedDeployDate;
    // guarda o valor "antes" do pulo extra de item não iniciado, pra poder
    // mostrar riscado caso esse pulo aconteça (ver bloco abaixo)
    const forecastBeforeNaoIniciadoSkip = forecastDate;

    // Item "Não iniciado" não deveria prometer o deploy imediato — se caiu no
    // caso acima (a previsão original já passou, por isso empurrou pro deploy
    // mais próximo a partir de hoje), pula mais um ciclo: usa o deploy SEGUINTE
    // a esse, já que um item que nem começou não sai amanhã/depois de amanhã.
    let skippedForNaoIniciado = false;
    if (phaseStatus === "naoIniciado" && forecastLapsed) {
      const dayAfter = new Date(forecastDate.getTime());
      dayAfter.setDate(dayAfter.getDate() + 1);
      forecastDate = nextDeployDate(dayAfter);
      skippedForNaoIniciado = true;
    }

    let endRaw;
    if (isClosed) {
      endRaw = actualDeployDate; // mesma data (já corrigida) usada no texto — não o ClosedDate cru
    } else if (sprintDates || plannedEndRaw) {
      endRaw = forecastDate; // mesma data usada no texto da previsão
    } else {
      endRaw = today;
    }

    const startDateObj = toDate(startRaw);
    const endDateObj = toDate(endRaw);

    // ---- Filtro de janela: sprint (ou datas) tem que tocar os N meses pra trás/frente ----
    if (!overlaps(startDateObj, endDateObj, windowStart, windowEnd)) continue;

    // status calculado em cima das datas de deploy já corrigidas, não das datas
    // brutas do Azure — evita marcar "atraso" um item cujo card só foi fechado
    // no sistema no dia seguinte ao deploy de verdade
    const deliveryStatus = mapDeliveryStatus(isClosed, actualDeployDate, plannedDeployDate);

    // Cards que não foram entregues dentro da própria sprint (fechou depois do
    // previsto, ou ainda está aberto com a previsão já vencida) usam a bolinha
    // vermelha de "Atraso" no Status — sobrepõe o que veio do State/Tag do
    // Azure, exceto se o item estiver explicitamente marcado como Pausado ou
    // Bloqueado (essas tags são uma decisão/situação deliberada, não um atraso
    // "silencioso" — não fazem sentido serem escondidas atrás da mesma bolinha
    // vermelha genérica de "não entregue na sprint").
    const isExplicitlyExempt =
      tags.includes("pausado") || tags.includes("bloqueado") || tags.includes("blocked");
    const notDeliveredInSprint =
      (isClosed && deliveryStatus === "concluidaAtraso") || (!isClosed && forecastLapsed);
    const finalPhaseStatus =
      notDeliveredInSprint && !isExplicitlyExempt ? "atraso" : phaseStatus;

    let plannedDateOut = null;
    let actualDateOut = null;
    if (!isClosed) {
      // O "riscado + nova data" só aparece quando o item "não iniciado" pulou
      // um ciclo extra (ver bloco acima) — pra deixar claro que aquela data
      // mais próxima não vale pra ele. Fora esse caso, um item ainda aberto
      // cuja previsão simplesmente avançou (o que é normal, não é atraso) só
      // mostra a data nova, sem riscado — riscar aqui sugeria erroneamente
      // que o item já deveria ter sido entregue antes.
      if (skippedForNaoIniciado) {
        plannedDateOut = formatDateBR(forecastBeforeNaoIniciadoSkip);
      }
      actualDateOut = formatDateBR(forecastDate); // previsão (nova, se precisou empurrar)
    } else if (deliveryStatus === "concluidaAtraso") {
      plannedDateOut = formatDateBR(plannedDeployDate); // deploy que era esperado (riscado)
      actualDateOut = formatDateBR(actualDeployDate); // deploy real
    } else {
      actualDateOut = formatDateBR(actualDeployDate); // deploy real, dentro do prazo
    }

    const startFlat = (startDateObj && dateToFlatPeriod(startDateObj, flat)) || flat[0];
    let endFlat = (endDateObj && dateToFlatPeriod(endDateObj, flat)) || flat[flat.length - 1];
    let startFraction = startDateObj ? fractionWithinPeriod(startDateObj) : 0;
    let endFraction = endDateObj ? fractionWithinPeriod(endDateObj) : 0;
    if (endFlat.flatIndex < startFlat.flatIndex) {
      endFlat = startFlat; // nunca terminar antes de começar
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
  nextDeployDate,
  deployDateForClosure,
  formatDateBR,
  stripTime,
  isLastWeekOfMonth,
  firstDeployDayOfMonth,
  avoidLastWeekOfMonth,
};
