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

## 3. Completar o `config.json`

Já vem preenchido com tudo que definimos na conversa. **Só falta uma coisa**:

- `excel.filePath` — está com um nome de arquivo genérico
  (`NOME_DO_ARQUIVO.xlsx`). Troque pelo caminho completo e real do `.xlsx`
  dentro da pasta do OneDrive, por exemplo:

  ```json
  "filePath": "C:\\Users\\joaoa\\Unidas\\IT Transformação Digital - Backlog Funil de Vendas - BO + PO\\Ongoing - Melhorias Funil de Vendas - Livre.xlsx"
  ```

  (repare nas barras duplas `\\` — é assim que o JSON escreve uma barra
  invertida `\`).

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
