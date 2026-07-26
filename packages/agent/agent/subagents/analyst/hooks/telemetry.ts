import { telemetryHook } from "../../../lib/telemetry-hook";

// Subagente não herda hooks do root: sem esta linha, as consultas do analista
// rodavam sem deixar rastro em agent_tool_events.
export default telemetryHook();
