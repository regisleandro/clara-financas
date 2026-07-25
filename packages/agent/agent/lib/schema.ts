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
