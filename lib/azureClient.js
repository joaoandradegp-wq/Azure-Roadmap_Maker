function buildAuthHeader(pat) {
  const token = Buffer.from(`:${pat}`).toString("base64");
  return `Basic ${token}`;
}

function baseUrl(org, project) {
  return `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis`;
}

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
    if (res.status === 401) {
      throw new Error(
        "Seu TOKEN no Azure está vencido, favor gerar um novo."
      );
    }
    throw new Error(`WIQL query falhou (HTTP ${res.status}): ${body}`);
  }

  const data = await res.json();
  return (data.workItems || []).map((wi) => wi.id);
}

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
        throw new Error(
          "Seu TOKEN no Azure está vencido, favor gerar um novo."
        );
      }
      throw new Error(`Busca de work items falhou (HTTP ${res.status}): ${body}`);
    }

    const data = await res.json();
    results.push(...(data.value || []));
  }
  return results;
}

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