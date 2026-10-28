import { getItemByName } from '../data/items.js';

import type { IItem } from '../interfaces/item.interface.js';

/** Result of resolving an item id against the generated registry. */
export type ItemSpecResult =
  | { readonly ok: true; readonly item: IItem }
  | { readonly ok: false; readonly error: string };

/** Optional namespace plus an item name; no state syntax is accepted. */
const ITEM_SPEC = /^(?:([a-z0-9_.-]+):)?([a-z0-9_./-]+)$/;

/**
 * Parse `minecraft:diamond_sword` or the shorter `diamond_sword` into an item
 * registry entry.
 */
export function parseItemSpec(input: string): ItemSpecResult {
  const spec = input.trim().toLowerCase();
  const match = ITEM_SPEC.exec(spec);
  if (!match) {
    return {
      ok: false,
      error: `Invalid item "${input}". Expected an id such as "minecraft:diamond_sword" or "diamond_sword".`
    };
  }

  const namespace = match[1];
  const name = match[2];
  let item = getItemByName(namespace ? `${namespace}:${name}` : name);
  if (!item && !namespace) {
    item = getItemByName(`minecraft:${name}`);
  }

  if (!item) {
    return {
      ok: false,
      error: `Unknown item "${input}". Use an item id such as "minecraft:diamond_sword"; see the resource lzimul://minecraft/items for the full list.`
    };
  }

  return { ok: true, item };
}
