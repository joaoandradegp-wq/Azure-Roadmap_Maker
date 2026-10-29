const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");
const {
  applyProductToConfig,
  askProductSelection,
  askIncludeBugs,
  sprintNumberOf,
  PRODUTOS,
} = require("../azure");
const ROOT = path.join(__dirname, ".."); // pasta do Azure-Roadmap_Maker
const { buildStatusReport, currentSprintNumber, BOARD_COLUMN_FIELD } = require("./lib/statusTransform");
const { renderStatusReport } = require("./lib/statusRender");

function loadOfflineWorkItems(produto) {
  const nome = `status-config-${produto}.json`;
  const dirs = [path.join(__dirname, "data"), path.join(ROOT, "data")];
  const file = dirs.map((d) => path.join(d, nome)).find((f) => fs.existsSync(f));

  if (!file) {
    const disponiveis = dirs.flatMap((d) =>
      fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /^status-config-.*\.json$/i.test(f)).map((f) => path.join(d, f)) : []
    );
    throw new Error(
      `Arquivo offline não encontrado: ${nome}\n` +
      `Procurei em:\n  ${dirs.join("\n  ")}\n` +
      (disponiveis.length
        ? `Arquivos status-config-*.json encontrados:\n  ${disponiveis.join("\n  ")}`
        : `Nenhum arquivo status-config-*.json encontrado.`)
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf-8").replace(/^\uFEFF/, ""));
  } catch (err) {
    throw new Error(`O arquivo ${file} não é um JSON válido: ${err.message}`);
  }
  const items = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.value) ? parsed.value : null;
  if (!items || items.some((it) => !it || typeof it !== "object" || !it.fields)) {
    throw new Error(`O arquivo ${file} não tem o formato esperado (lista de work items com "fields").`);
  }
  console.log(`Modo OFFLINE: lendo ${file}`);
  return items;
}

async function askSprint(availableSprints, defaultSprint) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const list = availableSprints.join(", ");
  try {
    while (true) {
      const answer = (
        await rl.question(
          `\nQual Sprint deseja no status report? (disponíveis: ${list} — Enter = ${defaultSprint})\n> `
        )
      ).trim();
      if (answer === "") return defaultSprint;
      const n = parseInt(answer, 10);
      if (!isNaN(n) && availableSprints.includes(n)) return n;
      console.log(`Sprint inválida. Escolha entre: ${list}`);
    }
  } finally {
    rl.close();
  }
}

function parseHoje(raw) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw || "");
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1]);
}

function loadUserConfig(produto) {
  const file = path.join(__dirname, "data", `status-ajustes-${produto}.json`);
  if (!fs.existsSync(file)) {
    const skeleton = {
      _ajuda: "Veja data/status-ajustes.exemplo.json. Chaves opcionais: saude, tempo_consumido, progresso_geral, periodo, proxima_sprint, itens, ocultar, ids_extras, detalhamento, janelas.",
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(skeleton, null, 2), "utf-8");
    console.log(`Criado ${file} (opcional: detalhamento, janelas e ajustes manuais).`);
    return { file, cfg: {} };
  }
  try {
    return { file, cfg: JSON.parse(fs.readFileSync(file, "utf-8").replace(/^\uFEFF/, "")) };
  } catch (err) {
    throw new Error(`O arquivo ${file} não é um JSON válido: ${err.message}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("--"));
  const flag = (name) => args.find((a) => a.startsWith(`--${name}=`));
  const offline = args.includes("--offline");
  const bugsFlag = args.includes("--bugs") ? true : args.includes("--sem-bugs") ? false : null;

  const configPath = positional[0] || path.join(ROOT, "config.json");
  if (!fs.existsSync(configPath)) {
    console.error(`Config não encontrado em ${configPath}.`);
    process.exit(1);
  }
  let config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

  let produto;
  if (flag("produto")) {
    produto = flag("produto").split("=")[1].trim().toUpperCase();
    if (!PRODUTOS.includes(produto)) {
      console.error(`--produto inválido. Use LIVRE, FLEET ou RAC.`);
      process.exit(1);
    }
  } else {
    produto = await askProductSelection();
  }
  const includeBugs = bugsFlag !== null ? bugsFlag : await askIncludeBugs();
  config = applyProductToConfig(config, produto, { includeBugs });
  console.log(`Produto selecionado: ${produto}`);
  console.log(`Itens com tag Bug: ${includeBugs ? "INCLUÍDOS" : "não incluídos"}`);

  // a coluna do board precisa vir na consulta online (azureClient monta os campos a partir de config.fields)
  config.fields = { boardColumn: BOARD_COLUMN_FIELD, ...(config.fields || {}) };

  let workItems;
  if (offline) {
    workItems = loadOfflineWorkItems(produto);
  } else {
    const { fetchWorkItems } = require("../lib/azureClient");
    console.log(`Buscando work items em ${config.azure.organization}/${config.azure.project}...`);
    workItems = await fetchWorkItems(config);
  }
  console.log(`${workItems.length} work item(s) encontrado(s).`);

  const today = parseHoje((flag("hoje") || "").split("=")[1]) || new Date();

  const availableSprints = [
    ...new Set(workItems.map((it) => sprintNumberOf(it, config)).filter((n) => n !== null && n !== undefined)),
  ].sort((a, b) => a - b);
  if (availableSprints.length === 0) {
    console.error("Nenhum item com sprint numerada reconhecível foi encontrado.");
    process.exit(1);
  }

  const cur = currentSprintNumber(config, today);
  const defaultSprint =
    availableSprints.includes(cur)
      ? cur
      : [...availableSprints].reverse().find((n) => n <= cur) ?? availableSprints[availableSprints.length - 1];

  let sprint;
  const sprintFlag = flag("sprint") || flag("sprints");
  if (sprintFlag) {
    sprint = parseInt(sprintFlag.split("=")[1], 10);
    if (!availableSprints.includes(sprint)) {
      console.error(`--sprint inválido. Sprints disponíveis: ${availableSprints.join(", ")}`);
      process.exit(1);
    }
  } else {
    sprint = await askSprint(availableSprints, defaultSprint);
  }
  console.log(`Sprint selecionada: ${sprint}`);

  const { file: userCfgFile, cfg: userCfg } = loadUserConfig(produto);
  const { model, notes } = buildStatusReport(workItems, config, { sprint, includeBugs, today, userCfg });

  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${today.getFullYear()}${pad(today.getMonth() + 1)}${pad(today.getDate())}`;
  const outDir = path.join(__dirname, "output");
  const outPath = path.join(outDir, `status_report_${produto}_sprint${sprint}_${stamp}.pptx`);
  fs.mkdirSync(outDir, { recursive: true });
  const renderWarnings = await renderStatusReport(model, outPath, path.join(__dirname, "assets"));

  console.log(`\nSprint ${sprint} | ${model.periodo} | ${model.tempo}% tempo | ${model.progresso}% progresso | ${model.saude}`);
  console.log(`${model.itens.length} item(ns):`);
  for (const i of model.itens) {
    const flags = `${i.pctAuto ? "*" : " "}${i.bug ? " [BUG]" : ""}`;
    console.log(
      `  ${i.id}  ${i.status.padEnd(12)} ${String(i.pct).padStart(3)}%${flags} ${i.title.slice(0, 50)}` +
      (i.column ? `  <${i.column}>` : "")
    );
  }
  if (model.itens.some((i) => i.pctAuto)) {
    console.log(`\n* = % automático (tempo consumido da sprint) — confira/ajuste em ${userCfgFile} (itens).`);
  }
  for (const [col, ids] of notes.unmapped) {
    console.log(`AVISO: coluna sem regra "${col}" (itens ${ids.join(", ")}) — tratei como Andamento. Veja DEFAULT_COLUMN_RULES em lib/statusTransform.js.`);
  }
  if (notes.excluded.length) console.log(`AVISO: fora do relatório (entregue depois da sprint): ${notes.excluded.join("; ")}`);
  [...notes.warnings, ...renderWarnings].forEach((w) => console.log("AVISO:", w));
  console.log(`\nGerado: ${outPath}`);
}

main().catch((err) => {
  console.error("Erro:", err.message);
  process.exit(1);
});
