import { categorySlug } from "@clara-financas/ledger";
import { z } from "zod";

/**
 * Campo de texto opcional que trata string vazia como ausente.
 *
 * Modelos costumam PREENCHER campos opcionais com `""` em vez de omiti-los —
 * observado na prática: `read_concept` foi chamada com
 * `{ bundle: "constitution", conceptId: "", type: "", prefix: "categories/" }`
 * e os dois campos vazios viraram filtros `= ''`, que não casam com nada. A
 * tool devolveu 0 conceitos existindo 10, e o modelo respondeu com confiança
 * que não havia nenhum.
 *
 * É um erro silencioso e convincente, que é a pior combinação. Normalizar aqui
 * garante que nenhuma tool precise lembrar de fazê-lo.
 */
export function optionalText() {
  return z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      const trimmed = value.trim();
      return trimmed === "" ? undefined : trimmed;
    });
}

/** Igual, mas preservando `null` como valor deliberado (limpar um campo). */
export function nullableText() {
  return z
    .string()
    .nullable()
    .optional()
    .transform((value) => {
      if (value === undefined || value === null) return value ?? undefined;
      const trimmed = value.trim();
      return trimmed === "" ? undefined : trimmed;
    });
}

/**
 * Categoria que ENTRA no razão — sempre como slug, nunca como caminho.
 *
 * O conceito de categoria é identificado pelo caminho no bundle
 * (`categories/entertainment`) e o razão guarda o slug (`entertainment`). O
 * modelo tem as duas formas em mãos: acabou de ler ou criar o conceito, então
 * o caminho é o que está fresco. E `propose_batch` aceitava a categoria com um
 * `z.string()` cru, sem validação nenhuma, gravando o que viesse.
 *
 * Em produção o resultado foi visível de duas maneiras, e a segunda é a grave:
 *
 *  1. o painel exibia `categories/entertainment` sem tradução, porque o rótulo
 *     é procurado por slug;
 *  2. `aggregateByCategory` agrupa pela string, então os lançamentos gravados
 *     de uma forma e da outra viravam DUAS linhas — a mesma categoria dividida
 *     em duas fatias, cada uma com parte do dinheiro.
 *
 * Normalizar no schema, e não no corpo de cada tool, é o que torna impossível
 * esquecer: quando o corpo executa, a forma errada já não existe. A validação
 * contra as categorias que a pessoa tem continua onde estava — aqui é só a
 * identidade, como `issuerKey` faz para operadora.
 */
export function categoryInput() {
  return z
    .string()
    .nullable()
    .optional()
    .transform((value) => {
      if (value === undefined || value === null) return value ?? null;
      const trimmed = value.trim();
      return trimmed === "" ? null : categorySlug(trimmed);
    });
}
