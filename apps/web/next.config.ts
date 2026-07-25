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
};

export default nextConfig;
