import { WORLD_LIMITS } from '../config/world-limits.js';
import { getBlockByName, MINECRAFT_BLOCKS } from '../data/blocks.js';
import { toErrorMessage } from '../utils/error-message.js';
import {
  EMPTY_BLOCK_STATES,
  normalizeStates,
  sameStates
} from './block-states.js';

import type { IBlock } from '../interfaces/block.interface.js';
import type { BlockStates } from '../interfaces/block-states.interface.js';
import type { IDimension } from '../interfaces/dimension.interface.js';
import type { IPlacedBlock } from '../interfaces/placed-block.interface.js';
import type { IWorldStore } from '../interfaces/world-store.interface.js';

const AIR: IBlock = getBlockByName('air') ?? MINECRAFT_BLOCKS[0];

function coordinateKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export class SimulatedDimension {
  readonly info: IDimension;

  private readonly blocks = new Map<string, IPlacedBlock>();
  private readonly store: IWorldStore;
  private readonly writeDelayMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private savePromise: Promise<void> | null = null;
  private dirty = false;

  constructor(info: IDimension, store: IWorldStore, writeDelayMs = 25) {
    this.info = info;
    this.store = store;
    this.writeDelayMs = writeDelayMs;
  }

  get modifiedBlockCount(): number {
    return this.blocks.size;
  }

  get placedBlocks(): readonly IPlacedBlock[] {
    return [...this.blocks.values()];
  }

  /** Load the persisted snapshot for this dimension into memory. */
  async load(): Promise<void> {
    const stored = await this.store.load(this.info.type);
    let skipped = 0;
    for (const placed of stored) {
      const key = coordinateKey(placed.x, placed.y, placed.z);
      const isNew = !this.blocks.has(key);
      const outOfRange = !this.contains(placed.x, placed.y, placed.z);
      const overLimit =
        isNew && this.blocks.size >= WORLD_LIMITS.maxModifiedBlocks;
      if (outOfRange || overLimit) {
        skipped++;
        continue;
      }
      this.blocks.set(key, placed);
    }
    if (skipped > 0) {
      console.error(
        `[lzimul-minecraft-mcp] Skipped ${skipped} invalid block(s) while loading ${this.info.key}`
      );
    }
  }

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

  /** False when a new block would exceed the per-dimension budget. */
  canSetBlock(x: number, y: number, z: number): boolean {
    return (
      this.blocks.has(coordinateKey(x, y, z)) ||
      this.blocks.size < WORLD_LIMITS.maxModifiedBlocks
    );
  }

  getBlock(x: number, y: number, z: number): IBlock {
    return this.blocks.get(coordinateKey(x, y, z))?.block ?? AIR;
  }

  getStates(x: number, y: number, z: number): BlockStates {
    return (
      this.blocks.get(coordinateKey(x, y, z))?.states ?? EMPTY_BLOCK_STATES
    );
  }

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

    const isRemoval =
      block.key === AIR.key && Object.keys(normalized).length === 0;
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

    this.dirty = true;
    this.scheduleFlush();
    return previous;
  }

  /**
   * Flush pending changes to the store. Awaited by `setBlock` tool calls so a
   * successful response means the block survived the request.
   *
   * Parallel flushes share the in-flight save instead of queuing one full
   * snapshot write per call; a caller whose change arrived mid-save loops once
   * more so its mutation is included too.
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
    const snapshot = this.placedBlocks;
    const run = this.queue.then(async () => {
      await this.store.save(this.info.type, snapshot);
    });
    // Keep the queue usable even when this save fails, and remember that the
    // snapshot is still unpersisted so the next flush retries it.
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

  private scheduleFlush(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().catch((error: unknown) => {
        console.error(
          `[lzimul-minecraft-mcp] Failed to persist ${this.info.key}: ${toErrorMessage(error)}`
        );
      });
    }, this.writeDelayMs);
  }
}
