import { McpServer } from '@modelcontextprotocol/server';

import { SERVER_INFO } from '../config/server-info.js';
import { registerResources } from '../resources/index.js';
import { registerTools } from '../tools/index.js';

import type { World } from '../world/world.js';

export function createServer(world: World): McpServer {
  const server = new McpServer(SERVER_INFO);
  registerTools(server, world);
  registerResources(server, world);
  return server;
}
