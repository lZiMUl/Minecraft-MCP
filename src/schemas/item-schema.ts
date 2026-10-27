import * as z from 'zod/v4';

import type { IItem } from '../interfaces/item.interface.js';

export const itemInfoSchema = z.object({
  key: z.string(),
  name: z.string(),
  displayName: z.string(),
  stackSize: z.number(),
  maxDurability: z.number().optional(),
  enchantCategories: z.array(z.string()).optional(),
  repairWith: z.array(z.string()).optional()
});

export type ItemInfo = z.infer<typeof itemInfoSchema>;

export function toItemInfo(item: IItem): ItemInfo {
  const info: ItemInfo = {
    key: item.key,
    name: item.name,
    displayName: item.displayName,
    stackSize: item.stackSize
  };
  if (item.maxDurability) {
    info.maxDurability = item.maxDurability;
  }
  if (item.enchantCategories) {
    info.enchantCategories = [...item.enchantCategories];
  }
  if (item.repairWith) {
    info.repairWith = [...item.repairWith];
  }
  return info;
}
