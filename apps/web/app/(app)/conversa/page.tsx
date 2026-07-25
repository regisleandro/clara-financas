import { env } from "@clara-financas/env/web";

import { Chat } from "@/components/chat";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function ConversaPage() {
  const context = await getTenantContext();

  // No modo silo o host vem do registry, por tenant. Nas Etapas 0–3 há uma
  // instância só, então cai no host único do env.
  const agentHost = context?.agentHost ?? env.NEXT_PUBLIC_AGENT_HOST;

  return (
    <>
      <section>
        <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground">CONVERSA</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Fale com a Clara.</h1>
      </section>

      <div className="mt-8">
        <Chat agentHost={agentHost} />
      </div>
    </>
  );
}
