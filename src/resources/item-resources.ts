import type { McpServer } from '@modelcontextprotocol/server';

import { MINECRAFT_ITEMS, MINECRAFT_ITEM_COUNT } from '../data/items.js';
import { MINECRAFT_DATA_VERSION } from '../data/version.js';
import {
  registerDataEntryResources,
  registerDataIndexResource
} from './data-resources.js';

export function registerItemResources(server: McpServer): void {
  registerDataIndexResource(server, {
    name: 'minecraft/items',
    uri: 'lzimul://minecraft/items',
    title: 'Minecraft Item List',
    description: `Index of all ${MINECRAFT_ITEM_COUNT} Minecraft items (Java Edition ${MINECRAFT_DATA_VERSION})`,
    entries: MINECRAFT_ITEMS
  });
  registerDataEntryResources(server, {
    pathPrefix: 'items',
    category: 'item',
    entries: MINECRAFT_ITEMS
  });
}
