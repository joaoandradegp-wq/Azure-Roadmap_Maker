// lib/xlsxSurgery.js
// REESCRITO em 31/08/2026 -- a correção de 28/08 (proteger só as abas +
// comentário/VML/desenho/tabela que a gente descobria seguindo os .rels de
// cada aba) não foi suficiente: apareceu corrupção numa Tabela Dinâmica
// (PivotTable) e num desenho na aba "Painel" que a busca por .rels não
// alcançava (PivotTable/PivotCache são referenciados pelo xl/workbook.xml
// direto, não pelo .rels da aba), e até em células da aba "Status" (efeito
// colateral do reparo do Excel tentando consertar a Tabela Dinâmica).
//
// Nova estratégia, bem mais simples e à prova de qualquer recurso do Excel
// que a gente não conhece (Tabela Dinâmica, gráfico, Tabela, VML, Slicer,
// Sparkline etc.): ao invés de tentar adivinhar TUDO que precisa ser
// protegido, a gente inverte -- só um punhado de partes específicas vêm da
// versão que o ExcelJS acabou de escrever (as duas abas que o programa
// realmente edita, "LIVRE Oficial" e "Pró ativos", mais xl/styles.xml e
// xl/sharedStrings.xml, que precisam estar atualizados pra essas duas abas
// funcionarem). TUDO o mais no arquivo -- toda outra aba, Tabela Dinâmica,
// gráfico, comentário, imagem, workbook.xml, Content_Types, o que for --
// fica com os bytes ORIGINAIS, sem o ExcelJS nunca ter chance de mexer.
//
// A única correção necessária nas abas que ficam com bytes originais: como
// o ExcelJS reconstrói do zero as listas de `dxfs` (cor de formatação
// condicional) e de `sharedStrings` (texto) -- e pode deduplicar/reordenar
// entradas idênticas -- os índices antigos que essas abas originais usam
// (`dxfId="N"`, `t="s"` + `<v>N</v>`) são corrigidos pra acompanhar as
// listas novas antes de gravar.

const JSZip = require("jszip");
const { SaxesParser } = require("saxes");

/**
 * Lê o xl/workbook.xml + xl/_rels/workbook.xml.rels de um zip e monta um
 * mapa { "Nome da Aba": "xl/worksheets/sheetN.xml" }.
 */
async function mapSheetNamesToParts(zip) {
  const workbookXml = await zip.file("xl/workbook.xml").async("string");
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels").async("string");

  const relIdToTarget = {};
  const relRe = /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g;
  let rm;
  while ((rm = relRe.exec(relsXml))) {
    relIdToTarget[rm[1]] = `xl/${rm[2]}`;
  }

  const map = {};
  const sheetRe = /<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"/g;
  let sm;
  while ((sm = sheetRe.exec(workbookXml))) {
    const name = sm[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    const rid = sm[2];
    if (relIdToTarget[rid]) map[name] = relIdToTarget[rid];
  }
  return map;
}

/** Extrai os blocos `<dxf>...</dxf>` de dentro de `<dxfs>...</dxfs>` de um styles.xml (texto), na ordem/posição (índice = dxfId). */
function extractDxfEntries(stylesXml) {
  const m = /<dxfs[^>]*>([\s\S]*?)<\/dxfs>/.exec(stylesXml);
  if (!m) return [];
  const body = m[1];
  const entries = [];
  const re = /<dxf\b[\s\S]*?<\/dxf>/g;
  let em;
  while ((em = re.exec(body))) entries.push(em[0]);
  return entries;
}

/** Extrai os blocos `<si>...</si>` (cada um é uma string única) de um sharedStrings.xml (texto), na ordem/posição (índice = usado em `t="s"` + `<v>índice</v>`). */
function extractSharedStringEntries(sharedStringsXml) {
  const entries = [];
  const re = /<si>[\s\S]*?<\/si>|<si\/>/g;
  let em;
  while ((em = re.exec(sharedStringsXml))) entries.push(em[0]);
  return entries;
}

/**
 * Compara uma lista de itens ANTES/DEPOIS do ExcelJS reescrever (dxfs ou
 * sharedStrings) e devolve um mapa { índiceAntigo: índiceNovo }, casando
 * por CONTEÚDO (o ExcelJS reconstrói essas listas do zero ao salvar e pode
 * deduplicar/reordenar entradas idênticas, então a posição muda mesmo
 * quando o conteúdo continua lá).
 */
function buildIndexRemap(originalEntries, finalEntries) {
  const remap = {};
  const unmatched = [];
  originalEntries.forEach((entry, oldIndex) => {
    const newIndex = finalEntries.indexOf(entry);
    if (newIndex >= 0) {
      remap[oldIndex] = newIndex;
    } else {
      unmatched.push(oldIndex);
    }
  });
  return { remap, unmatched };
}

/** Aplica o remapeamento de `dxfId="N"` num texto XML, usando o mapa { índiceAntigo: índiceNovo }. */
function applyDxfRemap(xmlText, remap) {
  if (!remap || Object.keys(remap).length === 0) return xmlText;
  return xmlText.replace(/dxfId="(\d+)"/g, (full, idxStr) => {
    const idx = Number(idxStr);
    return idx in remap ? `dxfId="${remap[idx]}"` : full;
  });
}

/**
 * Aplica o remapeamento de índice de shared string nas células `t="s"`
 * (`<c ... t="s"><v>N</v></c>`, em qualquer ordem de atributo) de um texto
 * XML, usando o mapa { índiceAntigo: índiceNovo }.
 */
function applySharedStringRemap(xmlText, remap) {
  if (!remap || Object.keys(remap).length === 0) return xmlText;
  return xmlText.replace(/(<c\b[^>]*\bt="s"[^>]*>\s*<v>)(\d+)(<\/v>)/g, (full, prefix, idxStr, suffix) => {
    const idx = Number(idxStr);
    return idx in remap ? `${prefix}${remap[idx]}${suffix}` : full;
  });
}

/**
 * Monta o .xlsx FINAL: parte do zip ORIGINAL (intocado) e troca só 4 tipos
 * de parte pela versão que o ExcelJS acabou de escrever -- as duas abas
 * graváveis, `xl/styles.xml` e `xl/sharedStrings.xml`. Todo o resto do
 * arquivo (qualquer outra aba, Tabela Dinâmica, gráfico, Tabela, VML,
 * imagem, workbook.xml, Content_Types...) nunca passa pelo ExcelJS.
 *
 * Como as duas listas trocadas (`dxfs` dentro de styles.xml, e
 * sharedStrings.xml) podem ter sido deduplicadas/reordenadas pelo ExcelJS,
 * todo `.xml` de worksheet que ficou com bytes originais tem suas
 * referências `dxfId`/`t="s"` corrigidas antes de entrar no zip final.
 */
async function buildFinalXlsxBuffer(originalRawBuffer, writtenBuffer, writableSheetNames) {
  const originalZip = await JSZip.loadAsync(originalRawBuffer);
  const writtenZip = await JSZip.loadAsync(writtenBuffer);

  const sheetNameToPart = await mapSheetNamesToParts(originalZip);
  const writable = new Set(writableSheetNames);
  const writablePartPaths = new Set(
    Object.entries(sheetNameToPart)
      .filter(([name]) => writable.has(name))
      .map(([, part]) => part)
  );
  const allWorksheetPartPaths = new Set(Object.values(sheetNameToPart));

  const originalStylesXml = await originalZip.file("xl/styles.xml").async("string");
  const writtenStylesFile = writtenZip.file("xl/styles.xml");
  const finalStylesXml = writtenStylesFile ? await writtenStylesFile.async("string") : originalStylesXml;
  const dxfBuilt = buildIndexRemap(extractDxfEntries(originalStylesXml), extractDxfEntries(finalStylesXml));
  if (dxfBuilt.unmatched.length > 0) {
    console.warn(
      `[xlsxSurgery] Aviso: ${dxfBuilt.unmatched.length} formatação(ões) condicional(is) original(is) sem equivalente na lista nova de estilos -- referência dxfId mantida como estava.`
    );
  }

  const originalSharedStringsFile = originalZip.file("xl/sharedStrings.xml");
  const originalSharedStringsXml = originalSharedStringsFile ? await originalSharedStringsFile.async("string") : null;
  const writtenSharedStringsFile = writtenZip.file("xl/sharedStrings.xml");
  let stringRemap = null;
  if (originalSharedStringsXml && writtenSharedStringsFile) {
    const finalSharedStringsXml = await writtenSharedStringsFile.async("string");
    const built = buildIndexRemap(
      extractSharedStringEntries(originalSharedStringsXml),
      extractSharedStringEntries(finalSharedStringsXml)
    );
    stringRemap = built.remap;
    if (built.unmatched.length > 0) {
      console.warn(
        `[xlsxSurgery] Aviso: ${built.unmatched.length} texto(s) original(is) sem equivalente na lista nova de shared strings -- referência mantida como estava.`
      );
    }
  }

  const finalZip = originalZip; // parte de tudo que já está aí (bytes originais) e só troca o que precisa

  // 1) As duas abas graváveis: pega a versão FRESCA do ExcelJS inteira (já
  //    consistente com o styles.xml/sharedStrings.xml novos, sem precisar
  //    de remap).
  for (const partPath of writablePartPaths) {
    const fresh = writtenZip.file(partPath);
    if (fresh) finalZip.file(partPath, await fresh.async("nodebuffer"));
  }

  // 2) Qualquer OUTRA aba (todas as que não são graváveis): mantém o XML
  //    original, só corrigindo dxfId/shared-string pra acompanhar as
  //    listas novas.
  for (const partPath of allWorksheetPartPaths) {
    if (writablePartPaths.has(partPath)) continue;
    const original = originalZip.file(partPath);
    if (!original) continue;
    let text = await original.async("string");
    text = applyDxfRemap(text, dxfBuilt.remap);
    if (stringRemap) text = applySharedStringRemap(text, stringRemap);
    finalZip.file(partPath, text);
  }

  // 3) styles.xml e sharedStrings.xml: sempre a versão nova do ExcelJS
  //    (é o que dá suporte às mudanças nas duas abas graváveis).
  finalZip.file("xl/styles.xml", finalStylesXml);
  if (writtenSharedStringsFile) {
    finalZip.file("xl/sharedStrings.xml", await writtenSharedStringsFile.async("nodebuffer"));
  }

  return finalZip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/**
 * Confere que TODO arquivo .xml/.vml/.rels dentro do .xlsx final abre sem
 * erro de sintaxe — a mesma checagem que o Excel faz ao abrir (e que falha
 * com "Erro de carregamento. Linha X, coluna Y" quando alguma parte veio
 * malformada). Devolve uma lista de erros (vazia = tudo certo).
 */
async function validateZipXmlPartsWellFormed(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const errors = [];

  const entries = Object.values(zip.files).filter((f) => !f.dir && /\.(xml|vml|rels)$/i.test(f.name));

  for (const entry of entries) {
    const xml = await entry.async("string");
    const err = await checkXmlWellFormed(xml);
    if (err) errors.push({ path: entry.name, error: err });
  }
  return errors;
}

function checkXmlWellFormed(xml) {
  return new Promise((resolve) => {
    const parser = new SaxesParser();
    let error = null;
    parser.on("error", (e) => {
      error = e.message;
    });
    try {
      parser.write(xml).close();
    } catch (e) {
      error = error || e.message;
    }
    resolve(error);
  });
}

module.exports = {
  buildFinalXlsxBuffer,
  validateZipXmlPartsWellFormed,
};
