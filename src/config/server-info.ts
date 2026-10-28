import { MINECRAFT_BLOCK_COUNT } from '../data/blocks.js';
import { MINECRAFT_ENTITY_COUNT } from '../data/entities.js';
import { MINECRAFT_ITEM_COUNT } from '../data/items.js';
import { MINECRAFT_DATA_VERSION } from '../data/version.js';
import { EIconTheme } from '../enums/icon-theme.enum.js';

/** Metadata advertised to MCP clients during discovery. */
export const SERVER_INFO = {
  name: '@lzimul/minecraft-mcp',
  title: 'lZiMUl Minecraft MCP',
  description: `Minecraft Model Context Protocol server (Java Edition ${MINECRAFT_DATA_VERSION}): exposes all ${MINECRAFT_BLOCK_COUNT} blocks, ${MINECRAFT_ITEM_COUNT} items and ${MINECRAFT_ENTITY_COUNT} entity types with their properties as resources, plus tools to read, place, query and fill blocks, inspect dimensions, create, move and delete entities and players, set entity positions, and manage their hotbar and backpack inventories.`,
  version: '1.0.5',
  websiteUrl: 'https://projects.lzimul.com/minecraft-mcp',
  icons: [
    {
      src: 'https://i1.hdslb.com/bfs/face/79fbb5635ff6e50fe2699c518af82162523e5f08.jpg',
      mimeType: 'image/jpeg',
      sizes: ['48x48', '96x96', '192x192'],
      theme: EIconTheme.Light
    },
    {
      src: 'https://i1.hdslb.com/bfs/face/79fbb5635ff6e50fe2699c518af82162523e5f08.jpg',
      mimeType: 'image/jpeg',
      sizes: ['48x48', '96x96', '192x192'],
      theme: EIconTheme.Dark
    }
  ]
};
