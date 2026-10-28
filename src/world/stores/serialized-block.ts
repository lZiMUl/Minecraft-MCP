import { getBlockByName } from '../../data/blocks.js';
import { isEmptyStates, normalizeStates } from '../block-states.js';

import type { IPlacedBlock } from '../../interfaces/placed-block.interface.js';
import type { BlockStates } from '../../interfaces/block-states.interface.js';

/** JSON shape used by the file store when persisting placed blocks. */
export interface ISerializedBlock {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly block: string;
  readonly states?: BlockStates;
}

/** Convert a placed block to its compact snapshot representation. */
export function toSerialized(placed: IPlacedBlock): ISerializedBlock {
  const { x, y, z, block, states } = placed;

  if (isEmptyStates(states)) {
    return { x, y, z, block: block.key };
  }

  return {
    x,
    y,
    z,
    block: block.key,
    states: normalizeStates(states)
  };
}

/** Read and sanitize a persisted state map. */
function readStates(value: unknown): BlockStates {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const states: Record<string, string> = {};
  for (const [key, propertyValue] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (typeof propertyValue === 'string' && propertyValue.length > 0) {
      states[key] = propertyValue;
    }
  }
  return normalizeStates(states);
}

/** Returns null for malformed entries or blocks missing from the registry. */
export function fromSerialized(entry: unknown): IPlacedBlock | null {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const { x, y, z, block } = record;
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof z !== 'number' ||
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    !Number.isInteger(z) ||
    typeof block !== 'string'
  ) {
    return null;
  }

  const resolved = getBlockByName(block.toLowerCase());
  if (!resolved) {
    return null;
  }

  return { x, y, z, block: resolved, states: readStates(record.states) };
}
