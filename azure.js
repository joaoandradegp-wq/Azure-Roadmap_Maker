// azure.js
// Conecta ao Azure DevOps, busca os Work Items configurados e gera data/roadmap.json
// no formato que render.js consome.
//
// Uso:
//   export AZURE_DEVOPS_PAT=xxxxxxxxxxxx
//   node azure.js [config.json] [saida.json]
//
// Se nenhum config for passado, usa config.json na raiz do projeto
// (copie config.example.json para config.json e ajuste org/project/campos).

const fs = require("fs");
const path = require("path");
const { fetchWorkItems } = require("./lib/azureClient");
const { transform } = require("./lib/transform");

async function main() {
  const configPath = process.argv[2] || path.join(__dirname, "config.json");
  const outPath = process.argv[3] || path.join(__dirname, "data", "roadmap.json");

  if (!fs.existsSync(configPath)) {
    console.error(
      `Config não encontrado em ${configPath}.\n` +
      `Copie config.example.json para config.json e ajuste organization/project/PAT antes de rodar.`
    );
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

  console.log(`Buscando work items em ${config.azure.organization}/${config.azure.project}...`);
  const workItems = await fetchWorkItems(config);
  console.log(`${workItems.length} work item(s) encontrado(s).`);

  const roadmap = transform(workItems, config);

  fs.writeFileSync(outPath, JSON.stringify(roadmap, null, 2), "utf-8");
  console.log(`Gerado: ${outPath}`);
}

main().catch((err) => {
  console.error("Erro:", err.message);
  process.exit(1);
});
