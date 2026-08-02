# Avaliação dos agentes e dos fluxos de conversa — 2ª rodada

Data: 2026-07-26 · Escopo: `packages/agent`, `packages/views`, `apps/web`, `packages/db`, `packages/ledger`
Atualização: as propostas **P1 e P2 (§4) foram implementadas** na sequência da mesma rodada — ver §3.1 e §3.2.

Sintomas relatados que motivaram esta rodada:

1. **Os agentes não conseguem encontrar dados e responder.**
2. **Os agentes não executam as alterações quando propostas.**

As duas frases são verdadeiras, mas por causas diferentes das óbvias: não é o modelo escolhendo mal — são portas que não existem (filtros de leitura que nenhuma tool oferece) e um defeito de interface que esconde o cartão de aprovação exatamente no fluxo que o prompt prescreve. Este documento mapeia o que existe, lista os gaps por categoria e registra o que foi corrigido nesta rodada (P0) e o que fica proposto (P1/P2).

---

## 1. Inventário do que existe

### Agentes

| Agente | Modelo | Papel | Tools |
|---|---|---|---|
| **Coordenadora (Clara)** | `CLARA_MODEL` | Conversa, delegação, escrita no razão, gates | 18 tools (abaixo) |
| **Extractor** | `CLARA_EXTRACTOR_MODEL` (ou o principal) | PDF → lote estruturado | `read_pdf_pages` |
| **Analyst** | principal | Todo número da conversa | `query_ledger`, `aggregate_by_category`, `compare_periods`, `detect_recurrences` |
| **Categorizer** (guarda-livros) | principal | Triagem de categoria (só propõe) | `categorize_by_rules`, `list_uncategorized`, `read_knowledge` |

A delegação é por descrição (`description` do `defineAgent`), sem roteador determinístico. Subagentes não herdam nada do root — o extractor não enxerga o razão por construção, e o analista/categorizer duplicam o snapshot de estado.

### Tools da coordenadora

Com gate de aprovação (Decision Card): `commit_batch`, `reject_batch`, `create_adjustment`, `recategorize_transactions`, `save_concept`, `apply_learned_rules` (fora do `dryRun`), `save_commitment`.
Escrita sem gate (auditada/reversível): `propose_batch`, `edit_proposed_batch` (só rascunho), `set_transaction_category`, `mark_reviewed`, `name_issuer`.
Leitura: `read_batch`, `read_concept`, `list_invoices`, `list_review_queue`, `list_commitments`. Apresentação: `present_view` (8 formas de painel).

### Fluxos de conversa que funcionam hoje

- **Upload → registro** (o principal): upload direto ao Blob → extractor → `propose_batch` (rascunho) → checksum/conferência → correções com `edit_proposed_batch` → `commit_batch` no cartão → razão. Descartar com `reject_batch`; corrigir pós-registro com `create_adjustment`.
- **Perguntas sobre gastos**: delegação ao analyst → painel (`metric`/`breakdown`/`comparison`/`recurrences`/`transactions`) com proveniência estrutural (`transactionIds` em cada linha).
- **Correção de categoria + aprendizado (H4)**: `recategorize_transactions` → `save_concept` (regra) → `apply_learned_rules` com `dryRun` e guard de alcance.
- **Escritas pequenas sem cartão**: uma categoria, atestado de revisão, nome da operadora.
- **PDF protegido**: senha selada (`sealed input`), nunca em texto puro no histórico.
- **Revisão manual** (`/revisar`): fila derivada (sem categoria / confiança baixa / sem comerciante), fora do chat.

A suíte de testes exercita as tools contra o banco real (não o texto do modelo) — ciclo de vida da fatura, revisão/categorização, telemetria, isolamento e, a partir desta rodada, ajuste-fecha-conferência, erros estruturados e filtros por operadora/mês.

---

## 2. Gaps encontrados

### 2.1 Leitura — por que "não encontram dados"

| Gap | Efeito | Status |
|---|---|---|
| Nenhuma tool aceitava filtro por **operadora** | "Quanto gastei no Nubank?" irrespondível por construção; `name_issuer` até prometia uma visão por operadora que só existia na web | **Corrigido (P0)** |
| Nenhuma tool aceitava **mês** como recorte | O modelo calculava `from`/`to` de cabeça e errava o último dia (fevereiro, meses de 30) | **Corrigido (P0)** |
| **Documentos sem lote são invisíveis** — `list_invoices` e o snapshot fazem `innerJoin` com `batches` | Extração que falhou ou lote rejeitado somem; o documento não pode ser reaproveitado porque o hash barra o reenvio e nada lista o órfão | **Corrigido (P1: `list_documents`)** |
| **Trilhas escritas e nunca lidas**: `transaction_reclassifications`, `concept_revisions`, `notifications`, `agent_tool_events` | "O que você mudou?", "que avisos me deu?", "desfazer a regra" — sem porta; o revert prometido em `save_concept` não tem leitor do corpo antigo | **Parcial (P1: `read_reclassifications`, `read_concept_history`)**; `agent_tool_events` segue P2 |
| **Parcelas** omitidas do `brief()` do analista | O modelo não enxerga `installment` fora do `read_batch` | P2 |
| Snapshot limita 12 faturas (anunciado via `invoicesOmitted`) | Mitigado por `list_invoices` | ok |

### 2.2 Execução — por que "não fazem as alterações"

| Gap | Efeito | Status |
|---|---|---|
| **Gate encadeado travava a conversa**: `answered` era um flag global que só resetava em mensagem nova; o fluxo prescrito de aprendizado abre 3 gates seguidos no mesmo turno | Respondido o 1º cartão, o 2º nunca renderizava; sessão parada em `session.waiting` sem controles; único escape era recarregar a página, sem que nada sugerisse isso | **Corrigido (P0)** |
| **Falha no envio da aprovação não revertia o cartão** (`agent.send` sem catch) | Token vencido ⇒ cartão some, decisão não chega, nada clicável volta | **Corrigido (P0)** |
| **Erros na forma antiga** (string plana) em `commit_batch`, `apply_learned_rules`, `compare_periods`, `read_pdf_pages` | A interface exige `retryable` para mostrar aviso; sem ele, pintava **falha vermelha** em recusas desenhadas (ex.: o guard de alcance funcionando) e o modelo ficava sem `hint` | **Corrigido (P0)** |
| **`create_adjustment` não reconferia o lote** | Divergência já resolvida continuava acusada para sempre: em `/revisar`, nos starters e no snapshot ("divergência ainda aberta") — a Clara reafirmava um problema que a pessoa acabara de resolver | **Corrigido (P0)** |
| **Aprovação sem efeito era invisível**: `recategorize_transactions` sobre ids de rascunho devolvia sucesso com `changed: 0` | Check verde no trace; aprovar sem efeito indistinguível de aprovar com efeito | **Corrigido (P0)** |
| **Retranscrição do lote**: o coordenador reemite token a token as 100+ linhas da extração no `propose_batch` | Custo de contexto proporcional à fatura + risco de erro de cópia no elo mais crítico | **Corrigido (P1: staging + `propose_batch_from_extraction`)** |
| `propose_batch` **apaga o rascunho anterior** do mesmo documento sem cartão | 10 turnos de correção podem sumir se a Clara repropõe interpretando mal um pedido | **Corrigido (P1: `rascunho_editado` + `overwriteEditedDraft`)** |
| `mark_reviewed` aceita **500 ids sem gate** | O argumento de escala que justifica o gate em `recategorize_transactions` vale aqui também | **Corrigido (P2: cartão acima de 20 ids)** |

### 2.3 Produto — promessas sem suporte

| Gap | Detalhe |
|---|---|
| **Extrato bancário** declarado (`bank_statement` no schema, "extratos" no PRODUCT.md) mas nenhum código grava outro `kind` além de `credit_card_invoice`; checksum é todo modelado para fatura | **Corrigido na v3** — classificação, saldos inicial/final, reconciliação determinística e painel próprio |
| **Operadora sem identidade canônica**: `documents.issuer` é texto livre; a chave (`issuerKey`) só existe na leitura. "Nubank" e "Nu Bank" são duas linhas na matriz | Parcial: a chave agora é compartilhada (`@clara-financas/ledger`) e o snapshot entrega as grafias exatas; canonicalização na escrita (análoga ao `merchantKey`) fica P2 |
| **Lembrete sem porta de saída**: `commitments.active` nunca recebe `"no"` — não há tool nem tela que desative; a varredura diária avisa para sempre | **Corrigido (P1: `deactivate_commitment`, com gate)** |
| **Proatividade sem opt-in**: o cron varre todos os tenants `ready`; o princípio "relevância **e consentimento**" está implementado só na metade relevância | **Corrigido (P2: `set_proactivity`)** |
| **Dupla contagem** fatura parcial + fatura fechada do mesmo ciclo (documentada no README): as duas conferências passam e o total mente sobre a vida financeira | **Mitigado (P2: `duplicateSuspects` na proposta — aviso com ids, decisão da pessoa)** |
| **`notifications.readAt` nunca é escrito**: o badge de alertas fica aceso para sempre após o primeiro aviso | **Corrigido (P1: agenda marca ao exibir)** |
| **Fila de revisão só vê o confirmado**: um lote que fica `proposed` para sempre (fatura parcial, caminho recomendado no README) não aparece em fila nenhuma | P2 |

### 2.4 Telemetria — o que impede diagnosticar

`agent_tool_events` é escrita e nunca lida por tela ou tool. Além disso: `durationMs` declarado e nunca preenchido; `turnId` só gravado em `turn.failed` (impossível agrupar um turno); as tools de **subagente** rodam na sessão filha e não passam pelo hook — o extractor, componente mais caro e frágil, é o menos observado; `pendingInputs` é um `Map` de módulo sem TTL (vaza em turno cancelado e quebra em serverless multi-instância); sem `CLARA_TELEMETRY_ALL`, os `ok` são descartados e não há denominador para taxa de erro.

**Status pós-P2: corrigido** exceto o denominador (`CLARA_TELEMETRY_ALL` continua opt-in, decisão de custo): `durationMs` e `turnId` gravados, hooks nos três subagentes, teto+prazo no `pendingInputs`, e `read_tool_events` como leitor pela conversa — ver §3.2.

---

## 3. O que foi corrigido nesta rodada (P0)

1. **Gate encadeado** — `apps/web/hooks/use-clara-agent.ts` + `apps/web/lib/answered-state.ts`: a resposta agora é amarrada ao `requestId`. Gate novo ⇒ cartão novo aparece; o fluxo de 3 gates do aprendizado funciona de ponta a ponta. Falha no envio reverte o estado e devolve o cartão com um toast.
2. **Erros estruturados** — `commit_batch`, `apply_learned_rules` (`alcance_alterado`), `compare_periods` (`recorte_incompleto`) e `read_pdf_pages` agora usam `{error: {code, message, hint, retryable}}`. Recusas desenhadas viram aviso amarelo, não quebra vermelha; o modelo recebe o próximo passo executável.
3. **Filtro por operadora e mês** — `issuerKey` subiu para `@clara-financas/ledger` (mesma chave da web); `query_ledger` e `aggregate_by_category` aceitam `issuer` e `month`; o snapshot lista as operadoras conhecidas para o modelo usar a grafia certa. "Quanto gastei no Nubank em junho" agora tem caminho direto.
4. **Ajuste reconfere o lote** — helper compartilhado `recompute-checksum.ts` usado por `edit_proposed_batch` e `create_adjustment`. Ajuste que fecha a diferença grava `match` no lote (sai de `/revisar`, dos starters e do snapshot); ajuste que afasta o razão do documento grava o `mismatch` honesto.
5. **Aprovação sem efeito visível** — `recategorize_transactions` com `changed: 0` devolve `nenhuma_alteracao` estruturado, com hint apontando `edit_proposed_batch` para rascunhos.

Cobertura nova: `packages/agent/tests/tools/adjustment-and-errors.test.ts`, `packages/agent/tests/tools/issuer-month-filters.test.ts`, `packages/ledger/src/issuer.test.ts`, `apps/web/lib/answered-state.test.ts`, mais o caso de reconferência no `invoice-lifecycle.test.ts`.

## 3.1 O que a rodada P1 implementou

1. **Passagem por referência da extração** — nova tabela `extraction_stagings` (migração 0017, RLS + `GRANT SELECT, INSERT, DELETE`); o extractor persiste a leitura completa com a nova tool `save_extraction` e seu `outputSchema` virou um **recibo** (`ExtractionReceiptSchema`); o coordenador propõe com `propose_batch_from_extraction({extractionId})`, que consome a staging. As 100+ linhas da fatura não atravessam mais o contexto do coordenador. A escrita do lote virou helper compartilhado (`agent/lib/write-proposed-batch.ts`), usado também pelo `propose_batch` (que permanece para lotes ditados na conversa). A invariante do extractor foi reescrita: de "nenhuma tool de escrita" para "**não alcança o razão**" — a staging não tem grant sobre `batches`/`transactions`.
2. **Proteção do rascunho editado** — repropor sobre um rascunho com `updatedAt > createdAt` (isto é, que já recebeu `edit_proposed_batch`) recusa com `rascunho_editado` e só substitui com `overwriteEditedDraft: true`, após confirmação da pessoa. Rascunho intocado mantém a idempotência silenciosa original.
3. **`list_documents`** — join aberto com `batches` + staging pendente: órfãos e rejeitados aparecem, cada linha diz o próximo passo (`propose_batch_from_extraction`, delegar ao extractor, etc.).
4. **`read_reclassifications`** — a trilha com autor/motivo/valores, filtrável por `transactionId` ou `byConceptId` (o alcance completo de uma regra aplicada — o desfazer inteiro).
5. **`read_concept_history`** — as revisões de um conceito com corpo completo; o revert prometido por `save_concept` agora tem leitor.
6. **`deactivate_commitment`** — com gate e cartão próprio no Decision Card; a varredura diária silencia (`active='no'`), histórico preservado; documentado que o upsert de `save_commitment` reativa (também atrás de cartão).
7. **`notifications.readAt`** — a agenda marca os avisos exibidos como lidos (server action + componente cliente); o badge apaga.

Erros novos no catálogo: `extracao_nao_encontrada`, `rascunho_editado`, `compromisso_nao_encontrado`, `conceito_nao_encontrado`. Instruções do coordenador e do extractor atualizadas (delegação por recibo, porta de saída da proatividade, o desfazer no ciclo de aprendizado, documentos órfãos). Cobertura nova: `extraction-staging.test.ts`, `p1-readers.test.ts`, `commitments.test.ts`.

## 3.2 O que a rodada P2 implementou

1. **Telemetria completa** — o hook virou factory (`agent/lib/telemetry-hook.ts`) instalada no root **e nos três subagentes** (subagente declarado não herda hooks — o extractor, componente mais frágil, era o menos observado); `durationMs` e `turnId` agora são gravados em todo `action.result`; o `Map` de inputs pendentes ganhou teto (1000) e prazo (6h), fechando o vazamento; o nome do agente executor entra no `inputSummary`.
2. **Auditoria pela conversa** — decisão de desenho registrada: o "subagente auditor" proposto virou **duas tools de leitura da coordenadora**, porque os leitores de trilha da P1 já moram nela e são leituras baratas com teto — um subagente só adicionaria isolamento sem benefício. `read_tool_events` lê o log de execução (tool, status, código, duração — sem valores financeiros por construção) e `list_notifications` lê os avisos já enviados com o estado de visto, fechando o ciclo "o que você fez/mudou/avisou".
3. **Consentimento de proatividade** — `set_proactivity` (com gate, nas duas direções) grava o interruptor geral como conceito `preferences/proactivity` no bundle `learnings` — dado do tenant, atrás da RLS, com trilha de revisões, e não no registry do control plane; `sweepDueDates` pula o tenant desligado. `deactivate_commitment` (P1) continua sendo a porta individual.
4. **Aviso de dupla contagem** — `write-proposed-batch` compara cada linha proposta com o que já está **confirmado vindo de outro documento** (mesma data, valor e `merchantKey`) e devolve `duplicateSuspects` com os ids; as instruções mandam avisar a pessoa **antes** de abrir o commit. É aviso, não bloqueio — duas compras idênticas no mesmo dia existem; quem decide é a pessoa. Fecha o caso documentado no README (fatura parcial + fechada do mesmo ciclo, as duas conferências passando).
5. **Identidade de operadora na escrita** — `canonicalIssuer` (por `issuerKey`): `name_issuer` e a proposta de lote reusam a grafia já registrada da mesma operadora ("NUBANK" converge para "Nubank"). Grafias estruturalmente diferentes ("Nu Bank") continuam sendo trabalho de alias (`IssuerPattern`), registrado como limite.
6. **Gate para atestado em massa** — `mark_reviewed` acima de 20 ids abre o cartão (mesmo argumento de escala do `recategorize_transactions`); reabrir nunca pede cartão — devolver à fila é a direção segura. Cartões próprios no Decision Card para `mark_reviewed` em massa e `set_proactivity`.

Cobertura nova: `p2-guardrails.test.ts` (consentimento liga/desliga a varredura de verdade, dupla contagem acusada, grafia da operadora converge, limiar do gate do atestado, porta individual convive com o interruptor geral).

---

## 4. Propostas — próximas rodadas

### P1 — novas tools (destravam fluxos hoje impossíveis) — **IMPLEMENTADAS, ver §3.1**

| Proposta | O que destrava |
|---|---|
| **`list_documents`** (inclui sem lote e rejeitados) | Reaproveitar documento cuja extração falhou/lote foi rejeitado; hoje o hash barra reenvio e nada lista o órfão |
| **`propose_batch_from_extraction`** (passagem por referência: o extractor persiste um staging e o coordenador referencia por id) | Elimina a retranscrição de 100+ linhas — o maior custo de contexto e risco de cópia do produto |
| **`read_reclassifications`** | "O que você mudou e quando"; desfazer aplicação de regra em lote deixa de ser desfazer pela metade |
| **`deactivate_commitment`** (com gate) | A porta de saída do lembrete que hoje avisa para sempre |
| **`read_concept_history`** | Viabiliza o revert que `save_concept` promete ("escrever de volta um corpo antigo" — sem leitor do corpo antigo) |
| Confirmação antes de `propose_batch` sobre rascunho já editado | Protege as correções acumuladas de uma re-proposta acidental |
| Marcar `notifications.readAt` ao abrir a agenda | Apaga o badge eterno |

### P2 — arquitetura e produto — **IMPLEMENTADAS (com dois ajustes de desenho), ver §3.2**

- **Subagente auditor** (leitura pura das trilhas: reclassificações, revisões de conceito, notificações, telemetria) — responde "o que você fez/mudou/avisou" sem inchar a coordenadora.
- **Identidade de operadora na escrita** (`IssuerPattern`/alias, análogo ao `merchantKey`) — canonicaliza no `name_issuer`/`propose_batch` em vez de slugificar na leitura.
- **Fingerprint de lançamento ou supersessão de lote** — fecha a dupla contagem parcial+fechada.
- **Consentimento de proatividade** — flag por tenant consultada pelo cron.
- **Telemetria completa** — `durationMs`, `turnId` em todo evento, hook nos subagentes, TTL no `pendingInputs`.
- **Gate para `mark_reviewed` em lote** (mantendo o caminho sem cartão para poucas linhas).
- **Extrato bancário** — segundo contrato de conferência, se o produto confirmar a promessa do PRODUCT.md.

---

## 5. Verificação desta rodada

- `pnpm turbo test` — 6 pacotes, 0 falhas (suíte do agente contra Postgres real via `./scripts/dev-db.sh`).
- `pnpm turbo check-types` — 7 pacotes, limpo.
- Os testes novos provam: gate encadeado mostra o segundo cartão; ajuste fecha (e reabre honestamente) a conferência no lote; erros carregam `code`/`hint`/`retryable`; `issuer`+`month` recortam o razão com a mesma identidade da web; aprovação sem efeito vira erro visível.
