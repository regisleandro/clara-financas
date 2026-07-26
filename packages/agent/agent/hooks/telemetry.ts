import { telemetryHook } from "../lib/telemetry-hook";

/**
 * O hook da coordenadora. O corpo mora em `lib/telemetry-hook.ts` porque cada
 * subagente instala o MESMO hook no próprio `hooks/` — subagente declarado não
 * herda nada do root, e um hook só no root deixava o extrator (o componente
 * mais frágil) invisível na telemetria.
 */
export default telemetryHook();
