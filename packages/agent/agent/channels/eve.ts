import { eveChannel } from "eve/channels/eve";
import { localDev, placeholderAuth, vercelOidc } from "eve/channels/auth";

/**
 * Canal HTTP do agente.
 *
 * Topologia: o agente NÃO é montado dentro do app Next (`withEve`). Ele roda
 * como deployment próprio e o navegador fala com ele cross-origin. Isso é
 * exigência do modelo silo (um projeto Vercel por tenant) e foi validado no
 * spike da Etapa 0: preflight e POST cross-origin funcionam, e uma origem não
 * declarada é bloqueada pelo navegador.
 *
 * TODO(Etapa 0): trocar a cadeia de auth por `tenantToken()` — verifica o JWT
 * ECDSA emitido pelo control plane e confere o claim `tenantId` contra
 * `process.env.TENANT_ID`, além da ACL de posse de sessão sobre
 * `/eve/v1/session/:id[/stream|/cancel]`. O spike confirmou que o AuthFn
 * enxerga a URL completa em todas as rotas protegidas, inclusive `cancel`.
 */
export default eveChannel({
  cors: {
    origin: process.env.APP_ORIGIN ?? "http://localhost:3000",
    methods: ["GET", "POST"],
    allowedHeaders: ["authorization", "content-type"],
  },
  auth: [
    // Permite que a TUI do eve e deployments Vercel alcancem o agente.
    vercelOidc(),
    // Aberto em localhost para `eve dev` e o REPL; ignorado em produção.
    localDev(),
    // Placeholder: devolve 401 em produção. Sai quando `tenantToken()` entrar.
    placeholderAuth(),
  ],
});
