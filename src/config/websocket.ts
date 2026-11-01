/** Runtime WebSocket service configuration derived from environment variables. */
export interface IWebSocketConfig {
  readonly enabled: boolean;
  readonly host: string;
  readonly port: number;
  readonly path: string;
}

/** Read one environment variable as a trimmed string, or `null` when unset. */
function envString(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Parse a boolean flag; unset or unrecognized values fall back to `fallback`. */
function envFlag(name: string, fallback: boolean): boolean {
  const raw = envString(name);
  if (raw === null) {
    return fallback;
  }
  const normalized = raw.toLowerCase();
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  return fallback;
}

/** Parse a TCP port; anything outside 1-65535 falls back to `fallback`. */
function envPort(name: string, fallback: number): number {
  const raw = envString(name);
  if (raw === null) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535
    ? parsed
    : fallback;
}

/** Parse a listen host; unset falls back to the loopback default. */
function envHost(name: string, fallback: string): string {
  return envString(name) ?? fallback;
}

/** Parse a URL path, ensuring it always starts with a single slash. */
function envPath(name: string, fallback: string): string {
  const raw = envString(name);
  if (raw === null) {
    return fallback;
  }
  return raw.startsWith('/') ? raw : `/${raw}`;
}

/**
 * WebSocket fan-out service configuration.
 *
 * Enabled by default on loopback. Set `MCP_WS_ENABLED=false` to turn it off.
 */
export const WEBSOCKET_CONFIG: IWebSocketConfig = {
  enabled: envFlag('MCP_WS_ENABLED', true),
  host: envHost('MCP_WS_HOST', '127.0.0.1'),
  port: envPort('MCP_WS_PORT', 8765),
  path: envPath('MCP_WS_PATH', '/')
};
