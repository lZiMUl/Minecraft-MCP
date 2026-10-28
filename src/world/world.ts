import { DIMENSIONS } from '../config/dimensions.js';
import { toErrorMessage } from '../utils/error-message.js';
import { logger } from '../utils/logger.js';
import { SimulatedDimension } from './simulated-dimension.js';

import type { EDimensionType } from '../enums/dimension-type.enum.js';
import type { IDimension } from '../interfaces/dimension.interface.js';
import type { IEntity } from '../interfaces/entity.interface.js';
import type { IWorldStore } from '../interfaces/world-store.interface.js';

/**
 * One loaded world: every dimension plus the store that backs it.
 *
 * A world is loaded once per process (stdio) and injected into the MCP
 * server, so every request sees the same in-memory state. Persistence is the
 * store's responsibility.
 */
export class World {
  private readonly dimensions: ReadonlyMap<EDimensionType, SimulatedDimension>;

  private constructor(
    dimensions: ReadonlyMap<EDimensionType, SimulatedDimension>
  ) {
    this.dimensions = dimensions;
  }

  static async load(store: IWorldStore, writeDelayMs = 25): Promise<World> {
    const entries = await Promise.all(
      DIMENSIONS.map(async dimension => {
        const simulated = new SimulatedDimension(
          dimension,
          store,
          writeDelayMs
        );
        try {
          await simulated.load();
        } catch (error) {
          throw new Error(
            `Failed to load the ${dimension.displayName} world: ${toErrorMessage(error)}`,
            { cause: error }
          );
        }
        return [dimension.type, simulated] as const;
      })
    );

    const dimensions = new Map(entries);

    // Player names are unique across the whole world, not per dimension. When
    // old snapshots contain the same player name in two dimensions, keep the
    // first one (dimension order is fixed) and drop the rest.
    const claimedPlayerNames = new Set<string>();
    let duplicatePlayers = 0;
    for (const dimension of dimensions.values()) {
      duplicatePlayers += dimension.removeDuplicatePlayers(claimedPlayerNames);
    }
    if (duplicatePlayers > 0) {
      logger.warn(
        `Removed ${duplicatePlayers} duplicate player name(s) while loading the world`
      );
    }

    return new World(dimensions);
  }

  /** Return the fixed dimension definitions in display order. */
  static listDimensions(): readonly IDimension[] {
    return DIMENSIONS;
  }

  /** Resolve one simulated dimension or throw for an unknown enum value. */
  getDimension(type: EDimensionType): SimulatedDimension {
    const dimension = this.dimensions.get(type);
    if (!dimension) {
      throw new Error(
        `Unknown dimension "${type}". Use "overworld", "the_nether" or "the_end".`
      );
    }
    return dimension;
  }

  /** Search every dimension for an entity or player UUID. */
  findEntity(id: string): IEntity | undefined {
    for (const dimension of this.dimensions.values()) {
      const entity = dimension.getEntity(id);
      if (entity) {
        return entity;
      }
    }
    return;
  }

  /** Find a player by name across all dimensions (case-insensitive). */
  findPlayer(name: string): IEntity | undefined {
    const normalized = name.trim().toLowerCase();
    if (normalized.length === 0) {
      return;
    }
    for (const dimension of this.dimensions.values()) {
      const player = dimension.findPlayer(normalized);
      if (player) {
        return player;
      }
    }
    return;
  }

  /** Flush every dimension and surface the combined failures. */
  async flush(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.dimensions.values()].map(dimension => dimension.flush())
    );
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    if (failures.length > 0) {
      throw new Error(
        failures.map(failure => toErrorMessage(failure.reason)).join('; ')
      );
    }
  }
}
