<h1 align="center">📊 Azure Roadmap Maker</h1>

<p align="center">
Gerador automático de <b>One Page Status Report</b> a partir do Azure DevOps, transformando Work Items em um roadmap visual e gerando apresentações PowerPoint automaticamente.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Status-Em%20Evolução-brightgreen">
  <img src="https://img.shields.io/badge/Linguagem-Node.js-green">
  <img src="https://img.shields.io/badge/Azure%20DevOps-API-blue">
  <img src="https://img.shields.io/badge/Output-PowerPoint-orange">
  <img src="https://img.shields.io/badge/Language-PT--BR-lightgrey">
</p>

---

<h2>📌 Sobre</h2>

<p>
O <b>Status Report Generator</b> é uma ferramenta desenvolvida para automatizar a criação de <b>One Page Status Reports</b> a partir dos dados existentes no <b>Azure DevOps</b>.
</p>

<p>
O sistema consulta automaticamente os Work Items utilizando a API do Azure DevOps, aplica as regras de negócio configuradas, transforma os dados em uma estrutura de roadmap e, por fim, gera uma apresentação <b>PowerPoint (.pptx)</b> pronta para utilização em reuniões de acompanhamento.
</p>

<p>
A arquitetura foi construída de forma modular, permitindo que a etapa de coleta de dados seja executada separadamente da etapa de geração da apresentação. Dessa forma, o arquivo <b>roadmap.json</b> funciona como uma camada intermediária entre o Azure DevOps e o PowerPoint.
</p>
<p align="center">
  <b>Azure DevOps → WIQL → Work Items → roadmap.json → PowerPoint</b>
</p>

---

<h2>🔄 Funcionamento</h2>

<pre>
                    Azure DevOps
                         │
                         ▼
                     azure.js
                         │
                    WIQL / API
                         │
                         ▼
                  Work Items
                         │
                         ▼
                 transform.js
                         │
                         ▼
                  roadmap.json
                         │
                         ▼
                    render.js
                         │
                         ▼
              status_report.pptx
</pre>

<p>
O fluxo pode ser executado completamente de forma automática ou utilizar um <b>roadmap.json</b> previamente gerado/editado para testes e validações.
</p>

---

<h2>🚀 Principais funcionalidades</h2>

<ul>
  <li>☁️ Consulta automática de Work Items no Azure DevOps</li>
  <li>🔎 Utilização de WIQL para filtragem dos dados</li>
  <li>🧩 Transformação dos Work Items em estrutura de roadmap</li>
  <li>📊 Geração automática de apresentação PowerPoint</li>
  <li>📅 Cálculo automático de períodos e sprints</li>
  <li>🚀 Cálculo de datas de deploy</li>
  <li>📈 Barras Gantt proporcionais às datas reais</li>
  <li>🟢 Identificação de entregas realizadas no prazo</li>
  <li>🟠 Identificação de entregas realizadas com atraso</li>
  <li>⚪ Identificação de itens em previsão</li>
  <li>🔴 Identificação visual de riscos e atrasos</li>
  <li>🏷️ Suporte a regras baseadas em Tags e States</li>
  <li>📑 Geração automática de múltiplas páginas no PowerPoint</li>
  <li>🧪 Testes offline sem necessidade de acesso ao Azure DevOps</li>
  <li>⚙️ Configuração através de arquivo JSON</li>
</ul>

---

<h2>📂 Estrutura do projeto</h2>

<pre>
StatusReport/
│
├── config.example.json
├── config.json
│
├── azure.js
├── render.js
│
├── lib/
│   ├── azureClient.js
│   ├── transform.js
│   └── period.js
│
├── fixtures/
│   ├── mock-workitems.json
│   └── test-transform.js
│
├── data/
│   └── roadmap.json
│
└── output/
    └── status_report.pptx
</pre>

---

<h2>🧩 Componentes</h2>

<h3>☁️ azure.js</h3>

<p>
Responsável pela comunicação com o <b>Azure DevOps</b>.
</p>

<p>
O script executa a WIQL configurada, recupera os IDs dos Work Items e consulta os dados necessários através da API. Ao final, gera o arquivo <b>data/roadmap.json</b>.
</p>

<ul>
  <li>🔎 Execução de WIQL</li>
  <li>☁️ Consulta à API do Azure DevOps</li>
  <li>📋 Recuperação dos Work Items</li>
  <li>⚙️ Aplicação dos filtros configurados</li>
  <li>📄 Geração do roadmap.json</li>
</ul>

<h3>🔄 lib/azureClient.js</h3>

<p>
Centraliza as chamadas à API do Azure DevOps, incluindo a execução da WIQL e a consulta dos Work Items encontrados.
</p>

<h3>🧠 lib/transform.js</h3>

<p>
Responsável pela transformação dos Work Items retornados pelo Azure DevOps para a estrutura utilizada pelo roadmap.
</p>

<p>
É neste módulo que estão concentradas as principais regras de negócio do relatório, incluindo sprint, deploy, Gantt, status, previsão e filtros.
</p>

<h3>📅 lib/period.js</h3>

<p>
Responsável pela geração e pelo mapeamento dos períodos quinzenais utilizados na timeline do roadmap.
</p>

<h3>📊 render.js</h3>

<p>
Responsável por ler o <b>roadmap.json</b> e gerar a apresentação <b>status_report.pptx</b>.
</p>

<p>
Quando a quantidade de itens ultrapassa o espaço disponível em uma página, o sistema divide automaticamente o roadmap em múltiplas páginas, mantendo cabeçalho, legenda e grade em cada uma.
</p>

---

<h2>⚙️ Configuração</h2>

<p>
A configuração principal é realizada através do arquivo <b>config.json</b>.
</p>

<p>
Para iniciar, copie o arquivo de exemplo:
</p>

<pre>
cp config.example.json config.json
</pre>

<p>
Os principais parâmetros disponíveis são:
</p>

<ul>
  <li><b>azure.organization</b> — organização do Azure DevOps</li>
  <li><b>azure.project</b> — projeto do Azure DevOps</li>
  <li><b>azure.patEnvVar</b> — variável de ambiente que contém o PAT</li>
  <li><b>query.workItemTypes</b> — tipos de Work Item que serão consultados</li>
  <li><b>query.areaPath</b> — Area Path utilizada como filtro</li>
  <li><b>query.extraWiqlWhere</b> — condições adicionais da WIQL</li>
  <li><b>fields.*</b> — campos do Azure utilizados pelo sistema</li>
  <li><b>statusMapping.byState</b> — mapeamento de status por State</li>
  <li><b>statusMapping.byTag</b> — mapeamento de status por Tag</li>
  <li><b>timeline.monthsBack</b> — quantidade de meses anteriores</li>
  <li><b>timeline.monthsForward</b> — quantidade de meses posteriores</li>
  <li><b>sprintCadence</b> — configuração da cadência das sprints</li>
  <li><b>project.title</b> — título do relatório</li>
  <li><b>project.squad</b> — squad apresentado no cabeçalho</li>
</ul>

<p>
O campo <b>query.extraWiqlWhere</b> deve conter somente as condições adicionais. O sistema adiciona automaticamente o operador <b>AND</b>, portanto o valor não deve começar com <b>AND</b>.
</p>

---

<h2>🔐 Azure DevOps PAT</h2>

<p>
Para acessar os Work Items, o sistema utiliza um <b>Personal Access Token (PAT)</b> do Azure DevOps.
</p>

<p>
O token não deve ser armazenado diretamente no <b>config.json</b>. Ele deve ser disponibilizado através de uma variável de ambiente.
</p>

<p>
O escopo mínimo necessário é:
</p>

<ul>
  <li>📋 Work Items — Read</li>
</ul>

<h3>Windows PowerShell</h3>

<pre>
$env:AZURE_DEVOPS_PAT="seu_token_aqui"
</pre>

<p>
Para salvar permanentemente no perfil:
</p>

<pre>
setx AZURE_DEVOPS_PAT "seu_token_aqui"
</pre>

<h3>Linux / macOS</h3>

<pre>
export AZURE_DEVOPS_PAT=seu_token_aqui
</pre>

---

<h2>🚀 Execução</h2>

<p>
O processo completo possui duas etapas principais.
</p>

<h3>1️⃣ Buscar dados do Azure DevOps</h3>

<pre>
node azure.js
</pre>

<p>
O comando consulta o Azure DevOps e gera:
</p>

<pre>
data/roadmap.json
</pre>

<h3>2️⃣ Gerar o PowerPoint</h3>

<pre>
node render.js
</pre>

<p>
O resultado será criado em:
</p>

<pre>
output/status_report.pptx
</pre>

<h3>📁 Utilizando caminhos personalizados</h3>

<pre>
node azure.js config.json data/roadmap.json

node render.js data/roadmap.json output/status_report.pptx
</pre>

---

<h2>🧪 Testes Offline</h2>

<p>
O projeto possui uma estrutura para testar as regras de transformação sem precisar acessar o Azure DevOps.
</p>

<pre>
node fixtures/test-transform.js
</pre>

<p>
O teste utiliza uma resposta simulada da API localizada em:
</p>

<pre>
fixtures/mock-workitems.json
</pre>

<p>
Dessa forma é possível validar as regras do <b>transform.js</b> sem necessidade de PAT, conexão com o Azure DevOps ou acesso à rede.
</p>

<p>
Os testes possuem asserções para validar as principais regras de negócio. Quando uma regra for alterada no código, os testes devem ser atualizados juntamente com ela.
</p>

---

<h2>🏃 Sprints e Deploys</h2>

<p>
O sistema possui regras próprias para interpretar as sprints e calcular as respectivas datas de entrega.
</p>

<ul>
  <li>🏃 Número da sprint extraído do <b>Iteration Path</b></li>
  <li>🔎 Busca alternativa da sprint no título do Work Item</li>
  <li>🏷️ Formatação automática do título como <b>SP09 - Nome do Card</b></li>
  <li>📅 Datas calculadas através da cadência configurada</li>
  <li>🚀 Deploys permitidos somente às <b>terças e quintas-feiras</b></li>
  <li>📆 Deploys não são planejados para a última semana do mês</li>
  <li>➡️ Datas nessa janela são automaticamente transferidas para o próximo mês</li>
</ul>

<p>
As datas das sprints não são obtidas diretamente dos campos de data dos Work Items. Elas são calculadas a partir de uma sprint de referência configurada em <b>sprintCadence</b>.
</p>

---

<h2>📊 Barra Gantt</h2>

<p>
A barra Gantt representa visualmente o período de execução de cada Work Item dentro da timeline.
</p>

<ul>
  <li>📅 Início = início calculado da sprint</li>
  <li>🚀 Item fechado = data real de deploy</li>
  <li>🔮 Item aberto = data prevista de deploy</li>
  <li>📈 Posicionamento proporcional ao dia dentro da quinzena</li>
</ul>

<p>
A posição horizontal não utiliza somente a célula da quinzena. O sistema calcula a posição proporcional ao dia exato, permitindo diferenciar, por exemplo, dois itens encerrados em dias diferentes dentro da mesma quinzena.
</p>

---

<h2>🔧 Correção da data de fechamento</h2>

<p>
O <b>ClosedDate</b> do Azure DevOps nem sempre representa o momento real do deploy.
</p>

<p>
Quando o Work Item é fechado no dia seguinte ao deploy, o sistema verifica se o dia anterior era uma terça ou quinta-feira. Caso seja, assume essa data anterior como a data real da entrega.
</p>

<p>
A correção é limitada a apenas <b>um dia para trás</b>.
</p>

<p>
Além disso, todas as datas recebidas do Azure passam por normalização antes das comparações, removendo o horário para evitar diferenças causadas por timestamps.
</p>

---

<h2>🚦 Status de Entrega</h2>

<p>
O ícone apresentado no final da barra Gantt representa a situação da entrega.
</p>

<ul>
  <li>⚪ <b>Previsão</b> — item ainda aberto</li>
  <li>🟢 <b>Concluída no prazo</b> — entregue até a data prevista</li>
  <li>🟠 <b>Concluída com atraso</b> — entregue depois da data prevista</li>
</ul>

<p>
Quando uma entrega ocorre com atraso, o relatório apresenta a data originalmente esperada riscada e, em seguida, a data real do deploy.
</p>

---

<h2>🔮 Previsões</h2>

<p>
Itens abertos nunca permanecem posicionados em uma data de deploy que já passou.
</p>

<ul>
  <li>➡️ A previsão vencida é transferida para o próximo dia de deploy</li>
  <li>⏳ Itens <b>Não iniciados</b> avançam mais um ciclo</li>
  <li>📅 Itens em andamento exibem somente a nova previsão</li>
  <li>✖️ Para itens não iniciados, a data intermediária pode ser exibida riscada</li>
</ul>

<p>
Essa regra evita que um item que ainda não começou seja apresentado como se estivesse prestes a ser entregue imediatamente após o vencimento de sua previsão original.
</p>

---

<h2>🟢 Status de Fase</h2>

<p>
O status visual da coluna <b>Status</b> é definido através do <b>statusMapping</b> configurado no <b>config.json</b>.
</p>

<p>
A prioridade de avaliação é:
</p>

<ol>
  <li>🏷️ Tags</li>
  <li>📋 State</li>
  <li>🚨 Regra final de atraso</li>
</ol>

<p>
Tags possuem prioridade sobre o State. Alguns exemplos:
</p>

<ul>
  <li><b>Pausado</b> → pausado</li>
  <li><b>Risco</b> → risco</li>
  <li><b>Bloqueado / Blocked</b> → atraso</li>
  <li><b>New</b> → não iniciado</li>
  <li><b>Active</b> → no prazo</li>
</ul>

<p>
Existe ainda uma sobrescrita final: itens entregues depois do previsto ou itens abertos com previsão vencida passam para <b>atraso</b>.
</p>

<p>
A exceção são os itens com tag <b>Pausado</b>, que permanecem como pausados mesmo quando a sprint está vencida.
</p>

---

<h2>🚫 Itens ignorados</h2>

<p>
Alguns Work Items são propositalmente excluídos do relatório.
</p>

<ul>
  <li>🚫 Itens com Tag <b>Bug</b></li>
  <li>🚫 Itens com Tag <b>RASCUNHO</b></li>
  <li>🚫 Itens fora da janela configurada da timeline</li>
</ul>

<p>
Os filtros são aplicados em duas camadas. Primeiro na WIQL, reduzindo a quantidade de dados trafegados, e novamente no <b>transform.js</b> como camada adicional de proteção.
</p>

---

<h2>🔤 Ordenação</h2>

<p>
A lista final é ordenada alfabeticamente pelo título exibido.
</p>

<p>
Como o título pode receber o prefixo da sprint, a ordenação também acaba agrupando os itens por sprint.
</p>

<pre>
SP09 - Card A
SP09 - Card B
SP10 - Card A
SP10 - Card C
</pre>

---

<h2>📑 Múltiplas páginas</h2>

<p>
Quando o número de itens ultrapassa a quantidade que cabe em uma única página, o <b>render.js</b> divide automaticamente o roadmap em várias páginas do PowerPoint.
</p>

<p>
Cada página mantém:
</p>

<ul>
  <li>📌 Cabeçalho</li>
  <li>📊 Legenda</li>
  <li>📅 Grade da timeline</li>
  <li>📈 Roadmap</li>
</ul>

<p>
O título recebe automaticamente a identificação da página:

</p>

<pre>
(1/N)
(2/N)
(3/N)
</pre>

---

<h2>⚠️ Limitações conhecidas</h2>

<h3>📈 Replanejamentos</h3>

<p>
A barra Gantt não representa o histórico completo de replanejamentos.
</p>

<p>
O Azure DevOps fornece o estado atual do Work Item nessa consulta. Portanto, quando um card muda de sprint diversas vezes, o relatório representa a sprint atual, e não todo o histórico percorrido pelo item.
</p>

<h3>📅 Virada de ano</h3>

<p>
Quando a janela configurada atravessa a virada do ano, os meses aparecem corretamente na timeline. Entretanto, o rótulo do ano no cabeçalho representa o ano do primeiro mês da janela.
</p>

<h3>🏊 Swimlane x Tag</h3>

<p>
A <b>Swimlane</b> do Azure DevOps é diferente de uma Tag.
</p>

<p>
O filtro:

</p>

<pre>
[System.BoardLane] = 'LIVRE'
</pre>

<p>
verifica a Swimlane configurada no Board e não uma Tag chamada <b>Livre</b>.
</p>

<p>
Portanto, um card pode possuir a Tag <b>Livre</b> e ainda assim não pertencer à Swimlane <b>LIVRE</b>.
</p>

---

<h2>🛠 Tecnologias</h2>

<ul>
  <li>Node.js</li>
  <li>JavaScript</li>
  <li>Azure DevOps REST API</li>
  <li>WIQL</li>
  <li>PowerPoint / PPTX</li>
  <li>JSON</li>
  <li>Regex</li>
  <li>Automação de processos</li>
</ul>

---

<h2>🔮 Próximos passos</h2>

<ul>
  <li>⏰ Automatizar a execução através de agendamento</li>
  <li>📅 Executar automaticamente antes das reuniões de status</li>
  <li>📜 Implementar timeline histórica através da API de revisions</li>
  <li>📊 Criar resumo executivo automático</li>
  <li>📈 Apresentar percentual de conclusão da sprint</li>
  <li>🚨 Destacar automaticamente itens críticos</li>
</ul>

---

<h2>📊 Resultado</h2>

<p align="center">
  <b>Azure DevOps</b>
  <br>
  ↓
  <br>
  <b>Work Items</b>
  <br>
  ↓
  <br>
  <b>Regras de negócio</b>
  <br>
  ↓
  <br>
  <b>Roadmap</b>
  <br>
  ↓
  <br>
  <b>One Page Status Report</b>
</p>

---

<p align="center">
<b>Status Report Generator</b> transforma os dados do Azure DevOps em uma visão visual e automatizada do andamento das entregas, reduzindo o trabalho manual na preparação de status reports e garantindo que as regras de sprint, deploy, prazo e risco sejam aplicadas de forma consistente.
</p>
