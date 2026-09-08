// sync.js
// REESCRITO em 28/08/2026 -- fluxo simplificado, seguindo a lista de regras
// definida do zero (ver mensagem original, resumida nos comentários abaixo).
//
// Entrypoint único: busca os Work Items no Azure DevOps, aplica as regras de
// status/proativo, e atualiza a planilha local (.xlsx no OneDrive).
//
// Uso:
//   node sync.js
//
// Requer a variável de ambiente AZURE_DEVOPS_PAT (ver .env.example) e o
// config.json preenchido (principalmente excel.filePath).

const path = require("path");
const config = require("./config.json");
const { fetchWorkItems } = require("./lib/azureClient");
const { normalizeWorkItem } = require("./lib/normalize");
const { resolveStatus, resolveClassificacao, podeAtualizarStatus } = require("./lib/statusMapping");
const { isProativo } = require("./lib/proativo");
const { isIgnoredCard } = require("./lib/cardFilters");
const {
  readHeaderMap,
  assertColumns,
  normalizeAzureId,
  findRowByAzureId,
  isRowEmpty,
  appendStyledRow,
  autoFitColumns,
  addStatusColorRuleForNewRows,
  computeStatusListFormula,
  applyStatusListValidation,
  openWorkbook,
  saveWorkbook,
} = require("./lib/excelSheet");

function log(msg) {
  console.log(`[sync] ${msg}`);
}

// excel.filePath no config.json pode ser um caminho ABSOLUTO (ex: o endereço
// oficial na pasta do OneDrive) ou um caminho RELATIVO — nesse caso, é
// resolvido a partir da pasta do próprio projeto (onde este arquivo está),
// não da pasta em que o terminal/`.bat` foi aberto. Isso permite testar com
// uma cópia local da planilha (ex: "./planilha-teste/arquivo.xlsx") antes de
// apontar pro endereço oficial definitivo, e continua funcionando não
// importa em qual pasta o projeto inteiro for colocado (Downloads, GitHub
// local, etc.) — sem precisar reescrever o config.json toda vez que o
// projeto mudar de lugar.
const excelFilePath = path.isAbsolute(config.excel.filePath)
  ? config.excel.filePath
  : path.join(__dirname, config.excel.filePath);

function parseCutoffDateFromConfig(config) {
  const raw = config.query && config.query.cutoffDate;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Data de corte DINÂMICA (regra 1, ajustada em 28/08/2026): a data mais
 * antiga já presente na coluna "Data da Inserção" (coluna B) da aba
 * LIVRE Oficial, mas só CONTANDO datas a partir de `query.cutoffMinYear`
 * (config.json, default 2026) — datas de 2025 (lixo antigo da planilha)
 * são ignoradas nesse cálculo, senão a data de corte volta lá pra trás e
 * enche a planilha de card antigo de novo. Recalculado a cada execução.
 * Se não sobrar nenhuma data válida (>= cutoffMinYear), cai no valor fixo
 * do config (fallback).
 */
function computeDynamicCutoffDate(worksheet, headerRow, dataInsercaoCol, config) {
  if (!dataInsercaoCol) return parseCutoffDateFromConfig(config);

  const minYear = (config.query && config.query.cutoffMinYear) || null;

  let earliest = null;
  for (let r = headerRow + 1; r <= worksheet.rowCount; r++) {
    if (isRowEmpty(worksheet, r)) continue;
    const raw = worksheet.getRow(r).getCell(dataInsercaoCol).value;
    if (!raw) continue;
    const d = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(d.getTime())) continue;
    if (minYear && d.getFullYear() < minYear) continue; // ignora "lixo" de anos anteriores
    if (!earliest || d < earliest) earliest = d;
  }

  return earliest || parseCutoffDateFromConfig(config);
}

/** true se o item pode ser usado pra CRIAR uma linha nova (respeita a data de corte quando ela existe e o item tem createdDate). */
function passesCutoff(item, cutoffDate) {
  if (!cutoffDate) return true;
  if (!item.createdDate) return true; // sem data conhecida, não bloqueia a criação
  return item.createdDate >= cutoffDate;
}

/**
 * Regras 2 e 3: para cada card retornado pelo Azure (já filtrado pela tag
 * "Livre" na própria WIQL, ver config.json -> query.extraWiqlWhere),
 * localiza a linha correspondente pelo "Nº Azure" e atualiza
 * Resumo Melhoria / Chamado / Classificação / Status, ou cria uma linha
 * nova (regra 4) se o card ainda não estiver na planilha.
 *
 * O Status só é sobrescrito se a célula já estava vazia OU já continha um
 * dos "managedStatuses" -- nunca em cima de um valor que a BO colocou
 * manualmente (podeAtualizarStatus, ver lib/statusMapping.js).
 */
async function syncLivreOficial(workbook, items) {
  const sheetName = config.excel.sheets.livre;
  const worksheet = workbook.getWorksheet(sheetName);
  if (!worksheet) throw new Error(`Aba "${sheetName}" não encontrada no arquivo.`);

  const headerRow = config.excel.headerRow;
  const cols = config.excel.livreColumns;
  const headerMap = readHeaderMap(worksheet, headerRow);
  assertColumns(
    headerMap,
    Object.values(cols).filter((v) => typeof v === "string" && v),
    sheetName
  );

  const cutoffDate = computeDynamicCutoffDate(
    worksheet,
    headerRow,
    cols.dataInsercao && headerMap[cols.dataInsercao],
    config
  );
  if (cutoffDate) {
    log(`Data de corte (mais antiga já na coluna "${cols.dataInsercao}"): ${cutoffDate.toISOString().slice(0, 10)}.`);
  }

  const colors = (config.statusMapping && config.statusMapping.colors) || {};
  const statusListFormula = computeStatusListFormula(workbook, config.excel.statusValidation);
  const novaLinhaCfg = config.excel.novaLinha || {};
  const newRowNumbers = [];
  // TODOS os itens entram aqui (inclusive os ignorados pelo cardFilters) --
  // é isso que faz a segunda passada (marcarLinhasSemMatch) NÃO marcar como
  // "fora do grupo Livre" uma linha cujo card só está sendo ignorado (tag
  // "Barramento", tipo diferente de "User Story" etc.), e sim deixá-la
  // exatamente como estava.
  const itemsById = new Map(items.map((item) => [String(item.id), item]));

  const stats = { atualizadas: 0, criadas: 0, statusIgnorado: 0, forCutoff: 0, ignoradosPeloFiltro: 0 };

  for (const item of items) {
    if (isIgnoredCard(item, config)) {
      stats.ignoradosPeloFiltro++;
      continue;
    }

    const { status } = resolveStatus(item, config);
    const classificacao = resolveClassificacao(item, config);
    const existingRow = findRowByAzureId(worksheet, headerMap[cols.azureId], headerRow, item.id);

    if (existingRow) {
      // Regra 3 (última frase): sempre olha o Status ATUAL primeiro. Só
      // sobrescreve se ele já for um valor controlado pelo programa (ou
      // estiver vazio) -- nunca em cima de algo que a BO colocou.
      const statusAtual = existingRow.getCell(headerMap[cols.status]).value;
      const podeEscrever = podeAtualizarStatus(statusAtual, config);

      existingRow.getCell(headerMap[cols.chamado]).value = item.chamado || "";
      existingRow.getCell(headerMap[cols.resumo]).value = item.title;

      if (status && podeEscrever) {
        // Só o VALOR. Cor de status em linha já existente é feita 100% via
        // formatação condicional nativa da planilha — nunca mexemos no
        // estilo de uma célula que já existia no arquivo (ver comentário
        // em addStatusColorRuleForNewRows).
        existingRow.getCell(headerMap[cols.status]).value = status;
        applyStatusListValidation(worksheet, headerMap[cols.status], existingRow.number, statusListFormula);
        stats.atualizadas++;
      } else {
        stats.statusIgnorado++;
      }

      if (cols.classificacao && headerMap[cols.classificacao] && classificacao) {
        existingRow.getCell(headerMap[cols.classificacao]).value = classificacao;
      }

      existingRow.commit();
    } else {
      if (!passesCutoff(item, cutoffDate)) {
        stats.forCutoff++;
        continue;
      }

      // Regra 4: linha nova -- Data da Inserção = data de criação do card,
      // Área = "Funil", e se tiver tag "Proativo", Solicitante = "Proativo".
      const values = {
        [headerMap[cols.azureId]]: item.id,
        [headerMap[cols.resumo]]: item.title,
        [headerMap[cols.chamado]]: item.chamado || "",
      };
      if (status) values[headerMap[cols.status]] = status;
      if (cols.classificacao && headerMap[cols.classificacao] && classificacao) {
        values[headerMap[cols.classificacao]] = classificacao;
      }
      if (cols.dataInsercao && headerMap[cols.dataInsercao] && item.createdDate) {
        values[headerMap[cols.dataInsercao]] = item.createdDate;
      }
      if (cols.area && headerMap[cols.area] && novaLinhaCfg.area) {
        values[headerMap[cols.area]] = novaLinhaCfg.area;
      }
      if (cols.solicitante && headerMap[cols.solicitante] && isProativo(item, config)) {
        values[headerMap[cols.solicitante]] = "Proativo";
      }

      const newRow = appendStyledRow(worksheet, headerRow, values);

      if (cols.dataInsercao && headerMap[cols.dataInsercao] && item.createdDate && novaLinhaCfg.dataInsercaoFormat) {
        newRow.getCell(headerMap[cols.dataInsercao]).numFmt = novaLinhaCfg.dataInsercaoFormat;
      }
      if (status) {
        applyStatusListValidation(worksheet, headerMap[cols.status], newRow.number, statusListFormula);
      }

      newRowNumbers.push(newRow.number);
      stats.criadas++;
    }
  }

  // Cor das linhas novas: uma regra de formatação condicional só pra elas,
  // nunca mexendo em estilo de célula já existente (ver comentário na função).
  addStatusColorRuleForNewRows(worksheet, headerMap[cols.status], newRowNumbers, colors);

  log(
    `LIVRE Oficial: ${stats.atualizadas} linha(s) atualizada(s), ${stats.criadas} criada(s), ` +
      `${stats.statusIgnorado} com Status preservado (valor manual da BO, não sobrescrito), ` +
      `${stats.forCutoff} ignorada(s) por serem anteriores à data de corte, ` +
      `${stats.ignoradosPeloFiltro} ignorado(s) pelo filtro de card (tag/título "Barramento" ou tipo diferente de "${
        (config.cardFilters && config.cardFilters.onlyWorkItemType) || "User Story"
      }").`
  );

  return { worksheet, headerRow, headerMap, cols, cutoffDate, itemsById, statusListFormula };
}

/**
 * Segunda passada sobre TODAS as linhas já existentes na LIVRE Oficial que
 * NÃO foram tocadas no laço acima (ou seja, não bateram com nenhum card
 * retornado pelo Azure nesta execução):
 *   - "Nº Azure" em branco                              -> statusSemAzurePreenchido
 *   - "Nº Azure" preenchido mas fora do grupo "Livre"
 *     retornado pelo Azure (perdeu a tag ou não existe
 *     mais)                                              -> statusForaDoGrupoLivre
 * Sempre respeitando podeAtualizarStatus (nunca sobrescreve um status
 * manual da BO).
 */
function marcarLinhasSemMatch(worksheet, headerRow, headerMap, cols, itemsById, statusListFormula) {
  const mapping = config.statusMapping || {};
  const semAzure = mapping.statusSemAzurePreenchido;
  const foraDoGrupo = mapping.statusForaDoGrupoLivre;
  if (!semAzure && !foraDoGrupo) return;

  const azureIdCol = headerMap[cols.azureId];
  const statusCol = headerMap[cols.status];

  let marcadasSemAzure = 0;
  let marcadasForaDoGrupo = 0;
  let preservadas = 0;

  for (let r = headerRow + 1; r <= worksheet.rowCount; r++) {
    if (isRowEmpty(worksheet, r)) continue;
    const row = worksheet.getRow(r);

    const raw = row.getCell(azureIdCol).value;
    const normalized = normalizeAzureId(raw);

    let novoStatus = null;
    if (!normalized) {
      novoStatus = semAzure;
    } else if (!itemsById.has(normalized)) {
      novoStatus = foraDoGrupo;
    } else {
      continue; // achou o card na busca do Azure -- já foi tratado no laço principal
    }
    if (!novoStatus) continue;

    const statusCell = row.getCell(statusCol);
    if (!podeAtualizarStatus(statusCell.value, config)) {
      preservadas++;
      continue;
    }
    if (statusCell.value !== novoStatus) {
      statusCell.value = novoStatus;
      applyStatusListValidation(worksheet, statusCol, r, statusListFormula);
      row.commit();
    }
    if (!normalized) marcadasSemAzure++;
    else marcadasForaDoGrupo++;
  }

  log(
    `LIVRE Oficial: ${marcadasSemAzure} linha(s) marcada(s) como "${semAzure}" (Nº Azure em branco), ` +
      `${marcadasForaDoGrupo} marcada(s) como "${foraDoGrupo}" (fora do grupo "Livre" no Azure), ` +
      `${preservadas} preservada(s) por já terem um Status manual da BO.`
  );
}

async function syncProativos(workbook, items, cutoffDate) {
  const sheetName = config.excel.sheets.proativos;
  const worksheet = workbook.getWorksheet(sheetName);
  if (!worksheet) throw new Error(`Aba "${sheetName}" não encontrada no arquivo.`);

  const headerRow = config.excel.headerRow;
  const cols = config.excel.proativosColumns;
  const headerMap = readHeaderMap(worksheet, headerRow);
  assertColumns(headerMap, Object.values(cols), sheetName);

  const proativos = items.filter((item) => isProativo(item, config) && !isIgnoredCard(item, config));
  const fallbackStyle = config.excel.proativosNewRowStyle;

  const stats = { atualizadas: 0, criadas: 0, semMudanca: 0, forCutoff: 0 };

  for (const item of proativos) {
    const existingRow = findRowByAzureId(worksheet, headerMap[cols.azureId], headerRow, item.id);

    if (existingRow) {
      const tituloAtual = (existingRow.getCell(headerMap[cols.resumo]).value || "").toString().trim();
      if (tituloAtual !== item.title) {
        existingRow.getCell(headerMap[cols.resumo]).value = item.title;
        existingRow.commit();
        stats.atualizadas++;
      } else {
        stats.semMudanca++;
      }
    } else {
      if (!passesCutoff(item, cutoffDate)) {
        stats.forCutoff++;
        continue;
      }

      const values = {
        [headerMap[cols.azureId]]: item.id,
        [headerMap[cols.resumo]]: item.title,
        [headerMap[cols.solicitante]]: "Proativo",
      };
      appendStyledRow(worksheet, headerRow, values, { fallbackStyle });
      stats.criadas++;
    }
  }

  if (fallbackStyle && fallbackStyle.autoWidthColumns) {
    autoFitColumns(worksheet, headerRow, fallbackStyle.autoWidthColumns);
  }

  log(
    `Pró ativos: ${proativos.length} card(s) proativo(s) no Azure — ${stats.criadas} linha(s) criada(s), ` +
      `${stats.atualizadas} título(s) atualizado(s), ${stats.semMudanca} sem mudança, ` +
      `${stats.forCutoff} ignorada(s) por serem anteriores à data de corte.`
  );
}

async function main() {
  if (config.excel.filePath.includes("NOME_DO_ARQUIVO")) {
    throw new Error(
      "Preencha o caminho completo do arquivo em config.json -> excel.filePath (falta o nome do arquivo .xlsx)."
    );
  }

  log("Buscando work items no Azure DevOps...");
  const rawItems = await fetchWorkItems(config);
  const items = rawItems.map((raw) => normalizeWorkItem(raw, config.fields));
  log(`${items.length} work item(s) encontrado(s) com a tag "Livre".`);

  log(`Abrindo planilha: ${excelFilePath}`);
  const writableSheetNames = [config.excel.sheets.livre, config.excel.sheets.proativos];
  const workbook = await openWorkbook(excelFilePath, config.excel.makeBackup, writableSheetNames);

  const { worksheet, headerRow, headerMap, cols, itemsById, statusListFormula } = await syncLivreOficial(
    workbook,
    items
  );
  marcarLinhasSemMatch(worksheet, headerRow, headerMap, cols, itemsById, statusListFormula);

  const cutoffDate = computeDynamicCutoffDate(worksheet, headerRow, cols.dataInsercao && headerMap[cols.dataInsercao], config);
  await syncProativos(workbook, items, cutoffDate);

  await saveWorkbook(workbook, excelFilePath);
  log("Planilha salva com sucesso.");
}

main().catch((err) => {
  console.error(`[sync] ERRO: ${err.message}`);
  process.exitCode = 1;
});
