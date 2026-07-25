import { SignJWT } from "jose";
const BASE = "http://127.0.0.1:2000";
const token = await new SignJWT({ tenantId: "tnt_e2e_probe", userId: "usr_e2e_probe" })
  .setProtectedHeader({ alg: "HS256" }).setSubject("usr_e2e_probe")
  .setIssuer(process.env.APP_ORIGIN).setAudience("clara-agent")
  .setIssuedAt().setExpirationTime("30m")
  .sign(new TextEncoder().encode(process.env.AGENT_TOKEN_SECRET));
const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
const res = await fetch(`${BASE}/eve/v1/session`, { method: "POST", headers, body: JSON.stringify({
  message: "Onde eu mais gastei? Use o analista." })});
const sid = res.headers.get("x-eve-session-id");
const stream = await fetch(`${BASE}/eve/v1/session/${sid}/stream`, { headers });
const reader = stream.body.getReader(); const dec = new TextDecoder();
let buf = ""; const seen = new Map(); const deadline = Date.now() + 240000;
while (Date.now() < deadline) {
  const { done, value } = await reader.read(); if (done) break;
  buf += dec.decode(value, { stream: true });
  const lines = buf.split("\n"); buf = lines.pop() ?? "";
  for (const l of lines) { if (!l.trim()) continue;
    let e; try { e = JSON.parse(l); } catch { continue; }
    if (e.type === "message.appended") { seen.set(e.type, (seen.get(e.type)??0)+1); continue; }
    if (!seen.has(e.type)) { seen.set(e.type, 1); console.log("### " + e.type + "\n" + JSON.stringify(e.data).slice(0, 420) + "\n"); }
    else seen.set(e.type, seen.get(e.type)+1);
    if (e.type === "session.waiting") { reader.cancel().catch(()=>{});
      console.log("=== contagem por tipo ==="); for (const [k,v] of seen) console.log("  " + k + ": " + v);
      process.exit(0); }
  }
}
