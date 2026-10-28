import * as z from 'zod/v4';

import { EEntityKind } from '../enums/entity-kind.enum.js';
import { EInventorySection } from '../enums/inventory-section.enum.js';
import {
  HOTBAR_SLOT_COUNT,
  INVENTORY_SLOT_COUNT,
  inventoryUsedSlots,
  sectionUsedSlots,
  TOTAL_SLOT_COUNT
} from '../world/entity-inventory.js';

import type { IEntity } from '../interfaces/entity.interface.js';
import type { IItemStack } from '../interfaces/entity-inventory.interface.js';

/** One non-empty inventory stack. */
export const itemStackSchema = z.object({
  item: z.string(),
  count: z.number().int().min(1)
});
export type ItemStackInfo = z.infer<typeof itemStackSchema>;

/** Full 9+27 slot inventory; empty slots are null. */
export const entityInventorySchema = z.object({
  hotbar: z.array(itemStackSchema.nullable()),
  inventory: z.array(itemStackSchema.nullable())
});
export type EntityInventoryInfo = z.infer<typeof entityInventorySchema>;

/** Identity and position fields shared by entity and inventory views. */
export const entitySummarySchema = z.object({
  id: z.string(),
  kind: z.enum(EEntityKind),
  type: z.string(),
  typeDisplayName: z.string(),
  category: z.string(),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  dimension: z.string()
});
export type EntitySummary = z.infer<typeof entitySummarySchema>;

/** Entity/player output returned by create and get tools. */
export const entityInfoSchema = entitySummarySchema.extend({
  createdAt: z.string(),
  usedSlots: z.number().int(),
  totalSlots: z.number().int(),
  inventory: entityInventorySchema
});
export type EntityInfo = z.infer<typeof entityInfoSchema>;

/** Inventory-only output with used-slot counters. */
export const inventoryViewSchema = z.object({
  entity: entitySummarySchema,
  hotbar: z.array(itemStackSchema.nullable()),
  inventory: z.array(itemStackSchema.nullable()),
  hotbarUsed: z.number().int(),
  inventoryUsed: z.number().int(),
  usedSlots: z.number().int(),
  totalSlots: z.number().int()
});
export type InventoryView = z.infer<typeof inventoryViewSchema>;

/** Inventory view plus the slot that changed and its previous contents. */
export const inventoryChangeSchema = inventoryViewSchema.extend({
  section: z.enum(EInventorySection),
  slot: z.number().int(),
  previous: itemStackSchema.nullable(),
  item: itemStackSchema.nullable()
});
export type InventoryChange = z.infer<typeof inventoryChangeSchema>;

export function toItemStackInfo(stack: IItemStack): ItemStackInfo {
  return { item: stack.item, count: stack.count };
}

function toNullableItemStackInfo(
  stack: IItemStack | null
): ItemStackInfo | null {
  return stack ? toItemStackInfo(stack) : null;
}

export function toEntityInventoryInfo(entity: IEntity): EntityInventoryInfo {
  return {
    hotbar: entity.inventory.hotbar.map(toNullableItemStackInfo),
    inventory: entity.inventory.inventory.map(toNullableItemStackInfo)
  };
}

export function toEntitySummary(entity: IEntity): EntitySummary {
  return {
    id: entity.id,
    kind: entity.kind,
    type: entity.type.key,
    typeDisplayName: entity.type.displayName,
    category: entity.type.category,
    name: entity.name,
    x: entity.x,
    y: entity.y,
    z: entity.z,
    dimension: entity.dimension
  };
}

export function toEntityInfo(entity: IEntity): EntityInfo {
  return {
    ...toEntitySummary(entity),
    createdAt: entity.createdAt,
    usedSlots: inventoryUsedSlots(entity.inventory),
    totalSlots: TOTAL_SLOT_COUNT,
    inventory: toEntityInventoryInfo(entity)
  };
}

export function toInventoryView(entity: IEntity): InventoryView {
  return {
    entity: toEntitySummary(entity),
    hotbar: entity.inventory.hotbar.map(toNullableItemStackInfo),
    inventory: entity.inventory.inventory.map(toNullableItemStackInfo),
    hotbarUsed: sectionUsedSlots(entity.inventory, EInventorySection.Hotbar),
    inventoryUsed: sectionUsedSlots(
      entity.inventory,
      EInventorySection.Inventory
    ),
    usedSlots: inventoryUsedSlots(entity.inventory),
    totalSlots: TOTAL_SLOT_COUNT
  };
}

export const INVENTORY_LIMITS = {
  hotbar: HOTBAR_SLOT_COUNT,
  inventory: INVENTORY_SLOT_COUNT
} as const;
