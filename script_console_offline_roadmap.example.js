(async () => {
  const PRODUTO = "PRODUTO_A"; // PRODUTO_A, PRODUTO_B ou PRODUTO_C 

  const ORG = "SUA_ORGANIZACAO";   // https://dev.azure.com/<ORG>
  const API = "7.1";
  const INCLUIR_BUG = true; // true = traz itens com tag Bug | false = exclui
  const DATA_INICIAL = "2026-01-01"; // só traz itens criados a partir desta data
  const TAG_BUG = "Bug";
  const TAG_IGNORAR = "RASCUNHO"; // itens com esta tag são ignorados
  const COMUM = `[System.CreatedDate] >= '${DATA_INICIAL}'${INCLUIR_BUG ? "" : ` AND [System.Tags] NOT CONTAINS '${TAG_BUG}'`} AND [System.Tags] NOT CONTAINS '${TAG_IGNORAR}'`;
  const TIPOS_PADRAO = ["Feature", "User Story", "Tech Story"]; // tipos de work item (nomes exatos do seu processo no Azure)

  const PRODUTOS = {
    PRODUTO_A: { project: "SEU_PROJETO_A", areaPath: "SEU_AREA_PATH_A", types: TIPOS_PADRAO,                extra: `[System.BoardLane] = 'RAIA_A' AND ${COMUM}` },
    PRODUTO_B: { project: "SEU_PROJETO_A", areaPath: "SEU_AREA_PATH_A", types: TIPOS_PADRAO,                extra: `[System.BoardLane] = 'RAIA_B' AND ${COMUM}` },
    PRODUTO_C: { project: "SEU_PROJETO_B", areaPath: "SEU_AREA_PATH_B", types: ["Feature", "User Story"],  extra: `[System.BoardLane] = 'RAIA_C' AND ${COMUM}` },
  };

  const FIELDS = [
    "System.Id", "System.Title", "System.WorkItemType", "System.State",
    "System.AssignedTo", "System.IterationPath", "System.Tags",
    "Microsoft.VSTS.Scheduling.StartDate", "Microsoft.VSTS.Scheduling.TargetDate",
    "Microsoft.VSTS.Common.ClosedDate",
  ];

  const p = PRODUTOS[PRODUTO];
  if (!p) throw new Error(`PRODUTO inválido. Use: ${Object.keys(PRODUTOS).join(", ")}.`);

  const base = `https://dev.azure.com/${ORG}/${encodeURIComponent(p.project)}/_apis`;
  const tipos = p.types.map((t) => `'${t}'`).join(", ");
  const wiql =
    `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] IN (${tipos}) ` +
    `AND [System.State] <> 'Removed' AND [System.AreaPath] UNDER '${p.areaPath}' ` +
    `AND (${p.extra}) ORDER BY [System.Id]`;

  async function chamar(url, opts) {
    const res = await fetch(url, { credentials: "include", ...opts });
    const txt = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt.slice(0, 300)}`);
    try { return JSON.parse(txt); }
    catch { throw new Error("Resposta não é JSON (sessão expirada ou página de login). Recarregue a página e tente de novo."); }
  }

  console.log(`Rodando WIQL de ${PRODUTO}...`);
  const q = await chamar(`${base}/wit/wiql?api-version=${API}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: wiql }),
  });
  const ids = (q.workItems || []).map((w) => w.id);
  console.log(`${ids.length} work item(s) encontrados. Buscando detalhes...`);

  const itens = [];
  for (let i = 0; i < ids.length; i += 200) {
    const lote = ids.slice(i, i + 200);
    const d = await chamar(
      `${base}/wit/workitems?ids=${lote.join(",")}&fields=${FIELDS.join(",")}&api-version=${API}`
    );
    itens.push(...(d.value || []));
  }

  const blob = new Blob([JSON.stringify(itens, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `workitems-${PRODUTO}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  console.log(`Pronto: ${itens.length} item(s) salvos em workitems-${PRODUTO}.json`);
})();
