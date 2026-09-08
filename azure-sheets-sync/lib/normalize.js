// lib/normalize.js
// Pega o work item cru retornado pela API do Azure (com fields por reference
// name, tipo "System.State") e devolve um objeto simples e previsível pro
// resto da aplicação usar.

const { extractItemSprintNumber } = require("./sprintUtils");

// XML 1.0 não aceita boa parte dos caracteres de controle (só permite TAB,
// LF e CR entre os "baixos"). Título/observações vindos do Azure às vezes
// carregam caracteres assim (colados de outro lugar, por exemplo) — sem
// remover, o exceljs escreve um .xlsx com XML tecnicamente inválido, que o
// Excel detecta como corrompido ao abrir e tenta "reparar" descartando a
// parte com erro.
// eslint-disable-next-line no-control-regex
const ILLEGAL_XML_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;

/** Remove caracteres de controle inválidos em XML 1.0 de um texto qualquer que vai virar valor de célula. */
function sanitizeXmlText(value) {
  if (value === null || value === undefined) return value;
  return String(value).replace(ILLEGAL_XML_CHARS_RE, "");
}

function normalizeWorkItem(rawItem, fieldsConfig) {
  const f = rawItem.fields || {};

  const id = f[fieldsConfig.id] ?? rawItem.id;
  const title = sanitizeXmlText((f[fieldsConfig.title] || "").toString().trim());
  const type = f[fieldsConfig.type] || "";
  const state = f[fieldsConfig.state] || "";
  const tagsRaw = f[fieldsConfig.tags] || "";
  const tags = tagsRaw
    .split(";")
    .map((t) => t.trim())
    .filter(Boolean);
  const iterationPath = f[fieldsConfig.iterationPath] || "";
  const boardColumn = (f[fieldsConfig.boardColumn] || "").toString().trim();
  const chamado = f[fieldsConfig.chamado];

  const createdDateRaw = fieldsConfig.createdDate ? f[fieldsConfig.createdDate] : null;
  const createdDate = createdDateRaw ? new Date(createdDateRaw) : null;

  const sprintNumber = extractItemSprintNumber(iterationPath, title);

  return {
    id,
    title,
    type,
    state,
    tags,
    iterationPath,
    boardColumn,
    chamado: sanitizeXmlText(chamado === undefined || chamado === null ? "" : String(chamado).trim()),
    createdDate: createdDate && !Number.isNaN(createdDate.getTime()) ? createdDate : null,
    sprintNumber,
  };
}

function hasTag(item, tagName) {
  const target = tagName.toLowerCase();
  return item.tags.some((t) => t.toLowerCase() === target);
}

module.exports = { normalizeWorkItem, hasTag, sanitizeXmlText };
