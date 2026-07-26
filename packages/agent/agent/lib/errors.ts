/**
 * Como uma tool diz que não deu.
 *
 * Antes havia três estilos convivendo: `{ error: "slug_estruturado" }` com
 * contexto, `{ error: "uma frase solta em português" }` sem código, e exceção
 * lançada. Três consequências, todas observadas:
 *
 * 1. **A interface não distingue recuperação de quebra.** `deriveActivity`
 *    pinta de vermelho qualquer `output.error` — inclusive os casos desenhados
 *    para o modelo tentar outro caminho (`alcance_alterado`,
 *    `recorte_incompleto`). A pessoa vê "falhou" onde o sistema funcionou.
 * 2. **O modelo não sabe o que fazer em seguida.** Uma frase em português diz
 *    o que houve, não qual porta abrir. `hint` diz — e nomeia a tool.
 * 3. **Nada disso é catalogável.** Sem `code`, não dá para contar, alertar nem
 *    testar; a mensagem que a pessoa lê acaba improvisada pelo modelo, e muda
 *    a cada turno.
 *
 * O formato é sempre `{ error: { code, message, hint?, retryable } }`.
 * `message` é para a pessoa, em português; `hint` é para o modelo, e diz o
 * próximo passo executável.
 */

export type ToolErrorCode =
  | "lote_nao_encontrado"
  | "lote_ja_decidido"
  | "lote_ja_registrado"
  | "documento_nao_encontrado"
  | "documento_ja_registrado"
  | "extracao_nao_encontrada"
  | "rascunho_editado"
  | "compromisso_nao_encontrado"
  | "conceito_nao_encontrado"
  | "categoria_desconhecida"
  | "alcance_alterado"
  | "recorte_incompleto"
  | "lancamento_nao_encontrado"
  | "nenhuma_alteracao"
  | "operacao_nao_permitida"
  | "credencial_invalida"
  | "senha_necessaria"
  | "proposta_nao_encontrada"
  | "proposta_ja_decidida"
  | "proposta_expirada"
  | "proposta_desatualizada"
  | "fatura_sem_divergencia";

export type ToolError = {
  error: {
    code: ToolErrorCode;
    message: string;
    hint?: string;
    /**
     * `true` quando existe um próximo passo que resolve — o pedido estava
     * errado, não o sistema. A interface mostra isso como aviso, não como
     * etapa quebrada.
     */
    retryable: boolean;
  };
};

type Options = { hint?: string; retryable?: boolean };

export function toolError(
  code: ToolErrorCode,
  message: string,
  options: Options = {},
): ToolError {
  return {
    error: {
      code,
      message,
      ...(options.hint !== undefined ? { hint: options.hint } : {}),
      // O padrão é recuperável: a maioria esmagadora destes casos é pedido
      // desalinhado com o estado do banco, e o modelo tem outra tool para
      // tentar. Quebra de verdade é a exceção, e se declara.
      retryable: options.retryable ?? true,
    },
  };
}

/** Açúcar para o caso mais comum: o alvo do pedido não existe. */
export function notFound(
  code: ToolErrorCode,
  message: string,
  options: Options = {},
): ToolError {
  return toolError(code, message, options);
}

/** O pedido é impossível no estado atual e nenhuma repetição resolve. */
export function refused(
  code: ToolErrorCode,
  message: string,
  options: Omit<Options, "retryable"> = {},
): ToolError {
  return toolError(code, message, { ...options, retryable: false });
}
