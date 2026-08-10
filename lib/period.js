// lib/period.js
// Gera a lista de períodos (quinzenas) do roadmap e mapeia uma data para o período correspondente.
// Períodos são rotulados como "Abr-1", "Abr-2" etc. Internamente cada período tem uma
// "order" (year*24 + monthIndex*2 + half) para permitir comparação cronológica correta
// mesmo quando a janela cruza a virada do ano.

const MONTH_ABBR = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

function orderOf(year, monthIndex, half) {
  // half: 0 (dias 1-15) ou 1 (dias 16-fim)
  return year * 24 + monthIndex * 2 + half;
}

/**
 * Gera a lista ordenada de períodos entre duas datas (inclusive), cada um com
 * { label, order }. label é só o texto ("Abr-1"), sem ano — como no JSON.
 */
function generatePeriodsWithOrder(startDate, endDate) {
  const periods = [];
  let year = startDate.getFullYear();
  let month = startDate.getMonth();
  const endOrder = orderOf(endDate.getFullYear(), endDate.getMonth(), 1);

  while (orderOf(year, month, 0) <= endOrder) {
    const label = MONTH_ABBR[month];
    periods.push({ label: `${label}-1`, order: orderOf(year, month, 0) });
    periods.push({ label: `${label}-2`, order: orderOf(year, month, 1) });
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return periods;
}

/** Versão simples: só os labels, na ordem — é o que vai para roadmap.json */
function generatePeriods(startDate, endDate) {
  return generatePeriodsWithOrder(startDate, endDate).map((p) => p.label);
}

/**
 * Dada uma data, retorna { label, order } do período quinzenal correspondente.
 */
function dateToPeriod(date) {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return null;
  const half = d.getDate() <= 15 ? 0 : 1;
  return {
    label: `${MONTH_ABBR[d.getMonth()]}-${half + 1}`,
    order: orderOf(d.getFullYear(), d.getMonth(), half),
  };
}

/**
 * Calcula a janela padrão de datas: hoje - monthsBack até hoje + monthsForward.
 */
function defaultWindow(monthsBack = 4, monthsForward = 2, today = new Date()) {
  const start = new Date(today.getFullYear(), today.getMonth() - monthsBack, 1);
  const end = new Date(today.getFullYear(), today.getMonth() + monthsForward, 1);
  return { start, end };
}

// ---------------------------------------------------------------------
// Funções para o formato de grade usado pelo render.js (Gantt por quinzena)
// meses com nome completo ("Abril", não "Abr") e subcols com os dias reais
// de cada mês (ex: "16-30" em Abril, "16-31" em Maio, "16-28" em Fevereiro).
// ---------------------------------------------------------------------

const MONTH_FULL = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/**
 * Gera a lista de meses (com ano) entre startDate e endDate, cada um com
 * { name, year, subcols: ["1-15", "16-N"] } — N é o último dia real do mês.
 *
 * LIMITAÇÃO: o slide (render.js) mostra um único rótulo de "ano" acima da
 * grade inteira. Se a janela cruzar a virada do ano (ex: Nov -> Fev), os
 * meses do ano seguinte ainda aparecem corretamente na grade, mas o rótulo
 * de ano mostrado será só o do primeiro mês da janela.
 */
function buildMonths(startDate, endDate) {
  const months = [];
  let year = startDate.getFullYear();
  let month = startDate.getMonth();
  const endYear = endDate.getFullYear();
  const endMonth = endDate.getMonth();

  while (year < endYear || (year === endYear && month <= endMonth)) {
    const lastDay = new Date(year, month + 1, 0).getDate();
    months.push({
      name: MONTH_FULL[month],
      year,
      subcols: ["1-15", `16-${lastDay}`],
    });
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return months;
}

/**
 * Achata months (de buildMonths) em uma lista de
 * { month, year, subcolIndex, flatIndex } — uma entrada por quinzena.
 */
function flattenMonths(months) {
  const flat = [];
  let idx = 0;
  months.forEach((m) => {
    m.subcols.forEach((_, i) => {
      flat.push({ month: m.name, year: m.year, subcolIndex: i, flatIndex: idx });
      idx += 1;
    });
  });
  return flat;
}

/**
 * Encontra, na lista achatada de períodos, aquele que contém a data informada.
 * Se a data cai fora da janela (antes do início ou depois do fim), "prende"
 * (clamp) no primeiro ou último período — assim uma barra nunca desaparece
 * por ter uma data fora da janela configurada.
 */
function dateToFlatPeriod(date, flat) {
  if (!date || flat.length === 0) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return null;

  const monthName = MONTH_FULL[d.getMonth()];
  const year = d.getFullYear();
  const half = d.getDate() <= 15 ? 0 : 1;

  const found = flat.find(
    (p) => p.month === monthName && p.year === year && p.subcolIndex === half
  );
  if (found) return found;

  // fora da janela: prende na ponta mais próxima
  const target = year * 24 + d.getMonth() * 2 + half;
  const firstOrder = flat[0].year * 24 + MONTH_FULL.indexOf(flat[0].month) * 2 + flat[0].subcolIndex;
  return target < firstOrder ? flat[0] : flat[flat.length - 1];
}

/**
 * Posição fracionária (0 a 1) de uma data dentro da sua quinzena.
 * Dia 1 → 0.0 (início da célula), dia 15 → 1.0 (fim da 1ª metade);
 * dia 16 → 0.0, último dia do mês → 1.0 (fim da 2ª metade).
 * Usado para posicionar a linha de "hoje" no lugar exato dentro da célula,
 * em vez de sempre "grudada" no início dela.
 */
function fractionWithinPeriod(date) {
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return 0;
  const day = d.getDate();
  if (day <= 15) {
    return (day - 1) / 14;
  }
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const span = lastDay - 16;
  if (span <= 0) return 0;
  return Math.min(1, (day - 16) / span);
}

module.exports = {
  generatePeriods,
  generatePeriodsWithOrder,
  dateToPeriod,
  defaultWindow,
  buildMonths,
  flattenMonths,
  dateToFlatPeriod,
  fractionWithinPeriod,
  MONTH_ABBR,
  MONTH_FULL,
};
