// lib/azureClient.js
// Client mínimo para Azure DevOps REST API: roda uma WIQL query e busca os
// campos detalhados dos work items retornados.
//
// Requer Node 18+ (usa fetch global). Autenticação via PAT (Personal Access Token)
// com Basic Auth (usuário vazio + PAT como senha), conforme a própria doc do Azure DevOps.

function buildAuthHeader(pat) {
  const token = Buffer.from(`:${pat}`).toString("base64");
  return `Basic ${token}`;
}

function baseUrl(org, project) {
  return `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis`;
}

/**
 * Monta a WIQL a partir da config (tipos de work item, area path, filtro extra).
 */
function buildWiql(queryConfig) {
  const types = queryConfig.workItemTypes || ["Feature"];
  const typeList = types.map((t) => `'${t}'`).join(", ");

  let where = `[System.WorkItemType] IN (${typeList}) AND [System.State] <> 'Removed'`;

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
async function queryWorkItemIds({ organization, project, apiVersion, pat, queryConfig }) {
  const url = `${baseUrl(organization, project)}/wit/wiql?api-version=${apiVersion}`;
  const wiql = buildWiql(queryConfig);

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
      throw new Error(`Busca de work items falhou (HTTP ${res.status}): ${body}`);
    }

    const data = await res.json();
    results.push(...(data.value || []));
  }
  return results;
}

/**
 * Fluxo completo: WIQL -> IDs -> detalhes dos work items.
 */
async function fetchWorkItems(config) {
  const pat = process.env[config.azure.patEnvVar];
  if (!pat) {
    throw new Error(
      `Variável de ambiente ${config.azure.patEnvVar} não definida. Exporte seu PAT do Azure DevOps antes de rodar (ex: export ${config.azure.patEnvVar}=xxxx).`
    );
  }

  const base = {
    organization: config.azure.organization,
    project: config.azure.project,
    apiVersion: config.azure.apiVersion,
    pat,
  };

  const ids = await queryWorkItemIds({ ...base, queryConfig: config.query });
  const items = await getWorkItemsByIds({ ...base, ids, fields: config.fields });
  return items;
}

module.exports = { buildWiql, queryWorkItemIds, getWorkItemsByIds, fetchWorkItems };
