import { env } from "@clara-financas/env/web";

import { Chat } from "@/components/chat";
import { loadFollowups, loadStarters } from "@/lib/starters";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function ConversaPage() {
  const context = await getTenantContext();

  // No modo silo o host vem do registry, por tenant. Nas Etapas 0–3 há uma
  // instância só, então cai no host único do env.
  const agentHost = context?.agentHost ?? env.NEXT_PUBLIC_AGENT_HOST;
  const firstName = context?.name?.split(" ")[0] ?? null;

  // Os atalhos são derivados no SERVIDOR, junto da página. Passá-los prontos
  // evita um segundo round-trip só para descobrir o que oferecer, e mantém a
  // consulta ao razão do lado que já tem o escopo do tenant.
  const [starters, followups] = context
    ? await Promise.all([loadStarters(context.tenantId), loadFollowups(context.tenantId)])
    : [[], []];

  return (
    <Chat
      agentHost={agentHost}
      name={firstName}
      starters={starters}
      followups={followups}
      // Chave do armazenamento LOCAL de conversas (retomada por dispositivo).
      // O tenantId não é segredo para o próprio usuário — ele já viaja como
      // claim no JWT que o navegador segura.
      tenantKey={context?.tenantId ?? "anon"}
    />
  );
}
