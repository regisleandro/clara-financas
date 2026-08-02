# Clara V1 — plano de execução

**Status:** proposta de implementação

**Data:** 2026-08-01

**Objetivo:** construir uma primeira versão confiável da Clara como agente financeiro conversacional, usando Eve para coordenação e delegação, um núcleo financeiro determinístico e execução de análises customizadas em sandbox.

Este documento substitui o desenvolvimento incremental da experiência atual. O núcleo financeiro existente será preservado onde for confiável; a orquestração, os contratos e a interface serão reconstruídos de forma isolada e validável.

## 1. Decisão arquitetural

```text
Usuário
  ↕
Interface Clara
  ├── Conversa
  ├── Detalhes
  └── Revisão
       ↕
Clara / Eve
  ├── interpretação
  ├── roteamento
  ├── delegação
  └── explicação
       ↕ tools tipadas
Agentes de apoio
  ├── Extractor
  ├── Analyst
  ├── Categorizer
  └── Calculator
       ↕
Financial Kernel
  ├── razão financeiro
  ├── consultas tipadas
  ├── cálculos determinísticos
  ├── planos analíticos
  ├── sandbox
  ├── validação
  └── proveniência
```

Eve permanece como camada cognitiva e conversacional. Ele interpreta a intenção, decide qual capacidade utilizar, delega e explica.

O Financial Kernel é a fonte de verdade. Os agentes não acessam diretamente o banco, não calculam valores financeiros em texto livre e não escrevem no razão sem uma tool explícita.

## 2. Escopo da V1

### 2.1 Entrada e processamento

- upload de PDF;
- upload de imagem;
- CSV somente se o fluxo já estiver estável;
- identificação do tipo do documento;
- processamento assíncrono com progresso real;
- staging da extração;
- lote proposto;
- conferência de checksum;
- aprovação ou correção;
- retomada após refresh ou falha.

### 2.2 Conversa

A Clara deve responder com dados reproduzíveis:

- quanto foi gasto;
- qual categoria pesa mais;
- onde o dinheiro foi gasto;
- quais comerciantes mais impactaram;
- comparação entre duas faturas;
- evolução de três ou mais períodos;
- cobranças recorrentes;
- explicação de um lançamento;
- diferença entre pagamento e consumo;
- origem de qualquer número;
- simulações customizadas executadas por script.

### 2.3 Revisão

- corrigir comerciante;
- corrigir categoria;
- deixar sem categoria;
- criar categoria nova;
- revisar baixa confiança;
- retirar pagamentos da fila de categorização;
- registrar alterações na trilha;
- desfazer uma revisão.

### 2.4 Interface

- chat como superfície principal;
- painel Detalhes ao lado no desktop;
- Detalhes em tela cheia no mobile;
- ações de leitura sem aprovação bloqueante;
- aprovação somente para escrita ou alteração semântica;
- erros recuperáveis na própria conversa;
- nenhum overflow vertical inesperado;
- nenhum termo interno de Eve exposto ao usuário.

Ficam fora da V1: integrações bancárias completas, agenda completa, previsões probabilísticas, automações complexas, múltiplos provedores de sandbox, scripts com instalação de pacotes e escrita financeira via script.

## 3. O que preservar

Preservar, reforçar com testes e usar como base:

- `packages/ledger/src/checksum.ts`;
- `packages/ledger/src/analysis.ts`;
- `packages/ledger/src/types.ts`;
- dinheiro em centavos;
- `kind` dos lançamentos;
- imutabilidade de transações confirmadas;
- proveniência por IDs;
- RLS e `forTenant`;
- staging de extração;
- `propose_batch_from_extraction`;
- aprovação de lotes;
- trilha de reclassificação;
- paginação do razão;
- conceitos versionados;
- isolamento da extração em relação ao razão.

O núcleo atual contém bons fundamentos. O problema principal está na divergência entre contratos, agentes, consultas, estado e interface.

## 4. O que refatorar, adicionar e retirar

### 4.1 Refatorar

- coordenador e prompts;
- estado da conversa;
- contratos de categoria, período, pagamento e resultado;
- fila de revisão;
- apresentação de Detalhes;
- shell visual e responsividade;
- telemetria;
- testes ponta a ponta;
- fluxo de análise customizada.

### 4.2 Adicionar

- tipos financeiros branded;
- normalização de categoria;
- registro de capacidades;
- planos analíticos;
- executor determinístico de planos;
- snapshots de dados;
- execução sandboxada;
- validação de resultados;
- persistência de execuções analíticas;
- estado explícito da conversa;
- criação manual de categorias;
- suíte de avaliação com faturas reais anonimizadas.

### 4.3 Depreciar ou retirar da experiência

- trace técnico visível;
- linguagem interna de agentes;
- cartões de decisão para análises somente leitura;
- múltiplos estados concorrentes na mesma tela;
- menus sem função;
- loaders que simulam processamento sem estado real;
- fallbacks genéricos sem causa ou ação de recuperação;
- cálculo feito pela interface;
- scripts ou SQL executados pelo agente no processo da aplicação.

Não apagar tabelas ou dados existentes antes de haver compatibilidade e migração verificadas. Componentes antigos devem ser isolados por feature flag e removidos somente depois da paridade.

## 5. Contratos do Financial Kernel

Tocar:

- `packages/ledger/src/types.ts`;
- `packages/views/src/agent-contracts.ts`;
- `packages/db/src/schema/ledger.ts`;
- `packages/db/src/schema/extraction-staging.ts`.

Criar tipos explícitos:

```ts
type MoneyCents = number & { readonly __brand: "MoneyCents" };

type CategoryId = string & { readonly __brand: "CategoryId" };

type PeriodScope =
  | { kind: "calendar_month"; month: string }
  | { kind: "invoice"; batchId: string }
  | { kind: "range"; from: string; to: string }
  | { kind: "all" };
```

Adicionar validação de:

- dinheiro em centavos;
- categoria sem `/` na persistência;
- período e ciclo de fatura;
- tipo do lançamento;
- status do lote;
- dados confirmados versus propostos;
- versão de schema do resultado analítico.

### 5.1 Normalização de categoria

Criar uma única função canônica:

```ts
normalizeCategoryId(value: string | null): string | null
```

Ela aceita `subscriptions` e `categories/subscriptions`, mas sempre retorna `subscriptions`.

Aplicar na fronteira de gravação em:

- `packages/agent/agent/lib/write-proposed-batch.ts`;
- `packages/agent/agent/tools/propose_batch.ts`;
- `packages/agent/agent/tools/propose_batch_from_extraction.ts`;
- `packages/agent/agent/tools/edit_proposed_batch.ts`;
- `packages/agent/agent/tools/recategorize_transactions.ts`;
- `apps/web/app/(app)/revisar/actions.ts`.

### 5.2 Regra de pagamentos

Definir como regra de domínio:

```text
purchase, refund e fee:
  podem exigir categoria

payment, transfer, income e card_payment:
  não são gastos categorizáveis
```

Pagamentos não entram na fila de categoria. A análise de gastos não os inclui. O detalhe individual ainda pode exibir sua natureza e origem.

## 6. Categorias e taxonomia

Tocar:

- `packages/ledger/src/categories.ts`;
- `packages/db/src/category-labels.ts`;
- `packages/agent/agent/lib/category-scope.ts`;
- `apps/web/components/review-queue.tsx`;
- `apps/web/components/transaction-table.tsx`.

Criar conceitos ou política de migração para:

- `services`;
- `transfers`;
- `other`;
- `education`.

Os rótulos devem ser sempre obtidos do conceito. A interface nunca deve renderizar o slug diretamente quando existir um título localizado.

Adicionar criação de categoria com aprovação:

1. usuário solicita ou seleciona “Criar categoria”;
2. Clara propõe slug, título e descrição;
3. usuário aprova;
4. `save_concept` grava no bundle `learnings`;
5. categoria passa a aparecer na revisão;
6. recategorização ocorre em ação separada e auditada.

## 7. Registro de capacidades

Criar um registro interno:

```ts
type Capability = {
  id: string;
  description: string;
  inputSchema: unknown;
  outputSchema: unknown;
  mode: "read" | "write" | "analysis";
  approval: "none" | "user";
  supportsSandboxFallback: boolean;
};
```

Capacidades iniciais:

- `ledger.total_spend`;
- `ledger.aggregate_by_category`;
- `ledger.compare_periods`;
- `ledger.series`;
- `ledger.recurring_charges`;
- `invoice.propose`;
- `invoice.commit`;
- `review.transaction`;
- `knowledge.create_category`;
- `analysis.run_script`.

A Clara consulta o registro antes de escolher uma ação. Se não houver capacidade, o resultado deve ser `unsupported`, não uma promessa de execução.

## 8. Agentes

### 8.1 Clara

Responsável por conversa, intenção, roteamento, delegação, perguntas e explicação.

Não calcula, não escreve diretamente, não inventa categoria e não afirma sucesso sem recibo.

### 8.2 Extractor

Responsável por interpretar documento, extrair campos, classificar `kind`, medir confiança e persistir staging.

Não acessa o razão, não cria categoria, não confirma lote e não calcula total.

### 8.3 Analyst

Responsável por análises padrão e pela criação de `AnalysisPlan`.

Não faz a conta final em texto, não monta SQL livre e não decide escopo a partir da posição da fatura na conversa.

### 8.4 Categorizer

Responsável por localizar despesas categorizáveis, propor categorias existentes ou novas e registrar incerteza.

Não categoriza pagamentos e não escreve sem aprovação.

### 8.5 Calculator

Novo agente para análises customizadas.

Entrada:

- pergunta do usuário;
- `AnalysisPlan`;
- snapshot autorizado;
- capacidades disponíveis.

Saída:

- plano ou script;
- schema de entrada;
- schema de saída;
- fórmula;
- premissas;
- validações esperadas.

O Calculator não acessa banco, filesystem, rede ou tools.

## 9. Tools

### 9.1 Reaproveitar e corrigir

- `query_ledger`;
- `aggregate_by_category`;
- `compare_periods`;
- `analyze_series`;
- `detect_recurrences`;
- `list_review_queue`;
- `mark_reviewed`;
- `recategorize_transactions`;
- `save_concept`;
- `propose_batch_from_extraction`;
- `commit_batch`;
- `edit_proposed_batch`;
- `read_batch`;
- `read_tool_events`.

### 9.2 Novas tools

#### `list_capabilities`

Retorna capacidades disponíveis, schemas, permissões e requisitos.

#### `prepare_analysis_snapshot`

Recebe um escopo validado e cria uma referência somente leitura:

```ts
{
  snapshotId,
  scope,
  rowCount,
  columns,
  transactionIds,
  expiresAt
}
```

#### `create_analysis_plan`

Retorna dataset, escopo, filtros, dimensões, medidas, transformações e saída esperada.

#### `run_sandbox_analysis`

Executa plano ou script sobre snapshot autorizado.

#### `validate_analysis_result`

Verifica schema, unidade, escopo, limites, IDs e invariantes.

#### `get_analysis_run`

Consulta status de execução assíncrona.

#### `cancel_analysis_run`

Interrompe execução ativa.

## 10. Analysis Runtime

Criar pacote:

```text
packages/analysis-runtime/
  src/plan.ts
  src/execute-plan.ts
  src/validate-result.ts
  src/provenance.ts
  src/units.ts
  src/errors.ts
```

Contrato:

```ts
type AnalysisPlan = {
  version: 1;
  dataset: "ledger";
  scope: PeriodScope;
  filters: Filter[];
  dimensions: Dimension[];
  measures: Measure[];
  transformations: Transformation[];
};

type AnalysisResult = {
  version: 1;
  status: "success" | "partial" | "failed";
  metrics: Metric[];
  tables: Table[];
  formula: string;
  assumptions: string[];
  provenance: string[];
  checks: ValidationCheck[];
};
```

Operações iniciais:

- soma;
- diferença;
- proporção;
- multiplicação;
- agrupamento;
- ordenação;
- filtros;
- séries temporais;
- cenários;
- comparação;
- cálculo anualizado.

A DSL deve ser o caminho padrão. Scripts são o fallback para análises que a DSL ainda não cobre.

## 11. Sandbox

O sandbox deve ser um serviço separado do Next/Eve.

Não usar como fronteira de segurança:

- `eval` dentro do processo web;
- `node:vm` sem isolamento externo;
- `bash` com entrada do modelo;
- SQL livre;
- acesso direto ao banco;
- secrets;
- rede aberta;
- instalação dinâmica de pacotes.

Usar worker isolado, container rootless ou runtime WASM, com:

- filesystem temporário;
- rede desabilitada;
- limite de CPU;
- limite de memória;
- timeout;
- limite de tamanho do código;
- limite de tamanho do resultado;
- hash do script;
- runtime versionado;
- encerramento forçado;
- logs sem dados financeiros desnecessários.

O script recebe apenas snapshot e metadados:

```json
{
  "rows": [],
  "metadata": {
    "scope": "...",
    "currency": "BRL",
    "unit": "cents"
  }
}
```

O resultado deve conter métricas, tabelas, fórmula, premissas, IDs de transação e avisos.

Nenhum script pode alterar o razão.

## 12. Banco e migração

Criar migração segura para:

- normalizar `categories/*`;
- garantir categoria sem `/`;
- criar labels ausentes;
- registrar versão de normalização;
- preservar a trilha de alterações;
- separar análises de artefatos de conversa.

Criar estruturas para:

```text
analysis_runs
analysis_snapshots
analysis_results
analysis_validations
```

Cada execução precisa guardar tenant, sessão, objetivo, plano, hash, runtime, status, duração, erro, resultado, expiração e proveniência.

Manter a separação conceitual:

- `agent_artifacts`: comunicação interna entre agentes;
- `conversation_artifacts`: resultado visível, apresentado como Detalhes.

Não remover dados históricos sem compatibilidade e rollback.

## 13. Estado da conversa

Criar estados explícitos:

```text
idle
processing_document
draft_ready
awaiting_decision
confirmed
reviewing
running_analysis
analysis_ready
needs_input
unsupported
failed
```

Persistir:

- documento ativo;
- lote ativo;
- objetivo atual;
- decisão pendente;
- execução analítica;
- último resultado;
- próximas ações possíveis.

O usuário pode mudar de assunto, responder uma decisão ou retomar uma análise sem reiniciar a conversa.

## 14. Interface

Tocar:

- `apps/web/components/chat.tsx`;
- `apps/web/components/view-panel.tsx`;
- `apps/web/components/decision-card.tsx`;
- `apps/web/components/review-queue.tsx`;
- `apps/web/components/transaction-table.tsx`;
- `apps/web/components/nav-bar.tsx`;
- `apps/web/app/(app)/conversa`;
- `apps/web/app/(app)/transacoes`;
- `apps/web/app/(app)/revisar`;
- `apps/web/app/(app)/comparacao`;
- `apps/web/app/globals.css`.

Estrutura única:

```text
body
  └── app-shell
      ├── header
      ├── main
      │   ├── chat-column
      │   └── details-column
      └── mobile-details
```

O scroll deve pertencer a uma coluna conhecida. Auditar todas as ocorrências de `100vh`, `min-height`, `overflow`, `position: fixed` e `position: sticky`.

Testar em 390, 768, 1024 e 1440 pixels.

## 15. Pacotes de implementação

### Pacote A — contratos financeiros

Tipos branded, schemas, normalização de categoria, validação de pagamento, escopo e testes unitários.

### Pacote B — migração de dados

Backfill de categorias, labels, histórico de alterações e relatório de registros modificados.

### Pacote C — Analysis Runtime

`AnalysisPlan`, DSL, executor, validação, unidades e proveniência.

### Pacote D — sandbox

Worker, API, limites, isolamento, hash, logs e cancelamento.

### Pacote E — capability registry

Registro de tools, schemas, permissões, pré-condições e fallback para sandbox.

### Pacote F — agentes

Prompts menores, contexto estruturado, Calculator, delegação, output schemas e recuperação de erro.

### Pacote G — conversa

Estado persistido, retomada, foco, decisões não bloqueantes e tratamento de falhas.

### Pacote H — interface

Shell, chat, Detalhes, revisão, comparação, estados de erro, mobile, acessibilidade e overflow.

### Pacote I — avaliação ponta a ponta

Fixtures, testes de upload, aprovação, pagamentos, categorias, scripts, comparação, mobile, retomada e falhas.

## 16. Suíte de aceitação

A V1 somente será aceita quando estes cenários passarem:

1. enviar fatura Nubank;
2. conferir total;
3. confirmar lote;
4. perguntar gasto total;
5. identificar categoria principal;
6. comparar duas faturas;
7. analisar três períodos;
8. excluir pagamento do gasto;
9. abrir um pagamento individualmente;
10. deixar lançamento sem categoria;
11. criar categoria nova;
12. recategorizar lançamento;
13. executar uma análise que exige script;
14. rejeitar script inválido;
15. interromper script;
16. responder ação não suportada;
17. recarregar durante processamento;
18. recuperar após falha;
19. abrir Detalhes no mobile;
20. operar no desktop sem overflow;
21. consultar a origem de qualquer número;
22. provocar divergência de checksum;
23. corrigir divergência;
24. continuar a conversa depois de uma decisão.

## 17. Critérios de pronto

- zero categoria persistida com prefixo `categories/`;
- zero pagamento na fila de categorização;
- zero cálculo feito pela interface;
- todos os resultados numéricos com escopo e proveniência;
- nenhum resultado com `NaN` ou `Infinity`;
- nenhum script com acesso ao banco ou rede;
- nenhum write via sandbox;
- nenhum sucesso anunciado sem recibo da tool;
- nenhuma tela com overflow conhecido nos viewports suportados;
- estado preservado após refresh;
- falhas exibidas com ação de recuperação;
- suite de cálculo verde;
- suite de contrato das tools verde;
- suite de sandbox verde;
- suite visual desktop/mobile verde;
- avaliação com faturas reais anonimizadas verde.

## 18. Ordem de implementação

1. congelar a experiência atual;
2. escrever contratos e critérios de aceitação;
3. corrigir categoria, pagamento e escopo;
4. criar migração e backfill;
5. criar `AnalysisPlan` e executor determinístico;
6. criar capability registry;
7. criar sandbox e validação;
8. refatorar agentes e prompts;
9. implementar estado conversacional;
10. reconstruir a interface V1;
11. conectar upload, análise, revisão e Detalhes;
12. executar avaliação ponta a ponta;
13. ativar V1 por feature flag;
14. manter rollback para a experiência legada;
15. remover componentes legados somente após paridade.

## 19. Resultado esperado

A V1 não será definida pelo número de agentes ou tools. Ela será definida por uma conversa que:

- não trava;
- não inventa;
- não mistura períodos;
- não confunde pagamento com gasto;
- não exibe identificadores internos como resposta final;
- consegue responder uma análise nova via sandbox;
- explica fórmula e premissas;
- permite conferir qualquer número;
- recupera-se de falhas;
- funciona no desktop e no mobile.

A decisão final é manter Eve como camada flexível de coordenação, construir um Financial Kernel tipado e adicionar um Analysis Runtime sandboxado. A V1 deve ser menor que a visão completa da Clara, mas confiável em todo o caminho que decidir suportar.
