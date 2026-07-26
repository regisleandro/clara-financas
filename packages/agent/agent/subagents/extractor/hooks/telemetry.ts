import { telemetryHook } from "../../../lib/telemetry-hook";

// Subagente não herda hooks do root: sem esta linha, read_pdf_pages e
// save_extraction rodavam sem deixar rastro em agent_tool_events.
export default telemetryHook();
