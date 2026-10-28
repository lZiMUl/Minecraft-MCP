import type { McpServer } from '@modelcontextprotocol/server';

import { MINECRAFT_BLOCKS, MINECRAFT_BLOCK_COUNT } from '../data/blocks.js';
import { MINECRAFT_DATA_VERSION } from '../data/version.js';
import {
  registerDataEntryResources,
  registerDataIndexResource
} from './data-resources.js';

/** Register the block index and one resource per block. */
export function registerBlockResources(server: McpServer): void {
  registerDataIndexResource(server, {
    name: 'minecraft/blocks',
    uri: 'lzimul://minecraft/blocks',
    title: 'Minecraft Block List',
    description: `Index of all ${MINECRAFT_BLOCK_COUNT} Minecraft blocks (Java Edition ${MINECRAFT_DATA_VERSION})`,
    entries: MINECRAFT_BLOCKS
  });
  registerDataEntryResources(server, {
    pathPrefix: 'blocks',
    category: 'block',
    entries: MINECRAFT_BLOCKS
  });
}
