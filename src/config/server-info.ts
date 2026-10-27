import { MINECRAFT_BLOCK_COUNT } from '../data/blocks.js';
import { MINECRAFT_ITEM_COUNT } from '../data/items.js';
import { MINECRAFT_DATA_VERSION } from '../data/version.js';
import { EIconTheme } from '../enums/icon-theme.enum.js';

export const SERVER_INFO = {
  name: 'lzimul',
  title: 'lZiMUl Minecraft MCP',
  description: `Minecraft Model Context Protocol server (Java Edition ${MINECRAFT_DATA_VERSION}): exposes all ${MINECRAFT_BLOCK_COUNT} blocks and ${MINECRAFT_ITEM_COUNT} items with their properties (name, hardness, blast resistance, durability, enchantment categories, etc.) as resources, plus tools to get and place blocks and look up items.`,
  version: '1.0.4',
  websiteUrl: 'https://mcp.lzimul.com/lZiMUl',
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
