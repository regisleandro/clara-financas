# O razão em Python

Este documento registra as decisões da reescrita do agent plane — de Eve
(TypeScript) para Agno (Python) — que não cabiam num comentário de código.
`README.md` descreve a arquitetura atual; aqui fica o **porquê** de cada
desvio frente ao original, e o que ficou deliberadamente para trás.

## Por que Python, e por que dois serviços

Agno não tem SDK TypeScript (`agno-agi/agno#2274`, fechada) — a escolha de
linguagem não foi preferência, foi a única viável para usar o framework que
o pedido nomeou. Isso torna o repositório poliglota por necessidade: o
control plane (`apps/web`) continua em TypeScript porque Better Auth não tem
equivalente direto em Python e login não fazia parte do pedido de reescrita;
o razão inteiro — schema, migrações, regras, agregações e as ferramentas de
conversa que o tocam — vive em `services/agent`, Python.

São dois SERVIÇOS, não dois pacotes de um monólito: o navegador fala com o
agente **cross-origin**, autenticado por um JWT curto que o control plane
emite. Essa fronteira já existia com o Eve e foi preservada — montar o
agente dentro do processo do Next obrigaria a desfazer depois uma decisão já
registrada em `apps/web/next.config.ts`.

## O que o banco preserva, e o que não

"Do zero" valeu para o código, não para os dados: as 19 tabelas, a RLS e os
dois triggers de imutabilidade foram re-expressos em SQLAlchemy + Alembic
mantendo nomes e formato de coluna, para que um banco existente continuasse
servindo. A migração `0001` (`services/agent/migrations/versions/`) é uma
migração **consolidada** — reproduz o estado final que as ~27 migrações
Drizzle antigas alcançavam, não cada passo histórico.

Duas tabelas do control plane (`user`) são espelhadas como leitura no lado
Python; `session`, `account` e `verification` (Better Auth) continuam
existindo apenas porque `apps/web` as cria pelo seu próprio caminho —
`services/agent` nunca escreve nelas.

## Provado rodando o serviço de verdade, não só testado

`uv run pytest` prova que cada função calcula certo contra PostgreSQL real.
Não prova que o processo inteiro sobe, autentica, injeta o snapshot do
tenant e alcança o modelo — e dois bugs reais só apareceram fazendo
exatamente isso, depois que a suíte inteira já estava verde:

1. **`clara_app` não conseguia criar o schema `agno`.** O `PostgresDb` do
   Agno roda `CREATE SCHEMA IF NOT EXISTS "agno"` a cada boot, com a MESMA
   conexão que serve o resto do serviço — e o Postgres exige o privilégio
   `CREATE` no banco para essa instrução mesmo quando o schema já existe (o
   `IF NOT EXISTS` só decide se a criação é pulada, DEPOIS de checar
   permissão). Sem o `GRANT CREATE ON DATABASE` que a migração `0001` agora
   inclui, a falha era silenciosa — um `WARNING` no log, o serviço seguia
   respondendo — e o sintoma só aparecia dias depois, quando uma conversa
   não sobrevivia a um reinício do processo.
2. **`AuthMiddleware` (a classe por trás de `JWTMiddleware`) já resolve o
   token interno do scheduler** comparando com `app.state.internal_service_token`
   antes mesmo de tentar decodificar um JWT — não foi preciso nenhum
   mecanismo extra para o Schedule diário de vencimentos se autenticar
   contra o próprio serviço. Isso só ficou claro lendo o código-fonte
   instalado, não a documentação.

A lição prática: o roteiro de verificação em `README.md` inclui subir o
serviço com `uvicorn` de propósito, não só rodar a suíte.

## Reduções de escopo — decisões, não descuidos

### Sem subagentes de analista e categorizador

O original tinha três subagentes (extrator, analista, categorizador). Este
port isolou só o **extrator** — porque ele é o único caso onde o isolamento
resolve um problema real: o extrator não pode herdar contexto do razão, ou a
extração deixaria de ser fiel só ao documento. As ferramentas do analista
(`aggregate_by_category`, `aggregate_by_month`, `compare_periods`,
`analyze_series`, `detect_recurrences`, `query_ledger`) são só leitura, sem
gate, e anexadas direto à coordenadora — isolá-las não protegeria nada que
já não seja verdade por serem funções puras.

O categorizador (triagem em lote de gasto sem categoria, com proposta por
comerciante) **não foi construído**. `list_review_queue` e
`recategorize_transactions` cobrem o caminho manual — a pessoa vê a fila e
corrige, uma ou várias linhas por chamada — mas não há triagem automática em
lote. `coordinator.md` documenta isso explicitamente para o modelo, e não
promete uma delegação que não existe.

### Sem etapa de apresentação (`present_*`)

O original tinha `present_analysis`, `present_categorization` e
`present_view` como um passo separado entre "a tool calculou" e "a pessoa
vê o painel". Aqui, o resultado da tool JÁ É o painel validado — chamar
`aggregate_by_category` devolve um `BreakdownPanel` pronto, não um recibo
que precisa de uma segunda chamada para virar apresentação. Menos uma etapa,
sem perda: a proveniência continua sendo exigida (ver abaixo), só que no
ponto de serialização, não numa tool à parte.

### `requires_confirmation` é estático, não condicional

A API do Agno (`@tool(requires_confirmation=True)` e `@approval`) só suporta
a flag por tool, fixa na definição — nunca uma função que decide "abre
cartão" ou "não abre" olhando o valor do argumento em tempo de chamada. O
original tinha exatamente isso em três lugares: `mark_reviewed` (cartão só
acima de 20 linhas), `apply_learned_rules` (`dryRun` decidia
`not-applicable` vs. `user-approval`) e `set_proactivity`/`save_commitment`
(gate condicionado a sessão fixada a um usuário só).

A solução, repetida três vezes, foi **dividir em duas tools**: uma leitura
ou operação pequena sem gate, e uma escrita/operação grande com
`requires_confirmation=True`, cada uma com uma descrição que diz à outra
quando usá-la:

| Original (uma tool, gate condicional) | Aqui (duas tools) |
| --- | --- |
| `mark_reviewed` (≤20 sem cartão, >20 com) | `mark_reviewed` / `mark_reviewed_bulk` |
| `apply_learned_rules` (`dryRun` decide) | `apply_learned_rules_preview` / `apply_learned_rules` |

`save_concept`, `save_commitment`, `deactivate_commitment` e
`set_proactivity` mantiveram o gate simples (sempre pedem aprovação) porque
a condição de sessão fixa já é garantida por `require_tenant_caller` — não
havia de fato um ramo "sem gate" a preservar.

### `recategorize_transactions`: só o caminho direto

O original tinha dois caminhos: mudança direta (`changes`) e referência a
uma proposta do categorizador (`artifactId` + `proposalIds`). Como o
categorizador não existe aqui, só o caminho direto foi portado.

### O extrator degrada sem lista de categorias

`read_concept` (a leitura de conceitos) existe, mas o extrator é isolado por
desenho e não a chama — herdar essa leitura significaria herdar contexto do
razão, o que quebraria o isolamento pelo motivo oposto ao que o justifica.
O extrator hoje lê sem lista de categorias e toda linha sai com
`category: null`; `propose_batch`/`propose_batch_from_extraction` já tratam
isso sem inventar — nenhuma categoria é chutada, e `coordinator.md` é
explícito: **entre uma categoria errada e nenhuma, deixe nenhuma.**

## Proveniência: de convenção manual a gate real

`clara/views/panels.py` sempre teve `require_provenance()`/
`check_provenance()` — a validação de que toda linha cuja soma vem de
lançamentos carrega `transaction_ids` (FR-016). Até a Fase 6, porém, nenhuma
tool chamava essas funções: cada tool de painel anexava `transaction_ids` à
mão, corretamente, mas por disciplina — não por imposição.

Isso foi corrigido movendo a chamada para `clara/tools/serialize.py`'s
`to_tool_result()` — o ponto único por onde TODO painel passa antes de
alcançar o modelo, porque toda tool de painel já termina com
`to_tool_result(panel)` (inclusive as que devolvem mais de um painel numa
chamada, como `aggregate_by_month`: uma chamada por painel). Um painel sem
proveniência agora vira `{ "error": { "code": "painel_sem_proveniencia" } }`
em vez do painel — a garantia deixou de depender de ninguém esquecer.

## O que ficou faltando, verificado e não suposto

Auditar o `coordinator.md` frase a frase contra a lista real de tools
registradas (`clara/agents/coordinator.py`) — em vez de confiar que o
documento estava atualizado — encontrou três gaps reais, cada um confirmado
lendo o código, não hipotético:

- **`resolve_invoice_reference`** existia como função (`invoice_focus.py`)
  mas nunca tinha sido anexada a nenhuma tool nem `coordinator.py` — dead
  code desde a Fase 3, corrigido na Fase 4.
- **`edit_proposed_batch`** existia no `packages/agent` original (TypeScript)
  — a correção de um lote ainda em rascunho, sem gate — mas nunca tinha sido
  portado para Python, apesar de `coordinator.md` e a própria descrição de
  `create_adjustment` já o citarem como se existisse. Portado na Fase N,
  depois de confirmado pelo histórico do git que o código original existia
  e fazia mais do que a descrição sugeria (adicionar linha que a extração
  perdeu, não só corrigir e remover).
- **`prepare_invoice_resolution`/`apply_invoice_resolution`** também
  existiam no original e também não tinham sido portados — depois portados
  na mesma Fase N, seguindo exatamente o padrão prepare/gate que
  `prepare_batch_registration`/`commit_batch` já estabeleciam (uma
  `FinancialActionProposal` congelada, revalidada na execução, nunca na
  proposta — FR-012). Cobre a correção de uma fatura **já confirmada** por
  um ajuste no nível do documento inteiro, sem um transaction_id específico
  — o caso que `create_adjustment` (Fase 5), pensado por transação, não
  cobre. O sinal do ajuste é sempre o inverso da diferença do checksum
  (`clara/ledger/financial_actions.py`); nunca vem do modelo.
- **`ask_question`** nunca existiu neste serviço — uma senha de PDF
  protegido chega como argumento de texto simples (`read_pdf_pages.py`), não
  como uma segunda pausa do turno com campo protegido. `coordinator.md`
  instruía o modelo a chamar `ask_question` mesmo assim; corrigido para
  descrever o comportamento real.

## Infraestrutura que a Fase 1 não deixou pronta

Três tarefas do plano original ficaram documentadas como feitas sem estar:

- **T002** (Dockerfile + docker-compose) só foi escrito na polida final
  (`services/agent/Dockerfile`, `docker-compose.yml`) — não foi possível
  testar o build neste ambiente (o daemon Docker do sandbox não inicia), o
  que é uma lacuna de verificação a resolver antes de depender dele em
  produção.
- **T003** (`scripts/dev-db.sh`/`scripts/ci-db.sh` adaptados para Alembic)
  ficou pela metade, e por um motivo mais sério do que "faltou tempo":
  **as duas migrações não são complementares num banco novo — criam as
  MESMAS 19 tabelas do razão.** A primeira tentativa desta sessão foi
  encadear as duas no `dev-db.sh` (Drizzle, depois Alembic); rodando de
  verdade contra um banco fresco, a segunda falhou em "relation already
  exists" assim que alcançou uma tabela que a primeira já tinha criado.
  Revertido — `dev-db.sh` continua chamando só a migração Drizzle antiga
  (`packages/db/src/migrate.ts`), com um aviso explícito no próprio script
  sobre a colisão. `ci-db.sh`, por outro lado, já servia — ele só cria
  papéis/banco/extensões, nunca conheceu Drizzle nem Alembic, e o novo job
  `verify-agent` do CI (ver T004 abaixo) o reaproveita sem alteração
  nenhuma. Quem sobe um banco NOVO para rodar `services/agent` hoje faz a
  migração Alembic e cria as três tabelas de auth à mão (SQL em
  `README.md`) — o caminho real que este port usou o tempo todo, não uma
  simplificação de documentação. Automatizar isso de verdade exige o
  mecanismo de baseline do Drizzle (`pnpm -F @clara-financas/db
  db:baseline`, que registra migrações como aplicadas sem executá-las) e
  decidir, com conferência humana, até que tag baselinear — não foi feito
  aqui porque essa decisão é exatamente o tipo de coisa que um script não
  deveria escolher sozinho.
- **T004** (CI do serviço Python) nunca existiu: `.github/workflows/ci.yml`
  só rodava `pnpm test` — a suíte de `services/agent` (então com ~250
  testes, ruff e mypy limpos localmente) nunca tinha sido executada em um
  PR. Corrigido com um segundo job (`verify-agent`), paralelo ao `verify`
  original, com Postgres próprio. `ruff` e a suíte são gates reais (ambos
  limpos); `mypy` roda como passo informativo
  (`continue-on-error: true`) — 31 erros pré-existentes, nenhum em código
  tocado por este port, continuam sem correção (majoritariamente em
  `write_proposed_batch.py` e `ledger/{analysis,series}.py`; ver
  `git log` para o antes/depois). Tornar isso um gate bloqueante exigiria
  corrigi-los primeiro — o que, feito às pressas só para "ligar o CI",
  seria exatamente o tipo de mudança apressada em código financeiro que
  este projeto existe para evitar.

  A limpeza que FOI feita, e que reduziu esse número de 106 para 31: as
  ~33 tools de fronteira (`clara/tools/*_tool.py`) declaravam `-> dict:`
  sem argumento de tipo e devolviam `to_tool_result(...)` — que
  deliberadamente retorna `Any`, porque aceita dataclass, `BaseModel`,
  `ToolError` ou um dict já pronto. Cada uma dessas fronteiras SABE, pelo
  próprio contrato, que o resultado é um objeto; a lacuna era não haver
  onde declarar essa garantia. `to_tool_dict()` (`clara/tools/serialize.py`)
  é esse ponto — um `cast` documentado — e as ~33 tools passaram a
  devolver `dict[str, Any]` de verdade, sem tocar em `to_tool_result` em
  si, que continua genérico porque genuinely precisa ser.

## O que ainda depende dos pacotes TypeScript antigos

`packages/{db,ledger,views,ui,okf}` continuam no repositório porque telas e
componentes reais de `apps/web` ainda os importam diretamente:
`/transacoes`, `/revisar`, `/validacao`, `/agenda` e vários componentes
(`decision-card`, `transaction-table`, `view-panel`, `review-queue`,
`spend-card`, `issuer-month-view`, `artifact-surface`, `chat-message`) leem
o razão pelo caminho Drizzle antigo, não pela API Python. Migrar essas telas
para `clara/api/router.py` — nos mesmos moldes de `/inicio` e `/comparacao`,
já movidas na Fase 4 — é o que destrava a remoção final desses pacotes.
`packages/okf` também segue vivo porque `apps/web/lib/tenant.ts` ainda semeia
a constituição no primeiro login pelo caminho TypeScript
(`packages/db/src/seed-constitution.ts`); a Fase 6 do plano original previa
um `clara/knowledge/` que faz isso em Python (`ensure_tenant`), e ele não foi
construído — `clara/knowledge/` hoje só contém `proactivity.py`.

Só `packages/agent` foi removido: zero referências reais em qualquer lugar
do repositório, confirmado por busca antes de apagar.
