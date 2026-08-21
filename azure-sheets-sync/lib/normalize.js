// lib/normalize.js
// Pega o work item cru retornado pela API do Azure (com fields por reference
// name, tipo "System.State") e devolve um objeto simples e previsível pro
// resto da aplicação usar.

const { extractItemSprintNumber } = require("./sprintUtils");

function normalizeWorkItem(rawItem, fieldsConfig) {
  const f = rawItem.fields || {};

  const id = f[fieldsConfig.id] ?? rawItem.id;
  const title = (f[fieldsConfig.title] || "").toString().trim();
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
    chamado: chamado === undefined || chamado === null ? "" : String(chamado).trim(),
    createdDate: createdDate && !Number.isNaN(createdDate.getTime()) ? createdDate : null,
    sprintNumber,
  };
}

function hasTag(item, tagName) {
  const target = tagName.toLowerCase();
  return item.tags.some((t) => t.toLowerCase() === target);
}

module.exports = { normalizeWorkItem, hasTag };
