import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

/**
 * O agente eve NÃO é montado aqui via `withEve`.
 *
 * Motivo (spike da Etapa 0): `withEve` monta o eve dentro deste app, na mesma
 * origem. No modelo silo cada tenant tem seu próprio deployment do agente,
 * separado do control plane — então o cliente fala com ele cross-origin, via
 * `useEveAgent({ host, auth: { bearer } })`. Usar `withEve` agora obrigaria a
 * reescrever essa integração na Etapa 4.
 *
 * Este app é o control plane: UI, identidade e o registry de tenants.
 */
const nextConfig: NextConfig = {
  transpilePackages: [
    "@clara-financas/ui",
    "@clara-financas/auth",
    "@clara-financas/db",
    "@clara-financas/env",
  ],
  // A constituição é lida do DISCO em runtime (`loadBundle` faz readdir em
  // `bundles/constitution`), e o rastreamento de arquivos do Next só enxerga o
  // que aparece num `import`. Resultado num deploy real: todo login caía em
  // 500 com `ENOENT: scandir '/var/task/bundles/constitution'` — a pasta
  // estava no repositório, mas nunca entrava no bundle da função.
  //
  // A chave é `"/"` porque o Next casa o glob com `contains: true`: toda rota
  // contém "/". Isso é proposital — `getTenantContext` semeia a constituição, e
  // ele roda no layout protegido, em /preparando e nas rotas de API. Restringir
  // a `/inicio` só adiaria o mesmo ENOENT para a próxima superfície.
  //
  // `outputFileTracingRoot` fixa a raiz do monorepo: sem ela o Next infere, e é
  // essa raiz que vira `/var/task` — ou seja, o que mantém o `../../../bundles`
  // calculado em `seed-constitution.ts` apontando para o lugar certo lá.
  outputFileTracingRoot: resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
  outputFileTracingIncludes: {
    "/": ["../../bundles/constitution/**/*"],
  },
};

export default nextConfig;
