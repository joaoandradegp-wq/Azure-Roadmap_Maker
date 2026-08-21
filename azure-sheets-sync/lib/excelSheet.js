// lib/excelSheet.js
// Abre o .xlsx local (sincronizado via OneDrive), localiza linhas pela
// coluna "Nº Azure", atualiza campos específicos e cria linhas novas quando
// necessário — SEM NUNCA apagar linhas ou colunas já existentes.
//
// Usa exceljs porque ele preserva formatação/estilos do arquivo original
// (cores, larguras de coluna, fórmulas de outras abas) ao salvar de volta.

const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");

/** Lê a linha de cabeçalho e devolve um mapa { "Nome da Coluna": número da coluna }. */
function readHeaderMap(worksheet, headerRow) {
  const map = {};
  const row = worksheet.getRow(headerRow);
  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const name = (cell.value ?? "").toString().trim();
    if (name) map[name] = colNumber;
  });
  return map;
}

/** Confere se todas as colunas esperadas existem na aba; lança erro claro se faltar alguma. */
function assertColumns(headerMap, expectedNames, sheetName) {
  const faltando = expectedNames.filter((name) => !headerMap[name]);
  if (faltando.length > 0) {
    throw new Error(
      `Na aba "${sheetName}" não encontrei a(s) coluna(s): ${faltando.join(", ")}. ` +
        `Confira se o nome no config.json bate exatamente com o cabeçalho da planilha (maiúsculas/acentos incluídos).`
    );
  }
}

/** Normaliza um valor de "Nº Azure" pra comparação (string, sem espaços, sem .0 de float). */
function normalizeAzureId(value) {
  if (value === null || value === undefined || value === "") return null;
  const asNumber = Number(value);
  if (!Number.isNaN(asNumber)) return String(Math.trunc(asNumber));
  return String(value).trim();
}

/** Procura a linha (a partir de headerRow+1) cuja coluna azureIdCol bate com o id procurado. */
function findRowByAzureId(worksheet, azureIdCol, headerRow, azureId) {
  const target = normalizeAzureId(azureId);
  if (target === null) return null;

  for (let r = headerRow + 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const cellValue = row.getCell(azureIdCol).value;
    if (normalizeAzureId(cellValue) === target) {
      return row;
    }
  }
  return null;
}

/** Confere se uma linha está totalmente vazia (sem nenhum valor em nenhuma coluna usada). */
function isRowEmpty(worksheet, rowNumber) {
  const row = worksheet.getRow(rowNumber);
  for (let c = 1; c <= worksheet.columnCount; c++) {
    const v = row.getCell(c).value;
    if (v !== null && v !== undefined && v !== "") return false;
  }
  return true;
}

/** Acha a última linha com dado real na planilha (pra copiar estilo). Devolve null se não existir nenhuma. */
function lastDataRow(worksheet, headerRow) {
  let last = null;
  for (let r = headerRow + 1; r <= worksheet.rowCount; r++) {
    if (!isRowEmpty(worksheet, r)) last = r;
  }
  return last;
}

/**
 * Acha a primeira linha livre pra inserir um registro novo: a primeira linha
 * vazia logo após o cabeçalho, ou o fim da planilha se não houver nenhuma
 * (nunca pula uma linha em branco só porque `worksheet.rowCount` já "conta"
 * ela por ter formatação).
 */
function firstFreeRow(worksheet, headerRow) {
  for (let r = headerRow + 1; r <= worksheet.rowCount + 1; r++) {
    if (isRowEmpty(worksheet, r)) return r;
  }
  return worksheet.rowCount + 1;
}

/**
 * Cria uma linha nova. Por padrão copia o estilo da última linha de dados
 * real (`lastDataRow`) — mas NUNCA copia o estilo do cabeçalho: se não existir
 * nenhuma linha de dados ainda, cai num estilo simples (`fallbackStyle`, se
 * passado) em vez de herdar a formatação do título da tabela.
 * `values` é um mapa { colNumber: valor }.
 */
function appendStyledRow(worksheet, headerRow, values, options = {}) {
  const newRowNumber = firstFreeRow(worksheet, headerRow);
  const newRow = worksheet.getRow(newRowNumber);

  const templateRowNumber = lastDataRow(worksheet, headerRow);
  if (templateRowNumber) {
    const templateRow = worksheet.getRow(templateRowNumber);
    templateRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      newRow.getCell(colNumber).style = { ...cell.style };
    });
  } else if (options.fallbackStyle) {
    applyFallbackStyle(worksheet, headerRow, newRow, options.fallbackStyle);
  }

  for (const [colNumber, value] of Object.entries(values)) {
    newRow.getCell(Number(colNumber)).value = value;
  }
  newRow.commit();
  return newRow;
}

/**
 * Aplica um estilo simples e explícito numa linha nova quando não há
 * nenhuma linha de dados real pra copiar (ex: aba "Pró ativos" só com
 * cabeçalho preenchido). Borda fina preta em toda célula usada, fonte
 * normal (não a do cabeçalho), e alinhamento à esquerda nas colunas
 * indicadas por nome.
 */
function applyFallbackStyle(worksheet, headerRow, row, fallbackStyle) {
  const headerMap = readHeaderMap(worksheet, headerRow);
  const leftAlignCols = new Set(
    (fallbackStyle.leftAlignColumns || []).map((name) => headerMap[name]).filter(Boolean)
  );
  const thinBorder = {
    top: { style: "thin", color: { argb: "FF000000" } },
    left: { style: "thin", color: { argb: "FF000000" } },
    bottom: { style: "thin", color: { argb: "FF000000" } },
    right: { style: "thin", color: { argb: "FF000000" } },
  };

  for (let c = 1; c <= worksheet.columnCount; c++) {
    const cell = row.getCell(c);
    cell.font = { name: fallbackStyle.fontName || "Calibri", size: fallbackStyle.fontSize || 11 };
    cell.border = thinBorder;
    cell.alignment = leftAlignCols.has(c) ? { horizontal: "left" } : {};
  }
}

/**
 * Redimensiona a largura das colunas indicadas por nome (via header) pro
 * maior conteúdo já presente na coluna, com um mínimo/máximo razoável —
 * já que exceljs não tem "autofit" nativo como o Excel.
 */
function autoFitColumns(worksheet, headerRow, columnNames, { min = 10, max = 150, padding = 2 } = {}) {
  const headerMap = readHeaderMap(worksheet, headerRow);
  for (const name of columnNames) {
    const colNumber = headerMap[name];
    if (!colNumber) continue;

    let longest = name.length;
    for (let r = headerRow + 1; r <= worksheet.rowCount; r++) {
      const v = worksheet.getRow(r).getCell(colNumber).value;
      if (v === null || v === undefined) continue;
      const text = typeof v === "object" && v.richText ? v.richText.map((t) => t.text).join("") : String(v);
      if (text.length > longest) longest = text.length;
    }

    worksheet.getColumn(colNumber).width = Math.min(max, Math.max(min, longest + padding));
  }
}

/**
 * Compacta uma lista de números de linha em intervalos contíguos, tipo
 * [2,3,4,7,8,10] -> "2:4,7:8,10". Só pra deixar o `ref` da formatação
 * condicional mais enxuto quando as linhas novas forem sequenciais.
 */
function compressRowRanges(rowNumbers) {
  const sorted = [...new Set(rowNumbers)].sort((a, b) => a - b);
  const ranges = [];
  let start = null;
  let prev = null;
  for (const r of sorted) {
    if (start === null) {
      start = r;
    } else if (r !== prev + 1) {
      ranges.push([start, prev]);
      start = r;
    }
    prev = r;
  }
  if (start !== null) ranges.push([start, prev]);
  return ranges;
}

/**
 * Colore o Status das linhas NOVAS criadas nesta execução — SEM tocar em
 * nenhuma célula/estilo já existente na planilha.
 *
 * IMPORTANTE: nunca usar `cell.fill =` / `cell.font =` direto em células que
 * já existiam no arquivo carregado. Em planilhas grandes e antigas como esta,
 * várias células compartilham o mesmo registro de estilo internamente no
 * exceljs; mexer no estilo de uma pode silenciosamente vazar pra outras que
 * usavam o mesmo estilo, corrompendo a formatação (e em alguns casos até a
 * tabela de estilos do arquivo, fazendo o Excel "reparar" o arquivo e
 * descartar linhas). Por isso, pra colorir linha nova, a gente NUNCA mexe em
 * estilo de célula — só adiciona uma regra de formatação condicional nova
 * (igual a que já existe manualmente pra Entregue/Cancelado), restrita só ao
 * intervalo das linhas criadas agora. Isso é seguro porque não toca em nada
 * que já existia no arquivo.
 */
function addStatusColorRuleForNewRows(worksheet, statusColNumber, newRowNumbers, colorMap) {
  if (!newRowNumbers || newRowNumbers.length === 0) return;
  const colLetter = worksheet.getColumn(statusColNumber).letter;
  const ranges = compressRowRanges(newRowNumbers);
  const ref = ranges.map(([a, b]) => (a === b ? `${colLetter}${a}` : `${colLetter}${a}:${colLetter}${b}`)).join(" ");

  const rules = Object.entries(colorMap).map(([status, colors]) => ({
    type: "cellIs",
    operator: "equal",
    formulae: [`"${status}"`],
    style: {
      fill: { type: "pattern", pattern: "solid", bgColor: { argb: colors.fill } },
      font: { color: { argb: colors.font } },
    },
  }));
  if (rules.length === 0) return;

  worksheet.addConditionalFormatting({ ref, rules });
}

/** Abre o workbook e faz uma cópia de segurança (.bak) do arquivo antes de qualquer alteração. */
async function openWorkbook(filePath, makeBackup) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo não encontrado: ${filePath}. Confira o caminho em config.json -> excel.filePath.`);
  }

  if (makeBackup) {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath, path.extname(filePath));
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(dir, `${base}.backup-${stamp}${path.extname(filePath)}`);
    fs.copyFileSync(filePath, backupPath);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return workbook;
}

/** Salva o workbook de volta no mesmo caminho. Dá erro claro se o arquivo estiver aberto/travado. */
async function saveWorkbook(workbook, filePath) {
  try {
    await workbook.xlsx.writeFile(filePath);
  } catch (err) {
    if (err && (err.code === "EBUSY" || err.code === "EPERM")) {
      throw new Error(
        `Não consegui salvar "${filePath}" — parece que o arquivo está aberto no Excel. Feche a planilha e rode o sync de novo.`
      );
    }
    throw err;
  }
}

module.exports = {
  readHeaderMap,
  assertColumns,
  normalizeAzureId,
  findRowByAzureId,
  isRowEmpty,
  lastDataRow,
  firstFreeRow,
  appendStyledRow,
  applyFallbackStyle,
  autoFitColumns,
  addStatusColorRuleForNewRows,
  openWorkbook,
  saveWorkbook,
};
