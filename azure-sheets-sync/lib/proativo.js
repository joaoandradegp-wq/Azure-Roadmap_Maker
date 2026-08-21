// lib/proativo.js
// Um card é "Proativo" se tiver a tag configurada (default: "proativo",
// case-insensitive) OU se o título começar com "Proativo" — tolerando
// aspas, colchetes, parênteses e espaços antes da palavra.

const { hasTag } = require("./normalize");

function isProativo(item, config) {
  const cfg = config.proativo || {};
  const tagMatch = cfg.tagMatch || "proativo";

  if (hasTag(item, tagMatch)) return true;

  const pattern = new RegExp(cfg.titleRegex || '^[\\s"\'\\[\\(]*proativo', cfg.titleRegexFlags || "i");
  return pattern.test(item.title || "");
}

module.exports = { isProativo };
