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
const { buildFinalXlsxBuffer, validateZipXmlPartsWellFormed } = require("./xlsxSurgery");

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

/**
 * Calcula a fórmula de validação em lista (Listbox) pra coluna "Status",
 * a partir da aba "Status" da própria planilha: pega a última linha
 * preenchida da coluna indicada, então a lista sempre acompanha se alguém
 * adicionar um novo status na aba "Status" no futuro.
 * Devolve algo como `Status!$A$2:$A$21`, ou null se a aba/coluna não existir.
 */
function computeStatusListFormula(workbook, validationConfig) {
  if (!validationConfig) return null;
  const sheetName = validationConfig.sheet;
  const colLetter = validationConfig.column || "A";
  const headerRow = validationConfig.headerRow || 1;

  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) return null;

  let lastRow = headerRow;
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const v = sheet.getCell(`${colLetter}${r}`).value;
    if (v !== null && v !== undefined && String(v).trim() !== "") lastRow = r;
  }
  if (lastRow <= headerRow) return null;

  return `'${sheetName}'!$${colLetter}$${headerRow + 1}:$${colLetter}$${lastRow}`;
}

/**
 * Aplica (ou reaplica) a validação em lista (Listbox) na célula de Status
 * de uma linha específica, apontando pra fórmula calculada por
 * `computeStatusListFormula`. Chamado toda vez que o app escreve um valor
 * de Status -- tanto em linha nova quanto em linha já existente -- pra
 * garantir que o campo continue sendo um Listbox de verdade (clicável),
 * e não texto solto.
 */
function applyStatusListValidation(worksheet, statusCol, rowNumber, formula) {
  if (!formula) return;
  const cell = worksheet.getRow(rowNumber).getCell(statusCol);
  cell.dataValidation = {
    type: "list",
    allowBlank: true,
    formulae: [formula],
    showErrorMessage: true,
  };
}

/**
 * Abre o workbook e faz uma cópia de segurança (.bak) do arquivo antes de
 * qualquer alteração. Guarda os bytes ORIGINAIS do arquivo inteiro e a
 * lista de abas graváveis — usados depois em `saveWorkbook` pra montar o
 * arquivo final protegendo tudo que o programa não edita (ver
 * lib/xlsxSurgery.js pro motivo completo).
 */
async function openWorkbook(filePath, makeBackup, writableSheetNames = []) {
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

  const rawBuffer = fs.readFileSync(filePath);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(rawBuffer);

  workbook.__originalRawBuffer = rawBuffer;
  workbook.__writableSheetNames = writableSheetNames;

  return workbook;
}

/**
 * Salva o workbook de volta no mesmo caminho, de forma ATÔMICA: escreve
 * primeiro num arquivo temporário (na mesma pasta, mesmo disco) e só troca
 * pelo arquivo final com um `rename` — que é praticamente instantâneo —
 * em vez de escrever direto em cima do arquivo original.
 *
 * Isso importa especialmente aqui porque o arquivo fica dentro de uma pasta
 * sincronizada pelo OneDrive: escrever um .xlsx grande direto no destino
 * final pode levar alguns segundos, e se o OneDrive (ou um antivírus)
 * mexer no arquivo enquanto ele ainda está sendo escrito pela metade, o
 * resultado é um arquivo corrompido.
 *
 * Antes de trocar o arquivo de verdade, monta a versão final combinando o
 * ORIGINAL (intocado, pra tudo que o programa não edita -- outras abas,
 * Tabela Dinâmica, gráfico, Tabela, comentário, etc.) com só o que o
 * ExcelJS escreveu de fato novo (as duas abas graváveis + styles/shared
 * strings -- ver `buildFinalXlsxBuffer` em lib/xlsxSurgery.js), e só then
 * valida que todo XML do resultado abre sem erro. Se sobrar qualquer parte
 * malformada, aborta sem tocar no arquivo de verdade -- melhor a
 * sincronização falhar com um erro claro do que substituir uma planilha
 * boa por uma corrompida.
 */
async function saveWorkbook(workbook, filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmpPath = path.join(dir, `.${base}.tmp-${process.pid}-${Date.now()}`);

  const cleanupTmp = () => {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (_) {
      /* ignora erro de limpeza, o erro original é o que importa */
    }
  };

  try {
    await workbook.xlsx.writeFile(tmpPath);
  } catch (err) {
    cleanupTmp();
    if (err && (err.code === "EBUSY" || err.code === "EPERM")) {
      throw new Error(
        `Não consegui salvar "${filePath}" — parece que o arquivo está aberto no Excel. Feche a planilha e rode o sync de novo.`
      );
    }
    throw err;
  }

  try {
    let finalBuffer;
    if (workbook.__originalRawBuffer) {
      const writtenBuffer = fs.readFileSync(tmpPath);
      finalBuffer = await buildFinalXlsxBuffer(
        workbook.__originalRawBuffer,
        writtenBuffer,
        workbook.__writableSheetNames || []
      );
    } else {
      finalBuffer = fs.readFileSync(tmpPath);
    }

    const xmlErrors = await validateZipXmlPartsWellFormed(finalBuffer);
    if (xmlErrors.length > 0) {
      const detalhe = xmlErrors.map((e) => `  - ${e.path}: ${e.error}`).join("\n");
      throw new Error(
        `Abortei o salvamento: o .xlsx que ia ser gravado tem XML inválido em ${xmlErrors.length} parte(s) ` +
          `(o Excel provavelmente ia reportar "conteúdo ilegível" ao abrir). O arquivo original NÃO foi alterado.\n${detalhe}`
      );
    }

    fs.writeFileSync(tmpPath, finalBuffer);
  } catch (err) {
    cleanupTmp();
    throw err;
  }

  try {
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    cleanupTmp();
    if (err && (err.code === "EBUSY" || err.code === "EPERM")) {
      throw new Error(
        `Salvei o arquivo temporário mas não consegui substituir "${filePath}" — parece que o arquivo está aberto no Excel (ou o OneDrive está sincronizando ele agora). Feche a planilha, espere o ícone do OneDrive terminar de sincronizar, e rode o sync de novo.`
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
  computeStatusListFormula,
  applyStatusListValidation,
  openWorkbook,
  saveWorkbook,
};
