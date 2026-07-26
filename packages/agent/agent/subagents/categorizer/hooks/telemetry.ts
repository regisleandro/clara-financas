import { telemetryHook } from "../../../lib/telemetry-hook";

// Subagente não herda hooks do root: sem esta linha, a triagem do guarda-livros
// rodava sem deixar rastro em agent_tool_events.
export default telemetryHook();
