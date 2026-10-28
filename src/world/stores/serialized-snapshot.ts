import { toSerialized } from './serialized-block.js';
import { toSerializedEntity } from './serialized-entity.js';

import type { EDimensionType } from '../../enums/dimension-type.enum.js';
import type { IPlacedBlock } from '../../interfaces/placed-block.interface.js';
import type { IWorldSnapshot } from '../../interfaces/world-store.interface.js';

/** Current on-disk snapshot format. Older formats remain loadable. */
export const SNAPSHOT_FORMAT = 'lzimul:minecraft/dimension';

/** Refuse to parse a snapshot larger than this, so a corrupt file cannot OOM. */
export const MAX_SNAPSHOT_BYTES = 128 * 1024 * 1024;

function compareIds(
  a: { readonly id: string },
  b: { readonly id: string }
): number {
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? -1 : 1;
}

function compareBlocks(a: IPlacedBlock, b: IPlacedBlock): number {
  return a.x - b.x || a.y - b.y || a.z - b.z;
}

/**
 * Return the input when it is already ordered, otherwise a sorted copy.
 * Dimension flushes pass cached sorted views, so this avoids re-sorting large
 * snapshots on every write while still accepting arbitrary snapshots.
 */
function sortedCopy<T>(
  values: readonly T[],
  compare: (a: T, b: T) => number
): readonly T[] {
  for (let index = 1; index < values.length; index += 1) {
    if (compare(values[index - 1], values[index]) > 0) {
      return values.toSorted(compare);
    }
  }
  return values;
}

/**
 * Serialize one dimension in the exact format used by the file store.
 *
 * The result is also suitable for the standalone world viewer, because it
 * contains top-level `blocks` and `entities` arrays.
 */
export function serializeSnapshot(
  type: EDimensionType,
  snapshot: IWorldSnapshot,
  updatedAt = new Date().toISOString()
): string {
  const sortedBlocks = sortedCopy(snapshot.blocks, compareBlocks);
  const sortedEntities = sortedCopy(snapshot.entities, compareIds);
  const payload = {
    format: SNAPSHOT_FORMAT,
    dimension: `minecraft:${type}`,
    updatedAt,
    modifiedBlockCount: sortedBlocks.length,
    entityCount: sortedEntities.length,
    blocks: sortedBlocks.map(toSerialized),
    entities: sortedEntities.map(toSerializedEntity)
  };
  return `${JSON.stringify(payload)}\n`;
}
