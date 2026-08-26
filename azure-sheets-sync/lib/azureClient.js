// lib/azureClient.js
// Adaptado do azureClient.js do projeto Azure-Roadmap_Maker (mesma autenticação
// e mesmo jeito de rodar WIQL + buscar work items por ID). A única diferença de
// comportamento é que aqui, por padrão, NÃO excluímos os itens com State
// "Removed" da query — porque eles viram status "Cancelado" na planilha.
//
// Requer Node 18+ (usa fetch global). Autenticação via PAT (Personal Access
// Token) com Basic Auth (usuário vazio + PAT como senha).

function buildAuthHeader(pat) {
  const token = Buffer.from(`:${pat}`).toString("base64");
  return `Basic ${token}`;
}

function baseUrl(org, project) {
  return `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis`;
}

/**
 * Monta a WIQL a partir da config (tipos de work item, area path, filtro extra).
 * @param {object} queryConfig
 * @param {boolean} includeRemovedState - se false, exclui State = 'Removed' (comportamento antigo)
 */
function buildWiql(queryConfig, includeRemovedState = true) {
  const types = queryConfig.workItemTypes || ["Feature"];
  const typeList = types.map((t) => `'${t}'`).join(", ");

  let where = `[System.WorkItemType] IN (${typeList})`;
  if (!includeRemovedState) {
    where += ` AND [System.State] <> 'Removed'`;
  }

  if (queryConfig.areaPath) {
    where += ` AND [System.AreaPath] UNDER '${queryConfig.areaPath}'`;
  }
  if (queryConfig.extraWiqlWhere) {
    where += ` AND (${queryConfig.extraWiqlWhere})`;
  }

  return `SELECT [System.Id] FROM WorkItems WHERE ${where} ORDER BY [System.Id]`;
}

/**
 * Executa a WIQL query e retorna a lista de IDs encontrados.
 */
async function queryWorkItemIds({ organization, project, apiVersion, pat, queryConfig, includeRemovedState }) {
  const url = `${baseUrl(organization, project)}/wit/wiql?api-version=${apiVersion}`;
  const wiql = buildWiql(queryConfig, includeRemovedState);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: buildAuthHeader(pat),
    },
    body: JSON.stringify({ query: wiql }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 401) {
      throw new Error("Seu TOKEN no Azure está vencido, favor gerar um novo.");
    }
    throw new Error(`WIQL query falhou (HTTP ${res.status}): ${body}`);
  }

  const data = await res.json();
  return (data.workItems || []).map((wi) => wi.id);
}

/**
 * Busca os campos detalhados de uma lista de IDs (em lotes de 200, limite da API).
 */
async function getWorkItemsByIds({ organization, project, apiVersion, pat, ids, fields }) {
  if (ids.length === 0) return [];

  const fieldList = Object.values(fields).join(",");
  const chunks = [];
  for (let i = 0; i < ids.length; i += 200) {
    chunks.push(ids.slice(i, i + 200));
  }

  const results = [];
  for (const chunk of chunks) {
    const url = `${baseUrl(organization, project)}/wit/workitems?ids=${chunk.join(",")}&fields=${fieldList}&api-version=${apiVersion}`;
    const res = await fetch(url, {
      headers: { Authorization: buildAuthHeader(pat) },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 401) {
        throw new Error("Seu TOKEN no Azure está vencido, favor gerar um novo.");
      }
      throw new Error(`Busca de work items falhou (HTTP ${res.status}): ${body}`);
    }

    const data = await res.json();
    results.push(...(data.value || []));
  }
  return results;
}

/**
 * Confere quais dos IDs passados realmente existem no Azure (independente de
 * tag/estado/filtro — é uma checagem crua de existência). Usa errorPolicy=Omit
 * pra API simplesmente omitir do resultado os IDs que não existem, em vez de
 * dar erro 404 pro lote inteiro.
 * Devolve um Set<string> com os IDs (normalizados como string) que existem.
 */
async function checkIdsExist({ organization, project, apiVersion, pat, ids }) {
  const uniqueIds = [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))].filter((id) =>
    /^\d+$/.test(id)
  );
  if (uniqueIds.length === 0) return new Set();

  const chunks = [];
  for (let i = 0; i < uniqueIds.length; i += 200) {
    chunks.push(uniqueIds.slice(i, i + 200));
  }

  const found = new Set();
  for (const chunk of chunks) {
    const url = `${baseUrl(organization, project)}/wit/workitems?ids=${chunk.join(
      ","
    )}&errorPolicy=Omit&api-version=${apiVersion}`;
    const res = await fetch(url, {
      headers: { Authorization: buildAuthHeader(pat) },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 401) {
        throw new Error("Seu TOKEN no Azure está vencido, favor gerar um novo.");
      }
      throw new Error(`Checagem de existência de work items falhou (HTTP ${res.status}): ${body}`);
    }

    const data = await res.json();
    for (const wi of data.value || []) {
      // Com errorPolicy=Omit, o Azure DevOps não remove os IDs inválidos do
      // array — ele devolve `null` no lugar deles. Precisamos pular esses.
      if (wi && wi.id !== undefined && wi.id !== null) {
        found.add(String(wi.id));
      }
    }
  }
  return found;
}

/**
 * Fluxo completo: WIQL -> IDs -> detalhes dos work items.
 */
function azureAuthBase(config) {
  const pat = process.env[config.azure.patEnvVar];
  if (!pat) {
    throw new Error(
      `Variável de ambiente ${config.azure.patEnvVar} não definida. Exporte seu PAT do Azure DevOps antes de rodar (ex: set ${config.azure.patEnvVar}=xxxx no PowerShell, ou defina em um arquivo .env).`
    );
  }

  return {
    organization: config.azure.organization,
    project: config.azure.project,
    apiVersion: config.azure.apiVersion,
    pat,
  };
}

async function fetchWorkItems(config) {
  const base = azureAuthBase(config);
  const includeRemovedState = config.query.includeRemovedState !== false;

  const ids = await queryWorkItemIds({ ...base, queryConfig: config.query, includeRemovedState });
  const items = await getWorkItemsByIds({ ...base, ids, fields: config.fields });
  return items;
}

module.exports = {
  buildWiql,
  queryWorkItemIds,
  getWorkItemsByIds,
  checkIdsExist,
  fetchWorkItems,
  azureAuthBase,
};
