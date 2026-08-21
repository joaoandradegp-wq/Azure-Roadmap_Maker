// sync.js
// Entrypoint único: busca os Work Items no Azure DevOps, aplica as regras de
// status/proativo, e atualiza a planilha local (.xlsx no OneDrive).
//
// Uso:
//   node sync.js
//
// Requer a variável de ambiente AZURE_DEVOPS_PAT (ver .env.example) e o
// config.json preenchido (principalmente excel.filePath).

const config = require("./config.json");
const { fetchWorkItems, checkIdsExist, azureAuthBase } = require("./lib/azureClient");
const { normalizeWorkItem } = require("./lib/normalize");
const { resolveStatus } = require("./lib/statusMapping");
const { isProativo } = require("./lib/proativo");
const {
  readHeaderMap,
  assertColumns,
  normalizeAzureId,
  findRowByAzureId,
  isRowEmpty,
  appendStyledRow,
  autoFitColumns,
  addStatusColorRuleForNewRows,
  openWorkbook,
  saveWorkbook,
} = require("./lib/excelSheet");

function log(msg) {
  console.log(`[sync] ${msg}`);
}

function parseCutoffDate(config) {
  const raw = config.query && config.query.cutoffDate;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** true se o item pode ser usado pra CRIAR uma linha nova (respeita a data de corte quando ela existe e o item tem createdDate). */
function passesCutoff(item, cutoffDate) {
  if (!cutoffDate) return true;
  if (!item.createdDate) return true; // sem data conhecida, não bloqueia a criação
  return item.createdDate >= cutoffDate;
}

async function syncLivreOficial(workbook, items, cutoffDate) {
  const sheetName = config.excel.sheets.livre;
  const worksheet = workbook.getWorksheet(sheetName);
  if (!worksheet) throw new Error(`Aba "${sheetName}" não encontrada no arquivo.`);

  const headerRow = config.excel.headerRow;
  const cols = config.excel.livreColumns;
  const headerMap = readHeaderMap(worksheet, headerRow);
  assertColumns(headerMap, Object.values(cols).filter(Boolean), sheetName);

  const colors = (config.statusMapping && config.statusMapping.colors) || {};
  const newRowNumbers = [];

  const stats = { atualizadas: 0, criadas: 0, statusIgnorado: 0, forCutoff: 0 };

  for (const item of items) {
    const { status, isHml } = resolveStatus(item, config);
    const existingRow = findRowByAzureId(worksheet, headerMap[cols.azureId], headerRow, item.id);

    if (existingRow) {
      existingRow.getCell(headerMap[cols.chamado]).value = item.chamado || "";
      existingRow.getCell(headerMap[cols.resumo]).value = item.title;

      if (cols.dataInsercao && headerMap[cols.dataInsercao]) {
        const dataCell = existingRow.getCell(headerMap[cols.dataInsercao]);
        if ((dataCell.value === null || dataCell.value === undefined || dataCell.value === "") && item.createdDate) {
          dataCell.value = item.createdDate;
        }
      }

      if (status) {
        // Só o VALOR. Cor de status em linha já existente é feita 100% via
        // formatação condicional nativa da planilha — nunca mexemos no
        // estilo de uma célula que já existia no arquivo (ver comentário
        // em addStatusColorRuleForNewRows).
        existingRow.getCell(headerMap[cols.status]).value = status;
      } else {
        stats.statusIgnorado++;
      }

      if (isHml && cols.obs) {
        const obsCell = existingRow.getCell(headerMap[cols.obs]);
        const atual = (obsCell.value || "").toString();
        if (!atual.includes("HML")) {
          obsCell.value = atual ? `${atual} | HML` : "HML";
        }
      }
      existingRow.commit();
      stats.atualizadas++;
    } else {
      if (!passesCutoff(item, cutoffDate)) {
        stats.forCutoff++;
        continue;
      }

      const values = {
        [headerMap[cols.azureId]]: item.id,
        [headerMap[cols.resumo]]: item.title,
        [headerMap[cols.chamado]]: item.chamado || "",
      };
      if (status) values[headerMap[cols.status]] = status;
      if (isHml && cols.obs) values[headerMap[cols.obs]] = "HML";
      if (cols.dataInsercao && headerMap[cols.dataInsercao] && item.createdDate) {
        values[headerMap[cols.dataInsercao]] = item.createdDate;
      }
      const newRow = appendStyledRow(worksheet, headerRow, values);
      newRowNumbers.push(newRow.number);
      stats.criadas++;
    }
  }

  // Cor das linhas novas: uma regra de formatação condicional só pra elas,
  // nunca mexendo em estilo de célula já existente (ver comentário na função).
  addStatusColorRuleForNewRows(worksheet, headerMap[cols.status], newRowNumbers, colors);

  log(
    `LIVRE Oficial: ${stats.atualizadas} linha(s) atualizada(s), ${stats.criadas} criada(s), ` +
      `${stats.statusIgnorado} sem regra de status batendo (Status não sobrescrito), ` +
      `${stats.forCutoff} ignorada(s) por serem anteriores à data de corte.`
  );

  return { worksheet, headerRow, headerMap, cols };
}

/**
 * Segunda passada sobre TODAS as linhas já existentes na LIVRE Oficial:
 * se o "Nº Azure" estiver em branco, ou for um número que não existe mais
 * no Azure, o Status vira config.statusMapping.semAzureValido.
 */
async function marcarSemAzureValido(workbook, worksheet, headerRow, headerMap, cols) {
  const semAzureValido = config.statusMapping && config.statusMapping.semAzureValido;
  if (!semAzureValido) return;

  const azureIdCol = headerMap[cols.azureId];
  const statusCol = headerMap[cols.status];

  const idsNaPlanilha = [];
  for (let r = headerRow + 1; r <= worksheet.rowCount; r++) {
    if (isRowEmpty(worksheet, r)) continue;
    const raw = worksheet.getRow(r).getCell(azureIdCol).value;
    const normalized = normalizeAzureId(raw);
    if (normalized) idsNaPlanilha.push(normalized);
  }

  const base = azureAuthBase(config);
  const existentesNoAzure = await checkIdsExist({ ...base, ids: idsNaPlanilha });

  let marcadas = 0;
  for (let r = headerRow + 1; r <= worksheet.rowCount; r++) {
    if (isRowEmpty(worksheet, r)) continue;
    const row = worksheet.getRow(r);
    const raw = row.getCell(azureIdCol).value;
    const normalized = normalizeAzureId(raw);
    const invalido = !normalized || !existentesNoAzure.has(normalized);

    if (invalido) {
      // Só o VALOR — esta função nunca mexe em estilo/cor de célula já
      // existente (esse status também não tem regra de cor na planilha
      // original, então isso já reproduz o comportamento de antes).
      const statusCell = row.getCell(statusCol);
      if (statusCell.value !== semAzureValido) {
        statusCell.value = semAzureValido;
        row.commit();
        marcadas++;
      }
    }
  }

  log(`LIVRE Oficial: ${marcadas} linha(s) marcada(s) como "${semAzureValido}" (Nº Azure em branco ou inexistente).`);
}

async function syncProativos(workbook, items, cutoffDate) {
  const sheetName = config.excel.sheets.proativos;
  const worksheet = workbook.getWorksheet(sheetName);
  if (!worksheet) throw new Error(`Aba "${sheetName}" não encontrada no arquivo.`);

  const headerRow = config.excel.headerRow;
  const cols = config.excel.proativosColumns;
  const headerMap = readHeaderMap(worksheet, headerRow);
  assertColumns(headerMap, Object.values(cols), sheetName);

  const proativos = items.filter((item) => isProativo(item, config));
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

  const cutoffDate = parseCutoffDate(config);
  if (cutoffDate) {
    log(`Data de corte ativa: só cria linha nova para cards criados a partir de ${cutoffDate.toISOString().slice(0, 10)}.`);
  }

  log("Buscando work items no Azure DevOps...");
  const rawItems = await fetchWorkItems(config);
  const items = rawItems.map((raw) => normalizeWorkItem(raw, config.fields));
  log(`${items.length} work item(s) encontrado(s) com a tag "Livre".`);

  log(`Abrindo planilha: ${config.excel.filePath}`);
  const workbook = await openWorkbook(config.excel.filePath, config.excel.makeBackup);

  const { worksheet, headerRow, headerMap, cols } = await syncLivreOficial(workbook, items, cutoffDate);
  await marcarSemAzureValido(workbook, worksheet, headerRow, headerMap, cols);
  await syncProativos(workbook, items, cutoffDate);

  await saveWorkbook(workbook, config.excel.filePath);
  log("Planilha salva com sucesso.");
}

main().catch((err) => {
  console.error(`[sync] ERRO: ${err.message}`);
  process.exitCode = 1;
});
