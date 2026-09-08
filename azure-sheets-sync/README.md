# azure-sheets-sync

Sincroniza Work Items do Azure DevOps (tag "Livre") com a planilha local
`Backlog Funil de Vendas - BO + PO.xlsx` (sincronizada via OneDrive),
atualizando as abas **LIVRE Oficial** e **Pró ativos** — sem apagar nada que
já esteja lá.

Reaproveita a autenticação/consulta do projeto `Azure-Roadmap_Maker` (o que
já gera o PowerPoint), só que escrevendo direto no `.xlsx` em vez de gerar
slides.

## 1. Instalação

Precisa de **Node.js 18 ou mais novo**.

```bash
npm install
```

## 2. Configurar o token do Azure DevOps

Copie `.env.example` para `.env` e preencha com um Personal Access Token
(permissão de leitura em "Work Items" já basta):

```
AZURE_DEVOPS_PAT=seu_token_aqui
```

No Windows (PowerShell), se preferir não usar `.env`, dá pra exportar direto:

```powershell
$env:AZURE_DEVOPS_PAT = "seu_token_aqui"
```

**Mais fácil ainda:** dê duplo clique em `rodar_sync.bat`. Na primeira vez ele
pede o token e salva permanentemente na sua conta do Windows — nunca fica
escrito em nenhum arquivo dentro da pasta do projeto, e você não precisa
abrir terminal nem digitar comando. Como usa a mesma variável
`AZURE_DEVOPS_PAT`, é o **mesmo token** que o `gerar_roadmap.bat` do projeto
`Azure-Roadmap_Maker` já usa — configurando em um dos dois projetos, o outro
já enxerga.

⚠️ **Nunca preencha o `.env` com o token real se for compartilhar essa pasta
(zipar, subir pro GitHub, mandar por e-mail etc).** O `.gitignore` já
protege contra commit acidental, mas isso não impede de mandar o arquivo
manualmente sem perceber. Prefira sempre o `.bat`.

## 3. `config.json` -- caminho da planilha (`excel.filePath`)

Esse campo aceita dois formatos:

- **Caminho RELATIVO** (o padrão, ex: `"./planilha-teste/arquivo.xlsx"`) --
  sempre resolvido a partir da pasta ONDE O PROJETO ESTÁ, não da pasta em
  que você abriu o terminal ou o `.bat`. Assim, o projeto funciona igual
  não importa se está no Downloads, no `D:\GitHUB\...` ou em qualquer
  outro lugar -- não precisa reescrever o `config.json` toda vez que mudar
  a pasta do projeto de lugar.

  Por padrão já vem apontando pra `./planilha-teste/`, uma pasta dentro do
  próprio projeto (ignorada pelo Git) onde você pode colocar uma CÓPIA da
  planilha real pra testar sem mexer no arquivo oficial do OneDrive. Veja
  o `planilha-teste/LEIA-ME.txt`.

- **Caminho ABSOLUTO** -- quando estiver pronto pra rodar de verdade contra
  o arquivo oficial, troque pelo caminho completo do `.xlsx` dentro da
  pasta do OneDrive, por exemplo:

  ```json
  "filePath": "C:\\Users\\joaoa\\Unidas\\IT Transformação Digital - Backlog Funil de Vendas - BO + PO\\Ongoing - Melhorias Funil de Vendas - Livre.xlsx"
  ```

  (repare nas barras duplas `\\` — é assim que o JSON escreve uma barra
  invertida `\`). Um caminho absoluto sempre é usado do jeito que está
  escrito, ignorando a pasta do projeto.

Todo o resto do `config.json` (DE/PARA de status, nomes das colunas, cadência
de sprint) já reflete o que foi combinado. Os comentários (`_comment...`)
explicam cada bloco — o parser do Node ignora essas chaves, elas são só
documentação.

## 4. Rodar

**Feche a planilha no Excel antes de rodar** (o Windows trava o arquivo pra
escrita enquanto ele está aberto).

```bash
npm run sync
```

O script:
1. Busca no Azure todos os Work Items com a tag `Livre`.
2. Pra cada um, calcula o `Status` da planilha pelas regras combinadas (veja
   `lib/statusMapping.js`).
3. Na aba **LIVRE Oficial**: acha a linha pelo `Nº Azure` e atualiza `Status`,
   `Chamado` e `Resumo Melhoria`. Se o card não existir na planilha, cria uma
   linha nova. Nunca apaga linha.
4. Na aba **Pró ativos**: filtra só os cards com tag `Proativo` ou título
   começando com "Proativo" (tolera aspas/colchetes). Se o card já tem linha
   lá (por `Nº Azure`), só atualiza o `Resumo Melhoria` se o título mudou. Se
   não tem, cria uma linha nova com `Nº Azure`, `Resumo Melhoria` e
   `Solicitante = "Proativo"` — o resto fica em branco pro preenchimento
   manual. Nunca mexe em linhas/colunas já existentes.
5. Antes de salvar, faz uma cópia de segurança do arquivo original
   (`nome-do-arquivo.backup-<data-hora>.xlsx`, na mesma pasta) — assim, se
   algo sair errado, dá pra restaurar na hora.

## Regras de status implementadas (`lib/statusMapping.js`)

Ordem de prioridade — a primeira que bater, vence:

1. **State final do Azure**: `Removed` → `Removido` · `Closed` → `Entregue`
   (esses dois sempre vencem, não importa mais nada).
2. **Tag**: `Pausado` → `Paralisado` · `Bloqueado`/`Blocked` → `Bloqueado` ·
   `RASCUNHO` → `Aguardando Desenvolvimento da História`
3. **Coluna do board, SEM depender da sprint atual** (`byBoardColumnAlways`):
   - `Pronto para GMUD` → `Pronto GMUD`
   - `Priorizar proxima Sprint` → `Priorizado Proxima Sprint`
4. **Coluna do board, só se estiver na sprint atual** (`byBoardColumn`,
   calculada por `sprintCadence`):
   - `Pronto para Desenvolvimento/Spike` → `Na Sprint Atual`
   - `Em Desenvolvimento` → `Em Desenvolvimento`
   - `Em correção (Ambiente QA)` → `QA`
   - `Em testes - Ambiente QA` → `QA`
   - `Em correção (HML)` → `QA` (+ marca `HML` na coluna `OBS`)
5. **State `Resolved`** → `Entregue`, só como ÚLTIMO recurso (se nada acima
   bateu) — de propósito por último: um card pode continuar `Resolved` no
   Azure enquanto passa por várias colunas do board (ex: testes de QA) antes
   de virar `Closed` de verdade; se `Resolved` tivesse prioridade mais alta,
   essas colunas nunca seriam vistas.

Se nenhuma regra bater, o `Status` da linha **não é sobrescrito** — fica como
está (pode ser um status gerenciado manualmente, tipo `Priorizado`,
`Aguardando Refinamento de Negócio` etc).

**Linha já marcada `Removido` na planilha é intocável** — nenhum campo é
atualizado (nem título, nem chamado, nem status), EXCETO se o próprio card
no Azure também estiver com State `Removed` (aí segue o fluxo normal, que
mantém `Removido` e atualiza o título).

**`Nº Azure` em branco ou inválido** (não existe mais no Azure) → `Status`
vira `Backlog` — a menos que a linha já esteja travada como `Removido`
(regra acima).

**Classificação** (`lib/statusMapping.js` → `resolveClassificacao`): olha só
a tag `Bug` ou `Melhoria` (mutuamente exclusivas) e escreve na coluna
`Classificação`.

**Data de corte**: dinâmica, recalculada a cada execução — é sempre a data
mais antiga já presente na coluna `Data da Inserção` da aba LIVRE Oficial.
O valor fixo em `config.json` (`query.cutoffDate`) só é usado como reserva
se essa coluna estiver totalmente vazia.

### Testar as regras sem precisar do Azure nem da planilha real

```
node test-rules.js
```

Roda um teste rápido, todo em memória, cobrindo as regras acima (inclusive
um round-trip real de leitura/escrita `.xlsx` com dropdown, pra checar que a
formatação/validação sobrevive). Útil pra conferir depois de mexer no
`config.json` antes de rodar contra a planilha de verdade.

## O que ainda vale revisar

- **Sprint de referência** (`sprintCadence` no `config.json`) precisa ser
  atualizada de tempos em tempos, senão o cálculo de "sprint atual" desalinha
  — mesma manutenção que o projeto original de PowerPoint já exige.
- Os nomes exatos das colunas do board (`Pronto para Desenvolvimento/Spike`,
  `Em Desenvolvimento`, `Em correção (Ambiente QA)`, `Em correção (HML)`,
  `Pronto para GMUD`) precisam bater **exatamente** (acento, maiúscula etc.)
  com o que está configurado no board do Azure. Se algum dia renomearem uma
  coluna no board, é só ajustar aqui.
- Se quiser rodar automaticamente (ex: 1x por dia), dá pra agendar via Task
  Scheduler do Windows chamando `node sync.js` dentro da pasta do projeto.
- A coluna `Classificação` (`config.json` → `excel.livreColumns.classificacao`)
  precisa bater **exatamente** com o cabeçalho real da planilha (acento
  incluído). Se der erro de "coluna não encontrada", é só ajustar o nome aí.

## Corrupção do arquivo ao salvar (erro de XML no Excel)

Se o Excel já reclamou de "Parte Substituída... erro XML" ao abrir o
arquivo depois do sync: o `lib/excelSheet.js` agora salva de forma
**atômica** (escreve num arquivo temporário e só troca pelo original no
final, em vez de escrever direto em cima do arquivo do OneDrive) e o
`lib/normalize.js` remove caracteres de controle inválidos que às vezes
vêm colados no título/chamado do Azure — as duas causas mais prováveis de
corrupção nesse tipo de arquivo. Isso foi validado com um teste de
round-trip real (leitura → escrita → releitura, com dropdown incluído), mas
não com o arquivo de vocês especificamente (que é bem mais complexo). Se a
planilha real do OneDrive corromper de novo mesmo com essa correção, guarde
o backup gerado (`.backup-<data>.xlsx`, criado automaticamente antes de
cada salvamento) e avise — precisa investigar com o arquivo real.
