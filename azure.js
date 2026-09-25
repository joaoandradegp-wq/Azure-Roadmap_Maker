// azure.js
// Conecta ao Azure DevOps, pergunta qual produto (LIVRE, FLEET ou RAC) e quais
// sprints exportar, gera data/roadmap.json e, na sequência, já roda render.js
// pra gerar o PPTX — não precisa rodar os dois comandos separados.
//
// Uso:
//   export AZURE_DEVOPS_PAT=xxxxxxxxxxxx
//   node azure.js [config.json] [saida.json]
//   node azure.js [config.json] [saida.json] --produto=LIVRE     (pula a pergunta do produto)
//   node azure.js [config.json] [saida.json] --sprints=9,10      (pula a pergunta da sprint)
//   node azure.js [config.json] [saida.json] --no-render         (só gera o JSON, não chama o render.js)
//
// Se nenhum config for passado, usa config.json na raiz do projeto
// (copie config.example.json para config.json e ajuste org/PAT antes de rodar).
//
// O config.json tem um bloco "products" (LIVRE, FLEET, RAC) com o que muda
// entre eles: projeto do Azure, areaPath, tipos de work item e a query WIQL.
// LIVRE e FLEET hoje só diferem na lane do board; RAC roda em outro projeto
// inteiro (SysMap - Salesforce Comercial) — tudo isso fica dentro do bloco do
// produto escolhido, o resto do config (fields, statusMapping, timeline,
// sprintCadence, squad) é compartilhado pelos três.

const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");
const { spawnSync } = require("child_process");
const { fetchWorkItems } = require("./lib/azureClient");
const { transform, extractSprintNumber } = require("./lib/transform");

/** Extrai o número da sprint de um work item bruto (Iteration Path ou título) */
function sprintNumberOf(item, config) {
  const f = item.fields;
  const iterationPathRaw = f[config.fields.iterationPath];
  const rawTitle = f[config.fields.title] || "";
  return extractSprintNumber(iterationPathRaw) ?? extractSprintNumber(rawTitle);
}

const PRODUTOS = ["LIVRE", "FLEET", "RAC"];

/**
 * Pergunta interativamente qual produto exportar (LIVRE, FLEET ou RAC),
 * repetindo a pergunta se a resposta não for uma das três opções.
 */
async function askProductSelection() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    while (true) {
      const answer = await rl.question(`\nQual produto deseja exportar? (LIVRE, FLEET ou RAC)\n> `);
      const normalized = answer.trim().toUpperCase();

      if (PRODUTOS.includes(normalized)) {
        return normalized;
      }

      console.log(`Entrada inválida. Digite LIVRE, FLEET ou RAC.`);
    }
  } finally {
    rl.close();
  }
}

/**
 * Aplica o bloco config.products[produto] por cima do config compartilhado:
 * troca azure.project, query.areaPath, query.workItemTypes,
 * query.extraWiqlWhere e project.title pelo que está definido pra esse
 * produto. Diferente da versão antiga (que só trocava a tag BoardLane dentro
 * de extraWiqlWhere), isso cobre o caso do RAC, que roda em outro projeto do
 * Azure inteiro, não só em outra lane do mesmo board.
 */
function applyProductToConfig(config, produto) {
  const bloco = config.products && config.products[produto];

  if (!bloco) {
    throw new Error(
      `Não encontrei "products.${produto}" no config.json. ` +
      `Confira se o config tem os blocos LIVRE, FLEET e RAC dentro de "products".`
    );
  }

  return {
    ...config,
    azure: { ...config.azure, project: bloco.project },
    query: {
      areaPath: bloco.areaPath,
      workItemTypes: bloco.workItemTypes,
      extraWiqlWhere: bloco.extraWiqlWhere,
    },
    project: { ...(config.project || {}), title: bloco.title, squad: config.squad },
  };
}

/** "09" ou "9" ou "9,10" -> [9, 10]. Retorna null se algum token não for número. */
function parseSprintSelection(raw) {
  const tokens = raw.split(",").map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) return null;
  const numbers = tokens.map((t) => parseInt(t, 10));
  if (numbers.some((n) => isNaN(n))) return null;
  return numbers;
}

/**
 * Pergunta interativamente quais sprints exportar, repetindo a pergunta se a
 * resposta tiver algum número que não existe entre as sprints disponíveis.
 */
async function askSprintSelection(availableSprints) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const availableList = availableSprints.join(", ");

  try {
    while (true) {
      const answer = await rl.question(
        `\nQual Sprint deseja exportar? (ex: 9 ou 9,10 — disponíveis: ${availableList})\n> `
      );
      const selection = parseSprintSelection(answer);

      if (!selection) {
        console.log(`Entrada inválida. Digite um número ou vários separados por vírgula (ex: 9,10).`);
        continue;
      }

      const invalid = selection.filter((n) => !availableSprints.includes(n));
      if (invalid.length > 0) {
        console.log(
          `Sprint(s) ${invalid.join(", ")} não encontrada(s) entre os itens buscados. ` +
          `Escolha entre: ${availableList}`
        );
        continue;
      }

      return selection;
    }
  } finally {
    rl.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("--"));
  const sprintsFlag = args.find((a) => a.startsWith("--sprints="));
  const produtoFlag = args.find((a) => a.startsWith("--produto="));

  const configPath = positional[0] || path.join(__dirname, "config.json");
  const outPath = positional[1] || path.join(__dirname, "data", "roadmap.json");

  if (!fs.existsSync(configPath)) {
    console.error(
      `Config não encontrado em ${configPath}.\n` +
      `Copie config.example.json para config.json e ajuste organization/PAT antes de rodar.`
    );
    process.exit(1);
  }

  let config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

  let produto;
  if (produtoFlag) {
    produto = produtoFlag.split("=")[1].trim().toUpperCase();
    if (!PRODUTOS.includes(produto)) {
      console.error(`--produto inválido. Use LIVRE, FLEET ou RAC.`);
      process.exit(1);
    }
  } else {
    produto = await askProductSelection();
  }
  config = applyProductToConfig(config, produto);
  console.log(`Produto selecionado: ${produto}`);

  console.log(`Buscando work items em ${config.azure.organization}/${config.azure.project}...`);
  const workItems = await fetchWorkItems(config);
  console.log(`${workItems.length} work item(s) encontrado(s).`);

  // Sprints distintas entre os itens buscados (Iteration Path ou título)
  const availableSprints = [
    ...new Set(
      workItems
        .map((item) => sprintNumberOf(item, config))
        .filter((n) => n !== null && n !== undefined)
    ),
  ].sort((a, b) => a - b);

  if (availableSprints.length === 0) {
    console.log("Nenhum item com sprint numerada reconhecível foi encontrado — gerando com todos os itens, sem filtro de sprint.");
  } else {
    let selection;
    if (sprintsFlag) {
      selection = parseSprintSelection(sprintsFlag.split("=")[1]);
      if (!selection || selection.some((n) => !availableSprints.includes(n))) {
        console.error(
          `--sprints inválido. Sprints disponíveis: ${availableSprints.join(", ")}`
        );
        process.exit(1);
      }
      console.log(`Exportando sprint(s): ${selection.join(", ")}`);
    } else {
      selection = await askSprintSelection(availableSprints);
    }

    const before = workItems.length;
    const selectedSet = new Set(selection);
    const filtered = workItems.filter((item) => {
      const n = sprintNumberOf(item, config);
      return n !== null && n !== undefined && selectedSet.has(n);
    });
    workItems.length = 0;
    workItems.push(...filtered);
    console.log(`Filtrado por sprint: ${before} -> ${workItems.length} item(s).`);
  }

  const roadmap = transform(workItems, config);

  fs.writeFileSync(outPath, JSON.stringify(roadmap, null, 2), "utf-8");
  console.log(`Gerado: ${outPath}`);

  // Roda o render.js na sequência, pra não precisar de dois comandos toda vez.
  // Usa o mesmo roadmap.json que acabou de gerar; saída do PPTX fica no padrão
  // dele (output/status_report.pptx), a menos que --no-render tenha sido passado.
  if (!args.includes("--no-render")) {
    console.log("\nGerando o PowerPoint (render.js)...");
    const renderResult = spawnSync("node", [path.join(__dirname, "render.js"), outPath], {
      stdio: "inherit",
    });
    if (renderResult.status !== 0) {
      console.error("render.js terminou com erro — o roadmap.json foi gerado, mas o PPTX não.");
      process.exit(renderResult.status || 1);
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Erro:", err.message);
    process.exit(1);
  });
}

module.exports = {
  parseSprintSelection,
  sprintNumberOf,
  askSprintSelection,
  askProductSelection,
  applyProductToConfig,
  PRODUTOS,
};
