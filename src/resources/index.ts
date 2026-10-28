import type { McpServer } from '@modelcontextprotocol/server';

import { registerBlockResources } from './block-resources.js';
import {
  registerDimensionIndexResource,
  registerDimensionResources
} from './dimension-resources.js';
import { registerEntityResources } from './entity-resources.js';
import { registerItemResources } from './item-resources.js';

import type { World } from '../world/world.js';

/** Register every static registry resource and the live dimension resources. */
export function registerResources(server: McpServer, world: World): void {
  registerBlockResources(server);
  registerItemResources(server);
  registerEntityResources(server);
  registerDimensionIndexResource(server, world);
  registerDimensionResources(server, world);
}
