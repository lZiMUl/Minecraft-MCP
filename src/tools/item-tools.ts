import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { getItemByName } from '../data/items.js';
import { itemInfoSchema, toItemInfo } from '../schemas/item-schema.js';
import { toErrorMessage } from '../utils/error-message.js';
import { toolError } from './result.js';

/** Register the item lookup tool. */
export function registerItemTools(server: McpServer): void {
  server.registerTool(
    'getItem',
    {
      title: 'Get Item',
      description:
        'Get the properties of a Minecraft item by id (stack size, durability, enchantment categories, etc.). See the resource lzimul://minecraft/items for the full list.',
      inputSchema: z.object({
        item: z
          .string()
          .min(1)
          .max(256)
          .describe(
            'Item id, such as "minecraft:diamond_sword" or "diamond_sword"'
          )
      }),
      outputSchema: z.object({
        item: itemInfoSchema
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ item: itemId }) => {
      try {
        const item = getItemByName(itemId.trim().toLowerCase());
        if (!item) {
          return toolError(
            `Unknown item "${itemId}". Use an item id such as "minecraft:diamond_sword"; see the resource lzimul://minecraft/items for the full list.`
          );
        }
        const durability = item.maxDurability
          ? `, durability ${item.maxDurability}`
          : '';
        return {
          content: [
            {
              type: 'text',
              text: `${item.displayName} (${item.key}): stack size ${item.stackSize}${durability}`
            }
          ],
          structuredContent: {
            item: toItemInfo(item)
          }
        };
      } catch (error) {
        return toolError(`getItem failed: ${toErrorMessage(error)}`);
      }
    }
  );
}
