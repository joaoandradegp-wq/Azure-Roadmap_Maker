const MONTH_ABBR = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

function orderOf(year, monthIndex, half) {
  return year * 24 + monthIndex * 2 + half;
}

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

function generatePeriods(startDate, endDate) {
  return generatePeriodsWithOrder(startDate, endDate).map((p) => p.label);
}

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

function defaultWindow(monthsBack = 4, monthsForward = 2, today = new Date()) {
  const start = new Date(today.getFullYear(), today.getMonth() - monthsBack, 1);
  const end = new Date(today.getFullYear(), today.getMonth() + monthsForward, 1);
  return { start, end };
}

const MONTH_FULL = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

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

  const target = year * 24 + d.getMonth() * 2 + half;
  const firstOrder = flat[0].year * 24 + MONTH_FULL.indexOf(flat[0].month) * 2 + flat[0].subcolIndex;
  return target < firstOrder ? flat[0] : flat[flat.length - 1];
}

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
