---
type: Convention
title: Política de conferência
description: Como a soma das transações extraídas é confrontada com o total declarado.
status: stable
---

O documento carrega a própria prova: a fatura declara o total. Somamos as
transações extraídas e confrontamos.

- **Bateu** — o lote é validado matematicamente. Selo verde no cartão.
- **Divergiu** — o cartão abre destacando a diferença em valor e os itens de
  menor confiança, que são os candidatos prováveis.
- **Sem total declarado** — o cartão sinaliza que a conferência é integralmente
  humana.

## O que compõe o total

Nem todo lançamento da fatura compõe o total dela:

- **Compras e encargos entram.** São o gasto do período.
- **Estornos entram**, com valor negativo: são crédito contra uma compra do
  próprio período.
- **O pagamento da fatura anterior NÃO entra.** Ele aparece na lista de
  lançamentos, mas quita o ciclo passado — não é gasto deste.

Essa distinção não é detalhe. Numa fatura real de R$ 4.387,92, somar o
pagamento produzia uma divergência de R$ 3.251,62 — exatamente o valor dele —
que parecia erro de extração e era erro de interpretação.

Ver também [o schema da transação](/conventions/transaction-schema.md).
