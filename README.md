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
- `query.workItemTypes` — tipos de work item a buscar (ex: `["Feature", "User Story"]`).
- `query.areaPath` — filtra por Area Path.
- `query.extraWiqlWhere` — condições extras da WIQL, coladas com `AND` automaticamente pelo código. **Nunca comece essa string com `AND`** — o `azure.js` já adiciona esse operador; começar com `AND` gera uma WIQL inválida (erro HTTP 400 "Expecting comparison operator").
- `fields.*` — nomes dos campos do Azure usados. Os padrões cobrem `StartDate`/`TargetDate`/`ClosedDate` nativos do processo Agile/Scrum. Se seu processo usa campos customizados, ajuste aqui.
- `statusMapping.byState` / `statusMapping.byTag` — ver seção "Status de fase" abaixo.
- `timeline.monthsBack` / `monthsForward` — quantos meses antes/depois de hoje aparecem no roadmap (mês atual sempre conta como +1). Ex: `monthsBack: 2, monthsForward: 3` = 6 meses no total.
- `sprintCadence` — ver seção "Sprints e datas de deploy" abaixo.
- `project.title` / `project.squad` — texto do cabeçalho do slide (`[Squad {squad}] – {title}`).

## 2. Gerar um PAT no Azure DevOps

Azure DevOps → ícone de usuário → **Personal Access Tokens** → **New Token**.
Escopo mínimo necessário: **Work Items (Read)**.

```bash
export AZURE_DEVOPS_PAT=seu_token_aqui       # Linux/Mac
$env:AZURE_DEVOPS_PAT="seu_token_aqui"       # PowerShell (Windows) — só vale pra essa sessão
setx AZURE_DEVOPS_PAT "seu_token_aqui"       # PowerShell (Windows) — salva permanente no perfil
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
da API) e imprime o `roadmap.json` resultante, sem precisar de PAT nem rede. Cobre
(com asserções) todas as regras de negócio descritas abaixo — se alguma regra for
alterada no código, os testes aqui devem ser atualizados junto.

---

## Regras de negócio (o que o `transform.js` faz, em detalhe)

Esta seção documenta **todo comportamento que não é óbvio olhando só pro código** —
o "porquê" por trás de cada decisão, pra quem for mexer depois não reintroduzir os
mesmos bugs que já foram corrigidos ao longo do desenvolvimento.

### Sprints e datas de deploy

- **Número da sprint**: extraído com a regex `Sprint\s*0*(\d+)` — primeiro tentando
  no **Iteration Path** do item, e se não achar, procurando o mesmo padrão dentro do
  **texto do título** (alguns cards têm "Sprint 09 - Livre e Fleet -" digitado
  manualmente no título, sem a Iteration Path bater). Quando encontrado no título,
  esse prefixo é removido do texto e recolocado formatado (`SP09 - Nome do card`).
  Item sem sprint reconhecível em nenhum dos dois lugares fica só com o nome do card.
- **Datas de início/fim de cada sprint**: calculadas por cadência fixa a partir de
  `config.sprintCadence` (uma sprint de referência com número + data de início/fim
  conhecidas; todas as outras são `referência ± N × cadenceDays`). **Não vêm de
  nenhum campo de data do work item** — são inteiramente derivadas do número da
  sprint.
- **Dias fixos de deploy**: só terça e quinta-feira. Qualquer data "de deploy"
  calculada no sistema (previsão, data real de entrega, etc.) é sempre ajustada pra
  cair numa dessas — nunca aparece uma sexta ou um sábado como data de entrega.
- **Não tem deploy na última semana do mês.** Se o cálculo de uma data de deploy
  cair nos últimos 7 dias do mês (ex: dias 25-31 de um mês de 31 dias), o sistema
  recalcula automaticamente para a **primeira terça ou quinta-feira do mês
  seguinte**. Essa regra está embutida dentro da própria função `nextDeployDate` —
  vale pra toda e qualquer data de deploy calculada no sistema, não só um caso
  específico.

### Barra do Gantt (início/fim)

- **Início da barra** = início da sprint do item (aproximação de "quando entrou na
  sprint" — o Azure não expõe a data exata sem consultar o histórico de revisões
  do work item).
- **Fim da barra**:
  - Item **fechado**: a data de deploy real, calculada a partir do `ClosedDate` (ver
    "Correção de defasagem de fechamento" abaixo) — **não** o `ClosedDate` cru.
  - Item **aberto**: a data de deploy prevista (fim da sprint, ajustado pra
    terça/quinta e pra nunca cair na última semana do mês) — ou, se essa previsão já
    passou, a data empurrada pra frente (ver "Previsão" abaixo).
- **Posição dentro da quinzena**: a barra (e a linha de "hoje") não fica só grudada
  na borda da célula de 15 dias — a posição horizontal é proporcional ao dia exato
  dentro da quinzena (dia 1 = borda esquerda, dia 15 = borda direita). Isso é
  necessário pra dois itens que terminam em dias diferentes dentro da mesma
  quinzena (ex: fechado dia 04 vs dia 11, ambos em "Agosto 1-15") não desenharem a
  barra terminando no mesmo lugar.
- Sem sprint reconhecível: cai no fallback dos campos `plannedStart`/`plannedEnd`/
  `actualStart` de `fields`.

### Correção de defasagem de fechamento (`deployDateForClosure`)

O `ClosedDate` do Azure frequentemente não é o dia real do deploy — é comum alguém
mover o card pra "Closed" na manhã seguinte ao deploy de verdade. Regra: se o dia
**anterior** ao `ClosedDate` já é dia de deploy (terça ou quinta), assume que foi
entregue nesse dia anterior — não avança pra próxima janela. Só corrige 1 dia pra
trás; qualquer defasagem maior é tratada como fechamento de fato fora do dia de
deploy.

Junto disso, toda data crua do Azure passa por `stripTime` antes de qualquer
comparação — o `ClosedDate` vem com hora dentro (ex: `2026-08-11T14:32:00Z`), e sem
remover isso, "11/08 14:32" comparava como "depois de" "11/08 00:00", mesmo sendo o
mesmo dia, causando classificações erradas de atraso.

### Status de entrega (ícone no fim da barra)

Calculado comparando as **datas de deploy já corrigidas** (não os campos de data
crus do Azure):

- **Previsão** (ícone cinza): item ainda aberto.
- **Concluída no prazo** (verde): fechou até a data de deploy prevista (fim da
  sprint, ajustada).
- **Concluída com atraso** (laranja): fechou depois — mostra a data que era
  esperada riscada, seguida da data real de deploy.

### Previsão que já passou (item ainda aberto)

Um item aberto nunca mostra (nem posiciona a barra em) uma data de deploy que já
ficou no passado:

- Se a previsão original (fim da sprint) já passou, empurra pro **próximo dia de
  deploy a partir de hoje**.
- Se o item está **"Não iniciado"** e caiu nesse caso, pula **mais um ciclo** — usa
  o deploy seguinte a esse, não o imediato (não faz sentido prometer que algo que
  nem começou sai depois de amanhã). Nesse caso específico, mostra a data
  intermediária riscada (a que valeria sem esse pulo extra) seguida da nova.
- Para os demais itens abertos (que já estão em andamento) cuja previsão só
  avançou por conta da passagem do tempo, mostra **só a data nova, sem riscado** —
  riscar aqui sugeriria erroneamente que o item já deveria ter sido entregue antes,
  quando isso é só a previsão sendo atualizada.

### Status de fase (bolinha na coluna "Status" e na legenda)

Vem de `statusMapping` no `config.json`, com esta ordem de prioridade:

1. **Tag** (`statusMapping.byTag`) — checada primeiro, tem prioridade sobre o State.
   Ex: tag `"Pausado"` → `pausado`; tag `"Risco"` → `risco`; tags `"Bloqueado"`/
   `"Blocked"` → `atraso`.
2. **State** (`statusMapping.byState`) — ex: `"New"` → `naoIniciado`, `"Active"` →
   `noPrazo`, um State customizado tipo `"Aguardando retorno/confirmação"` →
   `risco`.
3. **Sobrescrita final — "não entregue na sprint" → `atraso`**: independente do que
   os dois passos acima deram, se o item **fechou depois do previsto** (Concluída
   com atraso) OU está **aberto com a previsão já vencida**, a bolinha vira
   vermelha (`atraso`) — com uma exceção: itens com tag `"Pausado"` nunca são
   sobrescritos (ficam laranja mesmo com a sprint vencida, já que pausado é uma
   decisão deliberada, não um atraso).

### Itens ignorados (nunca entram no relatório)

- Tag **"Bug"** ou tag **"RASCUNHO"** (case-insensitive) — filtrado tanto na WIQL
  (`query.extraWiqlWhere`, reduz volume trafegado) quanto de novo dentro do
  `transform.js` como segunda camada de proteção.
- Itens cuja sprint (início e fim) não toca a janela `monthsBack`/`monthsForward` —
  descartados, não "espremidos" na borda do gráfico.

### Ordenação e paginação

- A lista final é ordenada **alfabeticamente** pelo título exibido (incluindo o
  prefixo `SPxx`) — na prática agrupa por sprint (SP09 antes de SP10) e alfabético
  dentro de cada uma.
- `render.js` divide automaticamente em **várias páginas do PPTX** quando o
  roadmap tem mais linhas do que cabem numa página só, repetindo cabeçalho/legenda/
  grade em cada uma, com "(1/N)", "(2/N)" etc no título.

---

## Limitações conhecidas

**Barra Gantt não reflete replanejamentos no meio do caminho.** O Azure não guarda
"por onde o item passou" — só o estado atual — então se um card mudou de sprint
mais de uma vez, isso não aparece na barra, só no resultado final (data de início =
sprint atual, ícone final = como fechou).

**Ano único no cabeçalho da grade.** Se a janela (`monthsBack`/`monthsForward`)
cruzar a virada do ano, os meses do ano seguinte aparecem certos na grade, mas o
rótulo de "2026" acima mostra só o ano do primeiro mês da janela.

**Swimlane vs. tag são coisas diferentes no Azure.** O filtro `[System.BoardLane] =
'LIVRE'` verifica a swimlane do board (visual, configurada em Board Settings →
Swimlanes) — não é o mesmo campo que uma tag chamada "Livre". Um card pode ter a
tag sem estar de fato naquela swimlane, e nesse caso a WIQL não retorna o item
(ele nunca chega a aparecer no roadmap.json, independente do `transform.js`).

## Próximos passos sugeridos

- Automatizar a execução (ex: agendador rodando `node azure.js && node render.js`
  toda segunda de manhã, ou antes da reunião de status).
- Timeline histórica real via API de revisions (ver limitação acima).
- Resumo executivo gerado a partir do `summary` (texto automático tipo
  "Sprint com X% concluído, N itens críticos").
