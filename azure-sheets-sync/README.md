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

1. **State do Azure**: `Removed` → `Cancelado` · `Resolved`/`Closed` → `Entregue`
2. **Tag**: `Pausado` → `Paralisado` · `Bloqueado`/`Blocked` → `Bloqueado`
3. **Coluna do board** (`System.BoardColumn`), só se o card estiver na
   **sprint atual** (calculada por `sprintCadence`, mesma lógica do app
   original):
   - `Pronto para GMUD` → `Pronto GMUD` (não depende de sprint)
   - `Pronto para Desenvolvimento/Spike` → `Na Sprint Atual`
   - `Em Desenvolvimento` → `Em Desenvolvimento`
   - `Em correção (Ambiente QA)` → `QA`
   - `Em correção (HML)` → `QA` (+ marca `HML` na coluna `OBS`)

Se nenhuma regra bater, o `Status` da linha **não é sobrescrito** — fica como
está (pode ser um status gerenciado manualmente, tipo `Backlog`,
`Priorizado`, `Aguardando Refinamento de Negócio` etc).

`Removido` nunca é escrito pelo app — é status de uso manual, por decisão
sua.

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
