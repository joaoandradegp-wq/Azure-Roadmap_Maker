// lib/cardFilters.js
// CRIADO em 28/08/2026 -- cards que batem aqui são ignorados por completo:
// não criam linha nova, não atualizam nenhum campo de uma linha já
// existente, e não são marcados como "Backlog" pela regra de "fora do
// grupo Livre" (ver sync.js -> marcarLinhasSemMatch). Se já existir uma
// linha na planilha pra esse card, ela fica exatamente como estava.

const { hasTag } = require("./normalize");

function isIgnoredCard(item, config) {
  const cfg = config.cardFilters || {};

  if (cfg.ignoreTag && hasTag(item, cfg.ignoreTag)) return true;

  if (cfg.ignoreTitleContains) {
    const needle = cfg.ignoreTitleContains.toLowerCase();
    if ((item.title || "").toLowerCase().includes(needle)) return true;
  }

  if (cfg.onlyWorkItemType && item.type !== cfg.onlyWorkItemType) return true;

  return false;
}

module.exports = { isIgnoredCard };
