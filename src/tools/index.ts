import type { McpServer } from '@modelcontextprotocol/server';

import { registerBlockTools } from './block-tools.js';
import { registerItemTools } from './item-tools.js';

import type { World } from '../world/world.js';

export function registerTools(server: McpServer, world: World): void {
  registerBlockTools(server, world);
  registerItemTools(server);
}
