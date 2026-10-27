import { WORLD_LIMITS } from '../../config/world-limits.js';

import type { EDimensionType } from '../../enums/dimension-type.enum.js';
import type { IPlacedBlock } from '../../interfaces/placed-block.interface.js';
import type { IWorldStore } from '../../interfaces/world-store.interface.js';

/**
 * Volatile store used for tests and for `MCP_WORLD_STORAGE=memory`.
 * It keeps the previous behaviour (state only lives as long as the process).
 */
export class MemoryWorldStore implements IWorldStore {
  private readonly worlds = new Map<EDimensionType, readonly IPlacedBlock[]>();

  async load(type: EDimensionType): Promise<readonly IPlacedBlock[]> {
    const stored = this.worlds.get(type);
    return stored ? [...stored] : [];
  }

  async save(
    type: EDimensionType,
    blocks: readonly IPlacedBlock[]
  ): Promise<void> {
    if (blocks.length > WORLD_LIMITS.maxModifiedBlocks) {
      throw new RangeError(
        `World snapshot has ${blocks.length} blocks, above the limit of ${WORLD_LIMITS.maxModifiedBlocks}`
      );
    }
    this.worlds.set(type, [...blocks]);
  }
}
