// lib/sprintUtils.js
// Portado do transform.js do projeto Azure-Roadmap_Maker: mesma lógica de
// extrair o número da sprint (do Iteration Path ou do título) e de calcular
// datas de sprint por cadência fixa a partir de uma sprint de referência.

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SPRINT_NUMBER_RE = /Sprint\s*0*(\d+)/i;

/** Extrai o número da sprint de um texto qualquer (Iteration Path ou título). */
function extractSprintNumber(text) {
  if (!text) return null;
  const match = text.match(SPRINT_NUMBER_RE);
  return match ? parseInt(match[1], 10) : null;
}

/** Calcula o início/fim (Date) de uma sprint numerada, por cadência fixa. */
function computeSprintDates(sprintNumber, sprintCadence) {
  if (!sprintCadence || sprintNumber === null || sprintNumber === undefined) return null;
  const { referenceSprintNumber, referenceStart, referenceEnd, cadenceDays } = sprintCadence;
  const diffSprints = sprintNumber - referenceSprintNumber;
  const offsetMs = diffSprints * cadenceDays * MS_PER_DAY;
  return {
    start: new Date(new Date(referenceStart).getTime() + offsetMs),
    end: new Date(new Date(referenceEnd).getTime() + offsetMs),
  };
}

/**
 * Descobre qual é o número da sprint "atual" numa data de referência (hoje,
 * por padrão), usando a mesma cadência fixa configurada em sprintCadence.
 */
function currentSprintNumber(sprintCadence, today = new Date()) {
  if (!sprintCadence) return null;
  const { referenceSprintNumber, referenceStart, cadenceDays } = sprintCadence;
  const diffDays = (today.getTime() - new Date(referenceStart).getTime()) / MS_PER_DAY;
  const diffSprints = Math.floor(diffDays / cadenceDays);
  return referenceSprintNumber + diffSprints;
}

/** Extrai o número da sprint de um work item: tenta o Iteration Path, senão o título. */
function extractItemSprintNumber(iterationPath, title) {
  return extractSprintNumber(iterationPath) ?? extractSprintNumber(title);
}

module.exports = {
  extractSprintNumber,
  computeSprintDates,
  currentSprintNumber,
  extractItemSprintNumber,
};
