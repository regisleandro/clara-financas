import { loadTransactionsByIds } from "@clara-financas/db/queries/transactions";
import { z } from "zod";

import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * O teto é de PÁGINA, não do pedido.
 *
 * `ids.max(PROVENANCE_LIMIT)` transformava "esta linha tem 120 lançamentos" em
 * 400, e a tela dizia "não consegui abrir os lançamentos agora". A conferência
 * falhava justamente onde o número era maior — que é onde alguém mais quer
 * conferir. O limite de 2000 continua existindo como proteção contra pedido
 * absurdo, não como recusa de caso legítimo.
 */
const BodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(2000),
  offset: z.number().int().nonnegative().default(0),
});

/**
 * Os lançamentos por trás de uma linha do painel.
 *
 * Existe para fechar a promessa do produto — "todo número deve poder ser
 * conferido". A proveniência já viajava em cada linha e não tinha para onde
 * levar: a interface recebia os ids e não sabia o que fazer com eles.
 *
 * É leitura determinística, sem modelo no caminho: perguntar à Clara "quais
 * lançamentos formam esses R$ 1.240,00" gastaria um turno inteiro para
 * reconstituir o que os ids já dizem — e poderia responder outra coisa.
 *
 * O tenant vem SEMPRE da sessão. Um id de outro tenant simplesmente não
 * aparece no resultado, porque a RLS filtra na própria query.
 */
export async function POST(request: Request) {
  const context = await getTenantContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (context.status !== "ready") {
    return Response.json({ error: "tenant_not_ready" }, { status: 409 });
  }

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid_transaction_request" }, { status: 400 });
  }

  const { ids, offset } = parsed.data;
  const unique = [...new Set(ids)].length;
  const entries = await loadTransactionsByIds(context.tenantId, ids, undefined, offset);

  return Response.json({
    entries,
    // Pedir 12 ids e receber 9 não é detalhe: significa que algo saiu do razão
    // (lote descartado, por exemplo), e a tela precisa poder dizer isso em vez
    // de mostrar uma lista mais curta como se fosse a conta inteira.
    requested: ids.length,
    offset,
    /** Quantos ids ainda faltam depois desta página. */
    remaining: Math.max(0, unique - offset - entries.length),
  });
}
