const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");
const { spawnSync } = require("child_process");
const { fetchWorkItems } = require("./lib/azureClient");
const { transform, extractSprintNumber } = require("./lib/transform");

function sprintNumberOf(item, config) {
  const f = item.fields;
  const iterationPathRaw = f[config.fields.iterationPath];
  const rawTitle = f[config.fields.title] || "";
  return extractSprintNumber(iterationPathRaw) ?? extractSprintNumber(rawTitle);
}

const PRODUTOS = ["LIVRE", "FLEET", "RAC"];

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

function parseSprintSelection(raw) {
  const tokens = raw.split(",").map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) return null;
  const numbers = tokens.map((t) => parseInt(t, 10));
  if (numbers.some((n) => isNaN(n))) return null;
  return numbers;
}

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
