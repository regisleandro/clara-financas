import { formatCents, totalSpend } from "@clara-financas/ledger";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { requireTenantCaller } from "../../../lib/tenant";
import { optionalText } from "../../../lib/schema";
import { brief, loadLedger } from "../lib/query";

/**
 * Consulta de transações específicas.
 *
 * É a tool que responde "de onde veio esse valor": recebe os ids que outra
 * análise devolveu e mostra as linhas por trás do número.
 */
const LIMIT = 100;

export default defineTool({
  description:
    "Lista transações do razão, por período, texto ou ids. Use para detalhar de onde veio um número, ou para responder perguntas sobre lançamentos específicos.",
  inputSchema: z.object({
    transactionIds: z
      .array(z.string())
      .optional()
      .describe("IDs devolvidos por outra análise. Use para detalhar um número."),
    from: optionalText().describe("Data inicial, YYYY-MM-DD."),
    to: optionalText().describe("Data final, YYYY-MM-DD, inclusive."),
    search: optionalText().describe("Texto na descrição ou no comerciante."),
    category: optionalText().describe("Filtra por categoria."),
    uncategorizedOnly: z
      .boolean()
      .optional()
      .describe("Só transações ainda sem categoria."),
  }),
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);

    // O filtro por data vai ao banco; o resto é em memória, porque o volume de
    // um razão pessoal cabe folgadamente e evita montar SQL dinâmico aqui.
    let rows = await loadLedger(tenantId, { from: input.from, to: input.to });

    if (input.transactionIds !== undefined && input.transactionIds.length > 0) {
      const wanted = new Set(input.transactionIds);
      rows = rows.filter((row) => wanted.has(row.id));
    }
    if (input.category !== undefined) {
      rows = rows.filter((row) => row.category === input.category);
    }
    if (input.uncategorizedOnly === true) {
      rows = rows.filter((row) => row.category === null);
    }
    if (input.search !== undefined) {
      const needle = input.search.toLowerCase();
      rows = rows.filter(
        (row) =>
          row.originalDescription.toLowerCase().includes(needle) ||
          (row.merchant ?? "").toLowerCase().includes(needle),
      );
    }

    const total = totalSpend(rows);
    const truncated = rows.length > LIMIT;

    return {
      matched: rows.length,
      truncated,
      // Dizer que truncou importa: sem isso o modelo apresentaria um recorte
      // parcial como se fosse o conjunto inteiro.
      note: truncated ? `Mostrando as ${LIMIT} primeiras de ${rows.length}.` : undefined,
      total: { cents: total.value, formatted: formatCents(total.value) },
      transactions: rows.slice(0, LIMIT).map(brief),
    };
  },
});
