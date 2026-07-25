---
type: Convention
title: Schema da transação
description: Campos mínimos de toda transação registrada no razão.
status: stable
---

Toda transação registrada carrega:

| Campo | Significado |
| --- | --- |
| `date` | Data da compra, não a do fechamento da fatura |
| `originalDescription` | O texto exatamente como aparece no documento |
| `merchant` | Comerciante resolvido, quando reconhecido |
| `amount` | Valor em centavos, para não haver erro de arredondamento |
| `installment` | Parcela, quando houver (ex.: 3/12) |
| `category` | Categoria de [/categories](/categories/groceries.md) |
| `extractionConfidence` | `alta`, `média` ou `baixa` |
| `sourceDocument` + `page` | Origem, para a proveniência funcionar |

Regra de ouro da extração: **campo ilegível é campo incerto, nunca valor
inventado.** É preferível uma transação marcada como duvidosa a um número
errado que parece certo.

O razão é imutável por edição: correção gera linha de ajuste referenciando a
original. É o que torna todo número reproduzível.
