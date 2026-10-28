import { WORLD_LIMITS } from '../../config/world-limits.js';
import { serializeSnapshot } from './serialized-snapshot.js';

import type { EDimensionType } from '../../enums/dimension-type.enum.js';
import type {
  IWorldSnapshot,
  IWorldStore
} from '../../interfaces/world-store.interface.js';

/** Volatile store used by tests and by `MCP_WORLD_STORAGE=memory`. */
export class MemoryWorldStore implements IWorldStore {
  private readonly worlds = new Map<EDimensionType, IWorldSnapshot>();

  /** Return a shallow copy so callers cannot mutate the stored snapshot. */
  async load(type: EDimensionType): Promise<IWorldSnapshot> {
    const stored = this.worlds.get(type);
    return stored
      ? { blocks: [...stored.blocks], entities: [...stored.entities] }
      : { blocks: [], entities: [] };
  }

  /** Store a copy after checking the same limits as the file backend. */
  async save(type: EDimensionType, snapshot: IWorldSnapshot): Promise<void> {
    if (snapshot.blocks.length > WORLD_LIMITS.maxModifiedBlocks) {
      throw new RangeError(
        `World snapshot has ${snapshot.blocks.length} blocks, above the limit of ${WORLD_LIMITS.maxModifiedBlocks}`
      );
    }
    if (snapshot.entities.length > WORLD_LIMITS.maxEntitiesPerDimension) {
      throw new RangeError(
        `World snapshot has ${snapshot.entities.length} entities, above the limit of ${WORLD_LIMITS.maxEntitiesPerDimension}`
      );
    }

    this.worlds.set(type, {
      blocks: [...snapshot.blocks],
      entities: [...snapshot.entities]
    });
  }

  /** Serialize the in-memory snapshot in the same format as the file store. */
  async readRaw(type: EDimensionType): Promise<string> {
    const stored = this.worlds.get(type);
    return serializeSnapshot(type, stored ?? { blocks: [], entities: [] });
  }
}
