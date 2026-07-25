import "server-only";

import { getAuth } from "@clara-financas/auth";
import { getDb } from "@clara-financas/db";
import { provisioningJobs, tenants, type TenantStatus } from "@clara-financas/db/schema/tenant";
import { constitutionVersion, seedConstitution } from "@clara-financas/db/seed-constitution";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";

export type TenantContext = {
  userId: string;
  /** Nome de exibição, para a saudação da Visão geral. */
  name: string | null;
  tenantId: string;
  status: TenantStatus;
  agentHost: string | null;
};

function slugify(email: string) {
  const base = email.split("@")[0] ?? "user";
  return base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
}

/**
 * Garante que o usuário autenticado tenha exatamente um tenant.
 *
 * Um índice único em `owner_user_id` faz o trabalho pesado: um segundo login
 * com a mesma conta Google reusa o espaço em vez de provisionar outro. Se a
 * corrida acontecer mesmo assim, o `onConflictDoNothing` + releitura resolve.
 *
 * Etapas 0–3 (modo pool): provisionamento é instantâneo — cria a linha já como
 * 'ready'. Etapa 4 (silo): passa a enfileirar um provisioning_job e nascer
 * 'provisioning', sem que a UI precise mudar.
 */
export async function ensureTenant(
  userId: string,
  email: string,
  name: string | null = null,
): Promise<TenantContext> {
  const existing = await getDb().query.tenants.findFirst({
    where: eq(tenants.ownerUserId, userId),
  });

  if (existing) {
    // A constituição é editada direto no repositório. Sem esta verificação, a
    // edição só chegaria a contas novas — e quem já tinha conta continuaria
    // vendo uma taxonomia antiga sem saber por quê.
    const version = await constitutionVersion();
    if (existing.constitutionVersion !== version) {
      await seedConstitution(existing.id);
      await getDb()
        .update(tenants)
        .set({ constitutionVersion: version })
        .where(eq(tenants.id, existing.id));
    }

    return {
      userId,
      name,
      tenantId: existing.id,
      status: existing.status,
      agentHost: existing.agentHost,
    };
  }

  const id = `tnt_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const slug = `${slugify(email)}-${id.slice(-6)}`;

  await getDb()
    .insert(tenants)
    .values({
      id,
      ownerUserId: userId,
      slug,
      // MODO POOL: pronto de imediato. Ver comentário acima.
      status: "ready",
      provisionedAt: new Date(),
    })
    .onConflictDoNothing();

  const created = await getDb().query.tenants.findFirst({
    where: eq(tenants.ownerUserId, userId),
  });

  if (!created) throw new Error("Falha ao criar o tenant do usuário.");

  // A constituição é copiada para o espaço do tenant no nascimento. É
  // idempotente, então uma corrida entre duas requisições não duplica nada.
  await seedConstitution(created.id);
  await getDb()
    .update(tenants)
    .set({ constitutionVersion: await constitutionVersion() })
    .where(eq(tenants.id, created.id));

  return {
    userId,
    name,
    tenantId: created.id,
    status: created.status,
    agentHost: created.agentHost,
  };
}

/** Sessão + tenant do usuário atual, ou null se não autenticado. */
export async function getTenantContext(): Promise<TenantContext | null> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  return ensureTenant(session.user.id, session.user.email, session.user.name ?? null);
}

/** Último job de provisionamento, para a tela /preparando. */
export async function getProvisioningJob(tenantId: string) {
  return getDb().query.provisioningJobs.findFirst({
    where: eq(provisioningJobs.tenantId, tenantId),
    orderBy: (jobs, { desc }) => [desc(jobs.createdAt)],
  });
}
