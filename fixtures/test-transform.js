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

// Data fixa para o teste ser determinístico
const today = new Date(2026, 7, 10); // 10/08/2026 — dentro da SP10 (10/08-21/08)

const result = transform(workItems, config, { today });

console.log(JSON.stringify(result, null, 2));

console.assert(result.roadmap.length === 4, "Deveria ter 4 itens no roadmap");
console.assert(
  result.roadmap[0].title === "SP10 - Liveness Fraude",
  `Título deveria ser "SP10 - Liveness Fraude", veio "${result.roadmap[0].title}"`
);
console.assert(
  result.roadmap[3].title === "Item sem sprint atribuída",
  `Item sem sprint deveria manter título limpo, veio "${result.roadmap[3].title}"`
);
console.assert(
  result.roadmap[0].startPeriod.month === "Agosto" && result.roadmap[0].startPeriod.subcolIndex === 0,
  "SP10 começa 10/08 -> Agosto, subcol 0 (1-15)"
);
console.assert(
  result.roadmap[1].endPeriod.month === "Agosto" && result.roadmap[1].endPeriod.subcolIndex === 0,
  "Item 10522 fechado em 05/08 -> endPeriod deveria ser Agosto subcol 0 (ClosedDate manda, não a sprint)"
);
console.assert(
  Math.abs(result.todayPeriod.fraction - (9 / 14)) < 0.01,
  `todayPeriod.fraction para dia 10 deveria ser ~0.64, veio ${result.todayPeriod.fraction}`
);

console.log("\nOK: checagens básicas passaram.");
