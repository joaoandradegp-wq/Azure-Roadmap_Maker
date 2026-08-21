// lib/statusMapping.js
// DE/PARA: campos do card no Azure -> valor da coluna "Status" na planilha
// "LIVRE Oficial". Ordem de prioridade (combinada em conversa):
//
//   1) State do Azure   (byState)   -> Removed = Cancelado, Resolved/Closed = Entregue
//   2) Tag do Azure      (byTag)     -> Pausado = Paralisado, Bloqueado/Blocked = Bloqueado
//   3) Coluna do board   (byBoardColumn), MAS só se o card estiver na sprint
//      atual (comparando o número da sprint do card com a sprint atual,
//      calculada por sprintCadence):
//        - "Pronto para GMUD"                  -> Pronto GMUD  (não depende da sprint)
//        - "Pronto para Desenvolvimento/Spike"  -> Na Sprint Atual
//        - "Em Desenvolvimento"                 -> Em Desenvolvimento
//        - "Em correção (Ambiente QA)"          -> QA
//        - "Em correção (HML)"                  -> QA (+ marca "HML" na coluna OBS)
//
// Se nada bater, devolve status: null -> quem chama NÃO deve sobrescrever o
// que já está na planilha (pode ser um status gerenciado manualmente, tipo
// "Backlog", "Priorizado", "Aguardando Refinamento de Negócio" etc).
//
// "Removido" nunca é escrito pelo app — é só de uso manual, por decisão do
// usuário.

const { hasTag } = require("./normalize");
const { currentSprintNumber } = require("./sprintUtils");

function resolveStatus(item, config, today = new Date()) {
  const mapping = config.statusMapping;
  const hmlColumns = new Set(mapping.hmlBoardColumns || []);

  // 1) State
  if (mapping.byState[item.state]) {
    return { status: mapping.byState[item.state], isHml: false };
  }

  // 2) Tag (primeira tag da lista que bater, na ordem declarada no config)
  for (const [tag, status] of Object.entries(mapping.byTag)) {
    if (hasTag(item, tag)) {
      return { status, isHml: false };
    }
  }

  // 3) Coluna do board, ligado a "Pronto para GMUD" (não depende de sprint)
  if (item.boardColumn === "Pronto para GMUD" && mapping.byBoardColumn["Pronto para GMUD"]) {
    return { status: mapping.byBoardColumn["Pronto para GMUD"], isHml: false };
  }

  // 3b) Demais colunas do board -> só valem se o card estiver na sprint atual
  const sprintAtual = currentSprintNumber(config.sprintCadence, today);
  const estaNaSprintAtual =
    sprintAtual !== null && item.sprintNumber !== null && item.sprintNumber === sprintAtual;

  if (estaNaSprintAtual && mapping.byBoardColumn[item.boardColumn]) {
    return {
      status: mapping.byBoardColumn[item.boardColumn],
      isHml: hmlColumns.has(item.boardColumn),
    };
  }

  // Nada bateu: não mexe no status que já está na planilha
  return { status: null, isHml: false };
}

module.exports = { resolveStatus };
