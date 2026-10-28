import { randomUUID } from 'node:crypto';

import { WORLD_LIMITS } from '../config/world-limits.js';
import { getBlockByName, MINECRAFT_BLOCKS } from '../data/blocks.js';
import { getEntityTypeByName } from '../data/entities.js';
import { EEntityKind } from '../enums/entity-kind.enum.js';
import { EInventorySection } from '../enums/inventory-section.enum.js';
import { EMoveDirection } from '../enums/move-direction.enum.js';
import { toErrorMessage } from '../utils/error-message.js';
import { logger } from '../utils/logger.js';
import {
  EMPTY_BLOCK_STATES,
  isEmptyStates,
  normalizeStates,
  sameStates
} from './block-states.js';
import {
  createEmptyInventory,
  getInventorySlot,
  inventoryUsedSlots,
  isSlotInRange,
  sameItemStack,
  slotCount,
  withInventorySlot
} from './entity-inventory.js';

import type { IBlock } from '../interfaces/block.interface.js';
import type { BlockStates } from '../interfaces/block-states.interface.js';
import type { IDimension } from '../interfaces/dimension.interface.js';
import type { IEntity } from '../interfaces/entity.interface.js';
import type { IItemStack } from '../interfaces/entity-inventory.interface.js';
import type { IEntityType } from '../interfaces/entity-type.interface.js';
import type { IPlacedBlock } from '../interfaces/placed-block.interface.js';
import type {
  IWorldSnapshot,
  IWorldStore
} from '../interfaces/world-store.interface.js';

const AIR: IBlock = getBlockByName('air') ?? MINECRAFT_BLOCKS[0];

/** Immutable entity position used by position and movement results. */
export interface IEntityPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Previous and updated entity returned by position mutations. */
export interface IEntityPositionResult {
  readonly previous: IEntityPosition;
  readonly entity: IEntity;
}

/** Result of clearing every inventory slot of one entity. */
export interface IInventoryClearResult {
  readonly clearedSlots: number;
  readonly entity: IEntity;
}

/** Result of swapping two inventory slots. */
export interface IInventorySwapResult {
  readonly previousFrom: IItemStack | null;
  readonly previousTo: IItemStack | null;
  readonly entity: IEntity;
}

/** One-block deltas for the six fixed movement directions. */
function directionDelta(direction: EMoveDirection): IEntityPosition {
  switch (direction) {
    case EMoveDirection.Forward:
      return { x: 0, y: 0, z: 1 };
    case EMoveDirection.Back:
      return { x: 0, y: 0, z: -1 };
    case EMoveDirection.Left:
      return { x: -1, y: 0, z: 0 };
    case EMoveDirection.Right:
      return { x: 1, y: 0, z: 0 };
    case EMoveDirection.Up:
      return { x: 0, y: 1, z: 0 };
    case EMoveDirection.Down:
      return { x: 0, y: -1, z: 0 };
    default:
      throw new Error(`Unknown movement direction "${direction}".`);
  }
}

function coordinateKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function playerEntityType(): IEntityType {
  const type = getEntityTypeByName('minecraft:player');
  if (!type) {
    throw new Error('The entity registry is missing minecraft:player.');
  }
  return type;
}

function compareEntityIds(a: IEntity, b: IEntity): number {
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? -1 : 1;
}

/**
 * In-memory state for one dimension.
 *
 * Blocks and entities are kept in insertion-ordered maps, while sorted views
 * are cached lazily for pagination and resource reads. Mutations mark the
 * dimension dirty and coalesce persistence through a short debounce.
 */
export class SimulatedDimension {
  readonly info: IDimension;

  private readonly blocks = new Map<string, IPlacedBlock>();
  private readonly entities = new Map<string, IEntity>();
  /** Player names are lower-cased so lookups are case-insensitive. */
  private readonly playersByName = new Map<string, IEntity>();
  private readonly store: IWorldStore;
  private readonly writeDelayMs: number;
  /** Pending debounce timer; null when no write is scheduled. */
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Serializes writes so snapshots are never interleaved. */
  private queue: Promise<void> = Promise.resolve();
  /** Exposed so concurrent flush() calls can share one in-flight write. */
  private savePromise: Promise<void> | null = null;
  private dirty = false;
  /** Invalidated whenever blocks change. */
  private sortedBlocksCache: readonly IPlacedBlock[] | null = null;
  /** Invalidated when entities are added or removed. */
  private sortedEntitiesCache: readonly IEntity[] | null = null;

  constructor(info: IDimension, store: IWorldStore, writeDelayMs = 25) {
    this.info = info;
    this.store = store;
    this.writeDelayMs = writeDelayMs;
  }

  /** Number of non-air coordinates stored in this dimension. */
  get modifiedBlockCount(): number {
    return this.blocks.size;
  }

  /** Number of entities and players combined. */
  get entityCount(): number {
    return this.entities.size;
  }

  /** Number of players in this dimension. */
  get playerCount(): number {
    return this.playersByName.size;
  }

  /** Snapshot the current block map; callers receive a stable copy. */
  get placedBlocks(): readonly IPlacedBlock[] {
    return [...this.blocks.values()];
  }

  /** Lazily sorted view used by paginated block reads. */
  get sortedPlacedBlocks(): readonly IPlacedBlock[] {
    if (!this.sortedBlocksCache) {
      this.sortedBlocksCache = this.placedBlocks.toSorted(
        (a, b) => a.x - b.x || a.y - b.y || a.z - b.z
      );
    }
    return this.sortedBlocksCache;
  }

  /** Snapshot the current entity map; callers receive a stable copy. */
  get placedEntities(): readonly IEntity[] {
    return [...this.entities.values()];
  }

  /** Lazily sorted view used by dimension resources and tests. */
  get sortedPlacedEntities(): readonly IEntity[] {
    if (!this.sortedEntitiesCache) {
      this.sortedEntitiesCache = this.placedEntities.toSorted(compareEntityIds);
    }
    return this.sortedEntitiesCache;
  }

  /** Load one dimension file, dropping entries that break limits or validation. */
  async load(): Promise<void> {
    // A reload must not race a debounced write or leave stale dirty state.
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.queue;
    this.dirty = false;

    const stored = await this.store.load(this.info.type);
    this.blocks.clear();
    this.entities.clear();
    this.playersByName.clear();
    this.sortedBlocksCache = null;
    this.sortedEntitiesCache = null;

    let skippedBlocks = 0;
    for (const placed of stored.blocks) {
      const key = coordinateKey(placed.x, placed.y, placed.z);
      const outOfRange = !this.contains(placed.x, placed.y, placed.z);
      const overLimit =
        !this.blocks.has(key) &&
        this.blocks.size >= WORLD_LIMITS.maxModifiedBlocks;
      if (outOfRange || overLimit) {
        skippedBlocks++;
        continue;
      }
      this.blocks.set(key, placed);
    }

    let skippedEntities = 0;
    for (const entity of stored.entities) {
      const duplicateId = this.entities.has(entity.id);
      const outOfRange =
        !this.contains(entity.x, entity.y, entity.z) ||
        entity.dimension !== this.info.type;
      const overLimit =
        !duplicateId &&
        this.entities.size >= WORLD_LIMITS.maxEntitiesPerDimension;
      if (duplicateId || outOfRange || overLimit) {
        skippedEntities++;
        continue;
      }
      if (entity.kind === EEntityKind.Player) {
        const playerName = entity.name.trim().toLowerCase();
        if (this.playersByName.has(playerName)) {
          skippedEntities++;
          continue;
        }
        this.playersByName.set(playerName, entity);
      }
      this.entities.set(entity.id, entity);
    }

    if (skippedBlocks > 0) {
      logger.warn(
        `Skipped ${skippedBlocks} invalid block(s) while loading ${this.info.key}`
      );
    }
    if (skippedEntities > 0) {
      logger.warn(
        `Skipped ${skippedEntities} invalid entity/player record(s) while loading ${this.info.key}`
      );
    }
  }

  /** Check the dimension bounds and the shared horizontal coordinate limits. */
  contains(x: number, y: number, z: number): boolean {
    return (
      y >= this.info.minY &&
      y < this.info.maxY &&
      x >= WORLD_LIMITS.minHorizontal &&
      x <= WORLD_LIMITS.maxHorizontal &&
      z >= WORLD_LIMITS.minHorizontal &&
      z <= WORLD_LIMITS.maxHorizontal
    );
  }

  /** A new coordinate is allowed only while the modified-block limit is free. */
  canSetBlock(x: number, y: number, z: number): boolean {
    return (
      this.blocks.has(coordinateKey(x, y, z)) ||
      this.blocks.size < WORLD_LIMITS.maxModifiedBlocks
    );
  }

  canAddEntity(): boolean {
    return this.entities.size < WORLD_LIMITS.maxEntitiesPerDimension;
  }

  /** Return the placed block or air when the coordinate was never modified. */
  getBlock(x: number, y: number, z: number): IBlock {
    return this.blocks.get(coordinateKey(x, y, z))?.block ?? AIR;
  }

  getStates(x: number, y: number, z: number): BlockStates {
    return (
      this.blocks.get(coordinateKey(x, y, z))?.states ?? EMPTY_BLOCK_STATES
    );
  }

  /** Return the block and its states in one lookup. */
  getBlockState(
    x: number,
    y: number,
    z: number
  ): { readonly block: IBlock; readonly states: BlockStates } {
    const placed = this.blocks.get(coordinateKey(x, y, z));
    return placed
      ? { block: placed.block, states: placed.states }
      : { block: AIR, states: EMPTY_BLOCK_STATES };
  }

  /** Look up an entity or player by UUID within this dimension. */
  getEntity(id: string): IEntity | undefined {
    return this.entities.get(id);
  }

  /** Look up a player by name; names are compared case-insensitively. */
  findPlayer(name: string): IEntity | undefined {
    return this.playersByName.get(name.trim().toLowerCase());
  }

  /**
   * Drop players whose names were already claimed by an earlier dimension.
   * Dimension load order is fixed, so the first file wins.
   */
  removeDuplicatePlayers(claimedNames: Set<string>): number {
    let removed = 0;
    for (const entity of this.entities.values()) {
      if (entity.kind !== EEntityKind.Player) {
        continue;
      }
      const name = entity.name.trim().toLowerCase();
      if (claimedNames.has(name)) {
        this.entities.delete(entity.id);
        this.playersByName.delete(name);
        removed++;
      } else {
        claimedNames.add(name);
      }
    }
    if (removed > 0) {
      this.sortedEntitiesCache = null;
    }
    return removed;
  }

  /** Create a non-player entity with an empty inventory. */
  createEntity(
    type: IEntityType,
    name: string,
    x: number,
    y: number,
    z: number
  ): IEntity {
    if (type.name === 'player') {
      throw new Error(
        'Use createPlayer to create a player; createEntity only creates non-player entities.'
      );
    }
    return this.addEntity(EEntityKind.Entity, type, name, x, y, z);
  }

  /** Create a player after checking this dimension's name index. */
  createPlayer(name: string, x: number, y: number, z: number): IEntity {
    if (this.findPlayer(name)) {
      throw new Error(
        `A player named "${name}" already exists in ${this.info.displayName}. Player names are case-insensitive.`
      );
    }
    return this.addEntity(
      EEntityKind.Player,
      playerEntityType(),
      name,
      x,
      y,
      z
    );
  }

  /** Shared creation path for entities and players. */
  private addEntity(
    kind: EEntityKind,
    type: IEntityType,
    name: string,
    x: number,
    y: number,
    z: number
  ): IEntity {
    if (!this.canAddEntity()) {
      throw new RangeError(
        `The ${this.info.displayName} world already holds the maximum of ${WORLD_LIMITS.maxEntitiesPerDimension} entities.`
      );
    }

    const entity: IEntity = {
      id: randomUUID(),
      kind,
      type,
      name,
      x,
      y,
      z,
      dimension: this.info.type,
      inventory: createEmptyInventory(),
      createdAt: new Date().toISOString()
    };
    this.entities.set(entity.id, entity);
    if (kind === EEntityKind.Player) {
      this.playersByName.set(entity.name.trim().toLowerCase(), entity);
    }
    this.sortedEntitiesCache = null;
    this.markDirty();
    return entity;
  }

  /**
   * Replace one inventory slot. Entity objects are immutable, so an update
   * creates a new entity record and refreshes the player name index.
   */
  setInventorySlot(
    id: string,
    section: EInventorySection,
    slot: number,
    stack: IItemStack | null
  ): { readonly previous: IItemStack | null; readonly entity: IEntity } {
    const entity = this.entities.get(id);
    if (!entity) {
      throw new RangeError(
        `Unknown entity "${id}" in ${this.info.displayName}.`
      );
    }
    if (!isSlotInRange(section, slot)) {
      throw new RangeError(
        `Slot ${slot} is out of range for the ${section} (0-${slotCount(section) - 1}).`
      );
    }

    const previous = getInventorySlot(entity.inventory, section, slot);
    if (sameItemStack(previous, stack)) {
      return { previous, entity };
    }

    const updated: IEntity = {
      ...entity,
      inventory: withInventorySlot(entity.inventory, section, slot, stack)
    };
    this.entities.set(id, updated);
    if (updated.kind === EEntityKind.Player) {
      this.playersByName.set(updated.name.trim().toLowerCase(), updated);
    }
    // The cache holds entity object references, so the replaced record must
    // invalidate it even though the sort order itself is unchanged.
    this.sortedEntitiesCache = null;
    this.markDirty();
    return { previous, entity: updated };
  }

  /** Remove an entity or player from this dimension. */
  deleteEntity(id: string): IEntity | undefined {
    const entity = this.entities.get(id);
    if (!entity) {
      return;
    }

    this.entities.delete(id);
    if (entity.kind === EEntityKind.Player) {
      this.playersByName.delete(entity.name.trim().toLowerCase());
    }
    this.sortedEntitiesCache = null;
    this.markDirty();
    return entity;
  }

  /** Remove every item stack from an entity or player inventory. */
  clearInventory(id: string): IInventoryClearResult {
    const entity = this.entities.get(id);
    if (!entity) {
      throw new RangeError(
        `Unknown entity "${id}" in ${this.info.displayName}.`
      );
    }

    const clearedSlots = inventoryUsedSlots(entity.inventory);
    if (clearedSlots === 0) {
      return { clearedSlots, entity };
    }

    const updated: IEntity = {
      ...entity,
      inventory: createEmptyInventory()
    };
    this.entities.set(id, updated);
    if (updated.kind === EEntityKind.Player) {
      this.playersByName.set(updated.name.trim().toLowerCase(), updated);
    }
    this.sortedEntitiesCache = null;
    this.markDirty();
    return { clearedSlots, entity: updated };
  }

  /** Swap two inventory slots of the same entity or player. */
  swapInventorySlots(
    id: string,
    fromSection: EInventorySection,
    fromSlot: number,
    toSection: EInventorySection,
    toSlot: number
  ): IInventorySwapResult {
    const entity = this.entities.get(id);
    if (!entity) {
      throw new RangeError(
        `Unknown entity "${id}" in ${this.info.displayName}.`
      );
    }
    if (!isSlotInRange(fromSection, fromSlot)) {
      throw new RangeError(
        `Slot ${fromSlot} is out of range for the ${fromSection} (0-${slotCount(fromSection) - 1}).`
      );
    }
    if (!isSlotInRange(toSection, toSlot)) {
      throw new RangeError(
        `Slot ${toSlot} is out of range for the ${toSection} (0-${slotCount(toSection) - 1}).`
      );
    }

    const previousFrom = getInventorySlot(
      entity.inventory,
      fromSection,
      fromSlot
    );
    const previousTo = getInventorySlot(entity.inventory, toSection, toSlot);
    const sameSlot = fromSection === toSection && fromSlot === toSlot;
    if (sameSlot || sameItemStack(previousFrom, previousTo)) {
      return { previousFrom, previousTo, entity };
    }

    let inventory = withInventorySlot(
      entity.inventory,
      fromSection,
      fromSlot,
      previousTo
    );
    inventory = withInventorySlot(inventory, toSection, toSlot, previousFrom);
    const updated: IEntity = { ...entity, inventory };
    this.entities.set(id, updated);
    if (updated.kind === EEntityKind.Player) {
      this.playersByName.set(updated.name.trim().toLowerCase(), updated);
    }
    this.sortedEntitiesCache = null;
    this.markDirty();
    return { previousFrom, previousTo, entity: updated };
  }

  /** Move one entity exactly one block along a fixed axis. */
  moveEntity(id: string, direction: EMoveDirection): IEntityPositionResult {
    const entity = this.entities.get(id);
    if (!entity) {
      throw new RangeError(
        `Unknown entity "${id}" in ${this.info.displayName}.`
      );
    }
    const delta = directionDelta(direction);
    return this.setEntityPosition(
      id,
      entity.x + delta.x,
      entity.y + delta.y,
      entity.z + delta.z
    );
  }

  /**
   * Set an entity or player position. Positions are limited to the current
   * dimension's height range and the shared Minecraft world border.
   */
  setEntityPosition(
    id: string,
    x: number,
    y: number,
    z: number
  ): IEntityPositionResult {
    const entity = this.entities.get(id);
    if (!entity) {
      throw new RangeError(
        `Unknown entity "${id}" in ${this.info.displayName}.`
      );
    }
    if (!this.contains(x, y, z)) {
      throw new RangeError(
        `Position (${x}, ${y}, ${z}) is out of range in ${this.info.displayName} (Y: ${this.info.minY} to ${this.info.maxY - 1}).`
      );
    }

    const previous: IEntityPosition = {
      x: entity.x,
      y: entity.y,
      z: entity.z
    };
    if (entity.x === x && entity.y === y && entity.z === z) {
      return { previous, entity };
    }

    const updated: IEntity = { ...entity, x, y, z };
    this.entities.set(id, updated);
    if (updated.kind === EEntityKind.Player) {
      this.playersByName.set(updated.name.trim().toLowerCase(), updated);
    }
    // The cache holds entity object references, so the replaced record must
    // invalidate it even though the sort order itself is unchanged.
    this.sortedEntitiesCache = null;
    this.markDirty();
    return { previous, entity: updated };
  }

  /**
   * Place or remove a block. Air with no states deletes the coordinate instead
   * of storing an air entry, which keeps snapshots compact.
   */
  setBlock(
    x: number,
    y: number,
    z: number,
    block: IBlock,
    states: BlockStates = EMPTY_BLOCK_STATES
  ): IBlock {
    const key = coordinateKey(x, y, z);
    const existing = this.blocks.get(key);
    const previous = existing?.block ?? AIR;
    const normalized = normalizeStates(states);
    if (
      previous.key === block.key &&
      sameStates(existing?.states ?? EMPTY_BLOCK_STATES, normalized)
    ) {
      return previous;
    }

    const isRemoval = block.key === AIR.key && isEmptyStates(normalized);
    if (
      !existing &&
      !isRemoval &&
      this.blocks.size >= WORLD_LIMITS.maxModifiedBlocks
    ) {
      throw new RangeError(
        `The ${this.info.displayName} world already holds the maximum of ${WORLD_LIMITS.maxModifiedBlocks} modified blocks.`
      );
    }

    if (isRemoval) {
      this.blocks.delete(key);
    } else {
      this.blocks.set(key, { x, y, z, block, states: normalized });
    }
    this.sortedBlocksCache = null;
    this.markDirty();
    return previous;
  }

  /**
   * Persist pending changes, then return the raw snapshot. File storage
   * returns the on-disk JSON; memory storage serializes the same format.
   */
  async readRaw(): Promise<string> {
    await this.flush();
    return this.store.readRaw(this.info.type);
  }

  /**
   * Persist the current state immediately. Concurrent callers share the
   * in-flight write instead of producing one snapshot per call.
   */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.savePromise !== null) {
      await this.savePromise;
    }
    if (!this.dirty) {
      await this.queue;
      return;
    }

    this.dirty = false;
    const snapshot: IWorldSnapshot = {
      blocks: this.sortedPlacedBlocks,
      entities: this.sortedPlacedEntities
    };
    const run = this.queue.then(async () => {
      await this.store.save(this.info.type, snapshot);
    });
    this.queue = run.catch(() => {
      this.dirty = true;
    });
    this.savePromise = run;
    try {
      await run;
    } finally {
      this.savePromise = null;
    }
  }

  /** Mark the dimension dirty and schedule a debounced write. */
  private markDirty(): void {
    this.dirty = true;
    this.scheduleFlush();
  }

  /** Start the debounce timer if no write is already scheduled. */
  private scheduleFlush(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().catch(error => {
        logger.error(
          `Failed to persist ${this.info.key}: ${toErrorMessage(error)}`
        );
      });
    }, this.writeDelayMs);
  }
}
