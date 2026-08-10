# Status Report Generator

Gera o slide de roadmap (One Page Status Report) automaticamente a partir do Azure DevOps.

```
Azure DevOps  →  data/roadmap.json  →  status_report.pptx
   (azure.js)         │                    (render.js)
                       └── ou editado/gerado manualmente para testes
```

## Estrutura

```
StatusReport/
├── config.example.json   # copie para config.json e ajuste
├── azure.js               # busca work items no Azure e gera data/roadmap.json
├── render.js               # lê data/roadmap.json e gera o .pptx
├── lib/
│   ├── azureClient.js      # chamadas WIQL + Work Items da API do Azure DevOps
│   ├── transform.js        # converte work items -> estrutura roadmap.json
│   └── period.js            # geração e mapeamento de períodos quinzenais
├── fixtures/
│   ├── mock-workitems.json  # exemplo de resposta da API, para testar sem Azure
│   └── test-transform.js    # testa lib/transform.js offline
├── data/roadmap.json        # saída do azure.js / entrada do render.js
└── output/status_report.pptx
```

## 1. Configurar

```bash
cp config.example.json config.json
```

Edite `config.json`:

- `azure.organization` / `azure.project` — nome da sua org e projeto no Azure DevOps.
- `azure.patEnvVar` — nome da variável de ambiente que vai guardar o PAT (não coloque o token no arquivo).
- `query.workItemTypes` — tipos de work item a buscar (ex: `["Feature"]`).
- `query.areaPath` — opcional, filtra por Area Path.
- `fields.*` — nomes dos campos do Azure. Os padrões cobrem `StartDate`/`TargetDate`/`ClosedDate` nativos do processo Agile/Scrum. **Se seu processo usa campos customizados para datas planejadas, ajuste aqui.**
- `statusMapping.byState` — mapeia o `System.State` do Azure para o status de fase (`naoIniciado`, `noPrazo`, `risco`, `atraso`, `pausado` — as mesmas 5 categorias da legenda "Status – Fase" do slide). Ajuste para os estados reais do seu board.
- `statusMapping.byTag` — tags que forçam um status de fase (ex: tag `"Bloqueado"` sempre vira `atraso`, mesmo que o State ainda esteja `Active`). Tem prioridade sobre `byState`.
- `timeline.monthsBack` / `monthsForward` — quantos meses antes/depois de hoje aparecem no roadmap. O ano, os meses, a divisão em quinzenas (com os dias reais de cada mês) e a linha vermelha de "hoje" são todos calculados automaticamente a cada execução — nada disso precisa ser editado à mão.
- `project.title` / `project.squad` — texto do cabeçalho do slide (`[Squad {squad}] – {title}`).

O nome de cada linha no slide ("Entrega/Fase") é montado automaticamente como `SPXX - Nome do Card`, procurando o padrão "Sprint N" dentro do Iteration Path (ex: `...\Sprint 09 - Livre e Fleet` vira `SP09`). Itens sem sprint numerada reconhecível (Iteration Path na raiz do projeto) ficam só com o nome do card, sem prefixo.

**As datas de início/fim de cada barra vêm da sprint, não dos campos de data do work item.** Configuração em `sprintCadence`: dada uma sprint de referência (número + data de início/fim), o script calcula a data de qualquer outra sprint — pra frente e pra trás — assumindo cadência fixa (`cadenceDays`, padrão 14 dias entre início de sprints consecutivas). Pra um item:
- **Início da barra** = início da sprint que ele está (aproximação de "quando entrou na sprint" — o Azure não expõe essa data exata sem consultar o histórico de revisões).
- **Fim da barra** = `ClosedDate` se o item já foi concluído; senão, o fim da sprint (a previsão).

Se o Iteration Path do item não tiver um número de sprint reconhecível, cai no fallback antigo: usa os campos `plannedStart`/`plannedEnd`/`actualStart` de `fields`.

**A linha vermelha de "hoje"** agora se posiciona proporcionalmente dentro da quinzena (dia 10 de uma faixa 1-15 fica mais à direita que o dia 2), não mais sempre grudada no início da célula.

O ícone no fim de cada barra (Previsão / Concluída no prazo / Concluída com atraso) é calculado comparando a `ClosedDate` com a `TargetDate` do item — não precisa configurar isso à mão. As datas planejada/real ao lado do ícone (como no seu slide original) **não são geradas por enquanto** — ficou de fora nesta primeira versão; se depois você quiser mostrá-las, é só me avisar de qual campo do Azure puxar cada uma.

## 2. Gerar um PAT no Azure DevOps

Azure DevOps → ícone de usuário → **Personal Access Tokens** → **New Token**.
Escopo mínimo necessário: **Work Items (Read)**.

```bash
export AZURE_DEVOPS_PAT=seu_token_aqui
```

## 3. Rodar

```bash
node azure.js                  # busca no Azure, gera data/roadmap.json
node render.js                 # lê data/roadmap.json, gera output/status_report.pptx
```

Ou com caminhos customizados:

```bash
node azure.js config.json data/roadmap.json
node render.js data/roadmap.json output/status_report.pptx
```

## Testar sem acesso ao Azure

```bash
node fixtures/test-transform.js
```

Roda `lib/transform.js` contra `fixtures/mock-workitems.json` (uma resposta simulada
da API) e imprime o `roadmap.json` resultante, sem precisar de PAT nem rede. Útil para
validar o mapeamento de status/tags antes de mexer na config real.

## Limitações conhecidas

**Barra Gantt não reflete atrasos intermediários.** A barra vai do início (`StartDate`) até o fim (`ClosedDate` se concluído, senão `TargetDate`, senão hoje). O Azure não guarda "por onde a barra passou" — só o estado atual — então se um item foi replanejado no meio do caminho, isso não aparece visualmente na barra, só no ícone final (Previsão / Concluída no prazo / Concluída com atraso).

**Ano único no cabeçalho da grade.** Se a janela (`monthsBack`/`monthsForward`) cruzar a virada do ano, os meses do ano seguinte aparecem certos na grade, mas o rótulo de "2026" acima mostra só o ano do primeiro mês da janela.

**Datas planejada/real por item não são geradas.** Ficou de fora nesta versão, a seu pedido — o render.js já suporta mostrar (`plannedDate`/`actualDate` em cada item), só não populamos a partir do Azure ainda.

## Próximos passos sugeridos

- Automatizar a execução (ex: agendador rodando `node azure.js && node render.js`
  toda segunda de manhã, ou antes da reunião de status).
- Timeline histórica real via API de revisions (ver limitação acima).
- Resumo executivo gerado a partir do `summary` (texto automático tipo
  "Sprint com X% concluído, N itens críticos").
