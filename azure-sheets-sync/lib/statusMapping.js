// lib/statusMapping.js
// REESCRITO em 28/08/2026 -- regra nova, simples, direto do que foi definido:
//
//   1) Tag "Bloqueado"/"Pausado"/"RASCUNHO" (byTag)         -> vence tudo
//   2) State "New"/"Refinement"/"Refined"                   -> "Backlog"
//   3) Iteration Path = raiz do projeto (sem sprint ainda)  -> "Backlog"
//   4) Coluna do board "Closed/Em PRD"                      -> "Entregue"
//   5) Coluna do board "Pronto para GMUD" /
//      "Adicionar na GMUD do dia"                           -> "Pronto GMUD"
//   6) Tag "Análise Técnica" OU coluna "Em investigação
//      (Spike)"                                             -> "Em Análise Técnica TI"
//   7) Catch-all: qualquer outra coisa                      -> "Na sprint Atual"
//
// Isso só é aplicado a cards que a busca no Azure já retornou (tag "Livre")
// E que passaram pelo filtro de lib/cardFilters.js (tipo "User Story", sem
// tag/título "Barramento") -- cards ignorados nem chegam aqui, ver sync.js.
// Cards sem "Nº Azure" na planilha ou fora do grupo "Livre" têm status
// próprio (ver statusSemAzurePreenchido / statusForaDoGrupoLivre em
// config.json), resolvidos em sync.js, não aqui.
//
// Em NENHUM caso este módulo decide se pode ou não escrever na planilha --
// isso é responsabilidade de quem chama (ver podeAtualizarStatus abaixo),
// que só sobrescreve a célula se o valor atual já for um dos
// "managedStatuses" (ou estiver vazia). Assim nunca se perde um status que
// a BO colocou manualmente (ex: "Priorizado Proxima Sprint").

const { hasTag } = require("./normalize");

function resolveStatus(item, config) {
  const mapping = config.statusMapping;

  // 1) Tag de bloqueio/pausa/rascunho -- vence tudo, não importa a coluna do board
  for (const [tag, status] of Object.entries(mapping.byTag || {})) {
    if (hasTag(item, tag)) {
      return { status };
    }
  }

  // 2) State ainda não refinado (o campo State vinha sendo lido errado antes) -> Backlog
  const statesBacklog = new Set(mapping.statesBacklog || []);
  if (item.state && statesBacklog.has(item.state)) {
    return { status: mapping.statusForaDoGrupoLivre || "Backlog" };
  }

  // 3) Iteration Path ainda na raiz do projeto (sem sprint atribuída) -> Backlog
  const areaPathRaiz = config.query && config.query.areaPath;
  if (mapping.iterationRootIsBacklog && areaPathRaiz && item.iterationPath === areaPathRaiz) {
    return { status: mapping.statusForaDoGrupoLivre || "Backlog" };
  }

  // 4) Coluna do board "Closed/Em PRD" -> Entregue
  const entregueCols = new Set(mapping.boardColumnEntregue || []);
  if (entregueCols.has(item.boardColumn)) {
    return { status: mapping.statusEntregue || "Entregue" };
  }

  // 5) Coluna do board "Pronto para GMUD" / "Adicionar na GMUD do dia" -> Pronto GMUD
  const gmudCols = new Set(mapping.boardColumnGmud || []);
  if (gmudCols.has(item.boardColumn)) {
    return { status: mapping.statusProntoGmud || "Pronto GMUD" };
  }

  // 6) Tag "Análise Técnica" OU coluna "Em investigação (Spike)" -> Em Análise Técnica TI
  const analiseCols = new Set(mapping.boardColumnAnaliseTecnica || []);
  const temTagAnaliseTecnica = mapping.tagAnaliseTecnica && hasTag(item, mapping.tagAnaliseTecnica);
  if (temTagAnaliseTecnica || analiseCols.has(item.boardColumn)) {
    return { status: mapping.statusAnaliseTecnica || "Em Análise Técnica TI" };
  }

  // 7) Catch-all: tudo o mais fica "Na sprint Atual"
  return { status: mapping.statusNaSprintAtual || "Na sprint Atual" };
}

/**
 * Classificação (coluna "Classificação"): olha só pra tag "Melhoria" ou
 * "Bug" -- são mutuamente exclusivas, todo card tem exatamente uma das duas.
 * Se por algum motivo nenhuma bater (não deveria acontecer), devolve null e
 * quem chama não sobrescreve o que já está na planilha.
 */
function resolveClassificacao(item, config) {
  const mapping = (config.statusMapping && config.statusMapping.classificacaoByTag) || {
    Bug: "Bug",
    Melhoria: "Melhoria",
  };
  for (const [tag, valor] of Object.entries(mapping)) {
    if (hasTag(item, tag)) return valor;
  }
  return null;
}

/**
 * Diz se o programa pode ESCREVER `novoStatus` em cima do que já está na
 * célula (`statusAtual`): sim se a célula estiver vazia, ou se o valor
 * atual já for um dos status que o próprio programa controla
 * (config.statusMapping.managedStatuses). Se for qualquer outro valor
 * (a BO colocou manualmente pra revisar depois, ex: "Priorizado Proxima
 * Sprint"), o programa NUNCA sobrescreve.
 */
function podeAtualizarStatus(statusAtual, config) {
  const managed = new Set((config.statusMapping && config.statusMapping.managedStatuses) || []);
  const atual = statusAtual === null || statusAtual === undefined ? "" : String(statusAtual).trim();
  if (atual === "") return true;
  return managed.has(atual);
}

module.exports = { resolveStatus, resolveClassificacao, podeAtualizarStatus };
