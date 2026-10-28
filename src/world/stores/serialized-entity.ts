import { WORLD_LIMITS } from '../../config/world-limits.js';
import { getEntityTypeByName } from '../../data/entities.js';
import { EEntityKind } from '../../enums/entity-kind.enum.js';
import {
  createEmptyInventory,
  normalizeInventory
} from '../entity-inventory.js';

import type { EDimensionType } from '../../enums/dimension-type.enum.js';
import type { IEntity } from '../../interfaces/entity.interface.js';
import type {
  IEntityInventory,
  IItemStack
} from '../../interfaces/entity-inventory.interface.js';

export interface ISerializedItemStack {
  readonly item: string;
  readonly count: number;
}

export interface ISerializedInventory {
  readonly hotbar?: readonly (ISerializedItemStack | null)[];
  readonly inventory?: readonly (ISerializedItemStack | null)[];
}

export interface ISerializedEntity {
  readonly id: string;
  readonly kind: string;
  readonly type: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly createdAt: string;
  readonly inventory?: ISerializedInventory;
}

/** Convert one item stack to the compact snapshot shape. */
function serializeStack(stack: IItemStack | null): ISerializedItemStack | null {
  return stack ? { item: stack.item, count: stack.count } : null;
}

function serializeInventory(inventory: IEntityInventory): ISerializedInventory {
  return {
    hotbar: inventory.hotbar.map(serializeStack),
    inventory: inventory.inventory.map(serializeStack)
  };
}

/** Return true when at least one of the 36 slots contains an item. */
function hasItems(inventory: IEntityInventory): boolean {
  return (
    inventory.hotbar.some(stack => stack !== null) ||
    inventory.inventory.some(stack => stack !== null)
  );
}

/** Omit empty inventories to keep snapshots small. */
export function toSerializedEntity(entity: IEntity): ISerializedEntity {
  const payload = {
    id: entity.id,
    kind: entity.kind,
    type: entity.type.key,
    name: entity.name,
    x: entity.x,
    y: entity.y,
    z: entity.z,
    createdAt: entity.createdAt
  };

  if (hasItems(entity.inventory)) {
    return { ...payload, inventory: serializeInventory(entity.inventory) };
  }

  return payload;
}

function isCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/**
 * Rebuild an entity from a snapshot entry. The dimension always comes from the
 * file that contained the entry, never from the entry itself.
 */
export function fromSerializedEntity(
  entry: unknown,
  dimension: EDimensionType
): IEntity | null {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const { id, type, name, x, y, z, createdAt, inventory } = record;
  if (
    typeof id !== 'string' ||
    id.trim().length === 0 ||
    id.length > WORLD_LIMITS.maxEntityIdLength ||
    typeof type !== 'string' ||
    typeof name !== 'string' ||
    name.trim().length === 0 ||
    name.length > WORLD_LIMITS.maxEntityNameLength ||
    !isCoordinate(x) ||
    !isCoordinate(y) ||
    !isCoordinate(z)
  ) {
    return null;
  }

  const resolved = getEntityTypeByName(type.trim().toLowerCase());
  if (!resolved) {
    return null;
  }

  return {
    id: id.trim(),
    kind: resolved.name === 'player' ? EEntityKind.Player : EEntityKind.Entity,
    type: resolved,
    name: name.trim(),
    x,
    y,
    z,
    dimension,
    inventory:
      typeof inventory === 'undefined'
        ? createEmptyInventory()
        : normalizeInventory(inventory),
    createdAt:
      typeof createdAt === 'string' && createdAt.length > 0
        ? createdAt
        : new Date().toISOString()
  };
}
