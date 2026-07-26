import { sealInput } from "@clara-financas/auth/sealed-input";
import { env } from "@clara-financas/env/server";
import { z } from "zod";

import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  requestId: z.string().min(1),
  password: z.string().min(1).max(512),
});

const TOKEN_TTL_MS = 10 * 60 * 1000;

/**
 * Converte a senha em um envelope autenticado de vida curta.
 *
 * O browser recebe apenas o token cifrado. O coordenador pode encaminhá-lo,
 * mas somente a tool de leitura do PDF o abre, já sob o escopo do tenant.
 */
export async function POST(request: Request) {
  const context = await getTenantContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (context.status !== "ready") {
    return Response.json({ error: "tenant_not_ready" }, { status: 409 });
  }

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid_password_request" }, { status: 400 });
  }

  const token = await sealInput(
    {
      tenantId: context.tenantId,
      requestId: parsed.data.requestId,
      purpose: "pdf_password",
      value: parsed.data.password,
      expiresAt: Date.now() + TOKEN_TTL_MS,
    },
    env.AGENT_TOKEN_SECRET,
  );

  return Response.json({ token, expiresIn: TOKEN_TTL_MS / 1000 });
}
