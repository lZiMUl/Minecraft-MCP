import type { McpServer } from '@modelcontextprotocol/server';

import { registerBlockTools } from './block-tools.js';
import { registerEntityTools } from './entity-tools.js';
import { registerItemTools } from './item-tools.js';
import { registerWorldTools } from './world-tools.js';

import type { World } from '../world/world.js';

/** Register every tool exposed by the server. */
export function registerTools(server: McpServer, world: World): void {
  registerBlockTools(server, world);
  registerItemTools(server);
  registerWorldTools(server, world);
  registerEntityTools(server, world);
}
