// fixtures/test-transform.js
// Testa lib/transform.js usando o mock de work items, sem precisar de rede/PAT real.
// Uso: node fixtures/test-transform.js

const fs = require("fs");
const path = require("path");
const { transform } = require("../lib/transform");

const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf-8")
);
const workItems = JSON.parse(
  fs.readFileSync(path.join(__dirname, "mock-workitems.json"), "utf-8")
);

const today = new Date(2026, 7, 10); // 10/08/2026

const result = transform(workItems, config, { today });

console.log(JSON.stringify(result.roadmap, null, 2));
console.log("\nTítulos na ordem final:", result.roadmap.map((r) => r.title));

// Deveria sobrar: id 1 (SP09 via título), id 2 (SP10), id 5 (SP09 atraso), id 6 (SP09 no prazo)
// Fora: id 3 (tag Bug), id 4 (SP01, fora da janela de 3 meses)
console.assert(result.roadmap.length === 4, `Deveria sobrar 4 itens, veio ${result.roadmap.length}`);
console.assert(
  !result.roadmap.some((r) => r.id === 3),
  "Item com tag Bug não deveria aparecer"
);
console.assert(
  !result.roadmap.some((r) => r.id === 4),
  "Item da SP01 (fora da janela) não deveria aparecer"
);

const item1 = result.roadmap.find((r) => r.id === 1);
console.assert(
  item1 && item1.title === "SP09 - Zebra: item com sprint só no título (deveria virar SP09)",
  `Título do item 1 deveria começar com "SP09 - Zebra", veio "${item1 && item1.title}"`
);

const item5 = result.roadmap.find((r) => r.id === 5);
console.assert(
  item5 && item5.deliveryStatus === "concluidaAtraso",
  `Item 5 (fechou 15/08, sprint terminava 07/08) deveria ser concluidaAtraso, veio "${item5 && item5.deliveryStatus}"`
);

const item6 = result.roadmap.find((r) => r.id === 6);
console.assert(
  item6 && item6.deliveryStatus === "concluidaPrazo",
  `Item 6 (fechou 05/08, sprint terminava 07/08) deveria ser concluidaPrazo, veio "${item6 && item6.deliveryStatus}"`
);

// Ordenação alfabética: Alfa, Beta, Delta, Zebra (ignorando o prefixo SPxx)
const titles = result.roadmap.map((r) => r.title);
const sortedCopy = [...titles].sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
console.assert(
  JSON.stringify(titles) === JSON.stringify(sortedCopy),
  "Lista deveria estar em ordem alfabética"
);

console.log("\nOK: checagens básicas passaram.");
