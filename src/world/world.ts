import { DIMENSIONS } from '../config/dimensions.js';
import { toErrorMessage } from '../utils/error-message.js';
import { SimulatedDimension } from './simulated-dimension.js';

import type { EDimensionType } from '../enums/dimension-type.enum.js';
import type { IDimension } from '../interfaces/dimension.interface.js';
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
    return new World(new Map(entries));
  }

  static listDimensions(): readonly IDimension[] {
    return DIMENSIONS;
  }

  getDimension(type: EDimensionType): SimulatedDimension {
    const dimension = this.dimensions.get(type);
    if (!dimension) {
      throw new Error(
        `Unknown dimension "${type}". Use "overworld", "the_nether" or "the_end".`
      );
    }
    return dimension;
  }

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
