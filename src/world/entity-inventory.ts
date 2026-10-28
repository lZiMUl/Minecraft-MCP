import { getItemByName } from '../data/items.js';
import { EInventorySection } from '../enums/inventory-section.enum.js';

import type {
  IEntityInventory,
  IItemStack
} from '../interfaces/entity-inventory.interface.js';

/** Number of hotbar slots available to every entity and player. */
export const HOTBAR_SLOT_COUNT = 9;
/** Number of backpack slots available to every entity and player. */
export const INVENTORY_SLOT_COUNT = 27;
/** Total inventory size exposed by the inventory tools. */
export const TOTAL_SLOT_COUNT = HOTBAR_SLOT_COUNT + INVENTORY_SLOT_COUNT;

/** Return the number of slots in the requested inventory section. */
export function slotCount(section: EInventorySection): number {
  return section === EInventorySection.Hotbar
    ? HOTBAR_SLOT_COUNT
    : INVENTORY_SLOT_COUNT;
}

/** Check a zero-based slot index against the selected section. */
export function isSlotInRange(
  section: EInventorySection,
  slot: number
): boolean {
  return Number.isInteger(slot) && slot >= 0 && slot < slotCount(section);
}

/** Create a fully empty 36-slot inventory. */
export function createEmptyInventory(): IEntityInventory {
  return {
    hotbar: Array.from({ length: HOTBAR_SLOT_COUNT }, () => null),
    inventory: Array.from({ length: INVENTORY_SLOT_COUNT }, () => null)
  };
}

/** Validate a persisted stack and clamp its count to the item stack size. */
export function normalizeItemStack(value: unknown): IItemStack | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const { item, count } = record;
  if (
    typeof item !== 'string' ||
    typeof count !== 'number' ||
    !Number.isInteger(count) ||
    count <= 0
  ) {
    return null;
  }

  const resolved = getItemByName(item.trim().toLowerCase());
  if (!resolved || resolved.key === 'minecraft:air') {
    return null;
  }

  return {
    item: resolved.key,
    count: Math.min(count, resolved.stackSize)
  };
}

/** Normalize a persisted slot list to exactly `length` entries. */
function normalizeSlotArray(
  value: unknown,
  length: number
): readonly (IItemStack | null)[] {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length }, (_, index) =>
    normalizeItemStack(source[index])
  );
}

/** Build a valid inventory from arbitrary persisted data. */
export function normalizeInventory(value: unknown): IEntityInventory {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return createEmptyInventory();
  }

  const record = value as Record<string, unknown>;
  return {
    hotbar: normalizeSlotArray(record.hotbar, HOTBAR_SLOT_COUNT),
    inventory: normalizeSlotArray(record.inventory, INVENTORY_SLOT_COUNT)
  };
}

/** Return the stack in a slot, or null when the slot is empty. */
export function getInventorySlot(
  inventory: IEntityInventory,
  section: EInventorySection,
  slot: number
): IItemStack | null {
  return section === EInventorySection.Hotbar
    ? inventory.hotbar[slot]
    : inventory.inventory[slot];
}

/** Return a new inventory with one slot replaced; the input is not mutated. */
export function withInventorySlot(
  inventory: IEntityInventory,
  section: EInventorySection,
  slot: number,
  stack: IItemStack | null
): IEntityInventory {
  if (section === EInventorySection.Hotbar) {
    const hotbar = [...inventory.hotbar];
    hotbar[slot] = stack;
    return { ...inventory, hotbar };
  }

  const slots = [...inventory.inventory];
  slots[slot] = stack;
  return { ...inventory, inventory: slots };
}

/** Compare two stacks by item id and count. */
export function sameItemStack(
  a: IItemStack | null,
  b: IItemStack | null
): boolean {
  if (a === b) {
    return true;
  }
  return a !== null && b !== null && a.item === b.item && a.count === b.count;
}

/** Count occupied slots without allocating intermediate arrays. */
export function inventoryUsedSlots(inventory: IEntityInventory): number {
  let used = 0;
  for (const stack of inventory.hotbar) {
    if (stack !== null) {
      used += 1;
    }
  }
  for (const stack of inventory.inventory) {
    if (stack !== null) {
      used += 1;
    }
  }
  return used;
}

/** Count occupied slots in one section without allocating an array copy. */
export function sectionUsedSlots(
  inventory: IEntityInventory,
  section: EInventorySection
): number {
  const slots =
    section === EInventorySection.Hotbar
      ? inventory.hotbar
      : inventory.inventory;
  let used = 0;
  for (const stack of slots) {
    if (stack !== null) {
      used += 1;
    }
  }
  return used;
}
