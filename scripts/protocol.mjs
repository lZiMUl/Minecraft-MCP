/**
 * Shared helpers for the MCP 2026-07-28 ("modern") wire protocol.
 *
 * A modern session starts with `server/discover` instead of the legacy
 * `initialize` handshake, and every request must carry the per-request
 * envelope in `params._meta`:
 *
 *   io.modelcontextprotocol/protocolVersion
 *   io.modelcontextprotocol/clientInfo        (recommended, not required)
 *   io.modelcontextprotocol/clientCapabilities (required)
 */
export const PROTOCOL_VERSION = "2026-07-28";

export function clientEnvelope(clientName, capabilities = {}) {
  return {
    "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
    "io.modelcontextprotocol/clientInfo": { name: clientName, version: "1.0" },
    "io.modelcontextprotocol/clientCapabilities": capabilities,
  };
}

export function discoverRequest(id, clientName) {
  return {
    jsonrpc: "2.0",
    id,
    method: "server/discover",
    params: { _meta: clientEnvelope(clientName) },
  };
}
