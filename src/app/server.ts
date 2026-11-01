import { McpServer } from '@modelcontextprotocol/server';

import { SERVER_INFO } from '../config/server-info.js';
import { registerResources } from '../resources/index.js';
import { registerTools } from '../tools/index.js';
import { instrumentToolCalls } from './tool-events.js';

import type { ToolCallListener } from './tool-events.js';
import type { World } from '../world/world.js';

/** Optional hooks used when assembling a server. */
export interface ICreateServerOptions {
  /** Invoked after every tool call settles (used to fan out over WebSocket). */
  readonly onToolCall?: ToolCallListener;
}

/** Assemble a fresh MCP server around one loaded world. */
export function createServer(
  world: World,
  options?: ICreateServerOptions
): McpServer {
  const server = new McpServer(SERVER_INFO);

  // Instrument before registration so every tool (present and future) is
  // observed without touching the individual tool modules.
  const onToolCall = options?.onToolCall;
  if (onToolCall) {
    instrumentToolCalls(server, onToolCall);
  }

  registerTools(server, world);
  registerResources(server, world);
  return server;
}
