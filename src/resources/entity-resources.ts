import type { McpServer } from '@modelcontextprotocol/server';

import {
  MINECRAFT_ENTITY_COUNT,
  MINECRAFT_ENTITY_TYPES
} from '../data/entities.js';
import { MINECRAFT_DATA_VERSION } from '../data/version.js';
import {
  registerDataEntryResources,
  registerDataIndexResource
} from './data-resources.js';

/** Register the entity type index and one resource per entity type. */
export function registerEntityResources(server: McpServer): void {
  registerDataIndexResource(server, {
    name: 'minecraft/entities',
    uri: 'lzimul://minecraft/entities',
    title: 'Minecraft Entity Type List',
    description: `Index of all ${MINECRAFT_ENTITY_COUNT} Minecraft entity types (Java Edition ${MINECRAFT_DATA_VERSION})`,
    entries: MINECRAFT_ENTITY_TYPES
  });
  registerDataEntryResources(server, {
    pathPrefix: 'entities',
    category: 'entity type',
    entries: MINECRAFT_ENTITY_TYPES
  });
}
