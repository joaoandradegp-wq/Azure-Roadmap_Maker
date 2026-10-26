<h1 align="center">📊 Azure Roadmap Maker</h1>

<p align="center">
O Azure Roadmap Maker automatiza a geração de roadmaps a partir de Work Items do Azure DevOps e cria apresentações de Status Report em PowerPoint. Permite selecionar produtos, sprints e regras para inclusão de bugs, consultar dados online ou utilizar arquivos JSON locais, facilitando o acompanhamento de demandas, prazos e entregas.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Status-Em%20Evolução-brightgreen">
  <img src="https://img.shields.io/badge/Plataforma-Node.js-green">
  <img src="https://img.shields.io/badge/Fonte-Azure%20DevOps-blue">
  <img src="https://img.shields.io/badge/Saída-PowerPoint-orange">
  <img src="https://img.shields.io/badge/Idioma-PT--BR-purple">
</p>

---

### ✨ Funcionalidades

<table style="border: none; border-collapse: collapse;">
<tr>
<td width="50%" valign="top" style="border: none; padding: 15px;">

#### ☁️ CONEXÃO COM AZURE DEVOPS

Consulta Work Items diretamente no Azure DevOps usando a organização, o projeto e os filtros configurados para cada produto.

<br><br>
</td>
<td width="50%" valign="top" style="border: none; padding: 15px;">

#### 📊 ROADMAP EM POWERPOINT

Gera uma apresentação com a linha do tempo das demandas, prazos e status, dividindo o conteúdo em várias páginas quando necessário.

<br>
</td>
</tr>
<tr>
<td width="50%" valign="top" style="border: none; padding: 15px;">

#### 🎛️ SELEÇÃO DE PRODUTO E SPRINTS

Permite escolher entre `LIVRE`, `FLEET` e `RAC`, além de filtrar uma ou mais sprints para montar o relatório desejado.

<br><br>
</td>
<td width="50%" valign="top" style="border: none; padding: 15px;">

#### 🏷️ FILTRO DE BUGS E TAGS

Permite incluir ou excluir itens com a tag `Bug`. Demandas marcadas como `RASCUNHO` não são exibidas no roadmap.

<br>
</td>
</tr>
<tr>
<td width="50%" valign="top" style="border: none; padding: 15px;">

#### 📴 GERAÇÃO OFFLINE

Utiliza arquivos JSON exportados anteriormente para gerar o relatório sem consultar o Azure DevOps durante a execução.

<br><br>
</td>
<td width="50%" valign="top" style="border: none; padding: 15px;">

#### 🚦 INDICADORES DE STATUS E PRAZO

Organiza as demandas com indicadores visuais de andamento, risco, atraso, pausa e conclusão, facilitando a leitura do relatório.

<br>
</td>
</tr>
</table>

---

### ⚙️ Configuração

<details>
<summary><b>☁️ Conexão com o Azure DevOps</b></summary>
<br>
### 1. Configure o arquivo

Copie `config.example.json` para `config.json` e mantenha a estrutura do arquivo de exemplo.

No bloco `azure`, configure:

| Campo | Descrição |
|---|---|
| `organization` | Nome da organização do Azure DevOps |
| `patEnvVar` | Nome da variável de ambiente que armazenará o token |

O arquivo também deve conter `products.LIVRE`, `products.FLEET` e `products.RAC`. Para cada produto, configure o projeto, o `areaPath`, os tipos de Work Item, as condições adicionais da consulta e o título do relatório.

### 2. Configure o token de acesso

Crie um Personal Access Token (PAT) no Azure DevOps com permissão de leitura de Work Items. Não coloque o token diretamente no `config.json`.

No PowerShell, para usar o token apenas na janela atual:

```powershell
$env:AZURE_DEVOPS_PAT="seu_token_aqui"
```

Para salvar a variável no perfil do Windows:

```powershell
setx AZURE_DEVOPS_PAT "seu_token_aqui"
```

Após usar `setx`, abra um novo terminal. O nome da variável deve corresponder ao valor configurado em `azure.patEnvVar`.

### 3. Execute o programa

```bash
node azure.js
```

</details>

<details>
<summary><b>🏷️ Tags e filtros</b></summary>
<br>
| Tag ou opção | Comportamento |
|---|---|
| `Bug` | Pode ser incluída ou excluída na execução. No modo online, a consulta do produto precisa permitir esse filtro. |
| `RASCUNHO` | Itens com essa tag não aparecem no roadmap. |

A opção de incluir bugs remove da condição configurada a exclusão específica da tag `Bug`.

</details>

---

### 📴 Modo Offline

Use arquivos JSON exportados anteriormente para gerar o relatório sem consultar o Azure DevOps.

| Produto | Arquivo |
|---|---|
| `LIVRE` | `data/workitems-LIVRE.json` |
| `FLEET` | `data/workitems-FLEET.json` |
| `RAC` | `data/workitems-RAC.json` |

O JSON pode ser uma lista de Work Items ou um objeto com a propriedade `value` contendo a lista. Cada item precisa ter a propriedade `fields`, incluindo os campos utilizados pelo roadmap, como tags e informações de sprint.

> ⚠️ Para incluir bugs no modo offline, o JSON precisa conter os itens com a tag `Bug`. Os dados locais não são atualizados automaticamente.

### 🎛️ Opções de Execução

| Opção | Descrição |
|---|---|
| `--offline` | Lê os Work Items de um arquivo JSON local |
| `--produto=LIVRE` | Seleciona o produto |
| `--sprints=9,10` | Filtra uma ou mais sprints |
| `--bugs` | Inclui itens com tag `Bug` |
| `--sem-bugs` | Exclui itens com tag `Bug` |
| `--no-render` | Gera o JSON sem chamar o renderizador do PowerPoint |

Quando as opções não são informadas por parâmetro, o programa solicita as escolhas durante a execução. Se não encontrar sprints numeradas nos dados, utiliza todos os itens sem filtro de sprint.

---

### 🚦 Legenda do Roadmap

<table>
<tr><th>Status da demanda</th><th>Significado</th></tr>
<tr><td>⚪ <b>Não iniciado</b></td><td>Demanda ainda não iniciada</td></tr>
<tr><td>🟢 <b>No prazo</b></td><td>Dentro do prazo previsto</td></tr>
<tr><td>🟡 <b>Risco de atraso</b></td><td>Demanda sinalizada como risco</td></tr>
<tr><td>🔴 <b>Atraso</b></td><td>Previsão vencida ou entrega atrasada</td></tr>
<tr><td>🟠 <b>Pausado</b></td><td>Demanda pausada</td></tr>
</table>

<table>
<tr><th>Status da entrega</th><th>Significado</th></tr>
<tr><td>⚪ <b>Previsão</b></td><td>Demanda aberta com previsão</td></tr>
<tr><td>🟢 <b>Concluída no prazo</b></td><td>Entrega até a data prevista</td></tr>
<tr><td>🟠 <b>Concluída com atraso</b></td><td>Entrega após a data prevista</td></tr>
</table>

---

### 📅 Regras de Datas

- 🚀 Deploys são planejados para terças e quintas-feiras, evitando a última semana do mês.
- ⏳ Previsões vencidas de demandas ainda abertas são movidas para uma próxima data prevista.
- 📑 A apresentação é dividida automaticamente em várias páginas quando necessário.

---

### 🛠 Tecnologias

<ul>
  <li>Node.js</li>
  <li>JavaScript</li>
  <li>Azure DevOps REST API</li>
  <li>WIQL</li>
  <li>PowerPoint / PPTX</li>
  <li>JSON</li>
  <li>Regex</li>
</ul>

---

<p align="center">
Feito para facilitar a criação de roadmaps e o acompanhamento de prazos, sprints e entregas. 🚀
</p>
