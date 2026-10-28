import { getBlockByName } from '../data/blocks.js';
import {
  isSafeStateName,
  isSafeStateValue,
  normalizeStates
} from './block-states.js';

import type { IBlock } from '../interfaces/block.interface.js';
import type { BlockStates } from '../interfaces/block-states.interface.js';

/** Result of resolving a block id and its optional state list. */
export type BlockSpecResult =
  | { readonly ok: true; readonly block: IBlock; readonly states: BlockStates }
  | { readonly ok: false; readonly error: string };

/** Full block spec: optional namespace, block name and optional `[states]`. */
const SPEC = /^(?:([a-z0-9_.-]+):)?([a-z0-9_./-]+)(?:\[([^\]]*)\])?$/;
/** One `property=value` pair inside the brackets. */
const PROPERTY = /^([a-z0-9_]+)=([a-z0-9_.-]+)$/;
/** Upper bound keeps a crafted request from creating an oversized state map. */
const MAX_STATES = 32;

/**
 * Parse `minecraft:oak_stairs[facing=south,half=bottom]` (or the shorter
 * `oak_stairs[facing=south]`) into a registry block plus its states.
 */
export function parseBlockSpec(input: string): BlockSpecResult {
  const spec = input.trim().toLowerCase();
  const match = SPEC.exec(spec);
  if (!match) {
    return {
      ok: false,
      error: `Invalid block "${input}". Expected an id such as "minecraft:stone" or "minecraft:oak_stairs[facing=south]".`
    };
  }

  const namespace = match[1];
  const name = match[2];
  const rawStates = match[3];
  let block = getBlockByName(namespace ? `${namespace}:${name}` : name);
  if (!block && !namespace) {
    block = getBlockByName(`minecraft:${name}`);
  }

  if (!block) {
    return {
      ok: false,
      error: `Unknown block "${input}". Use a block id such as "minecraft:stone"; see the resource lzimul://minecraft/blocks for the full list.`
    };
  }

  const states: Record<string, string> = {};
  let stateCount = 0;
  if (typeof rawStates === 'string') {
    if (rawStates.trim().length === 0) {
      return {
        ok: false,
        error: `Empty block state list in "${input}". Use "minecraft:oak_stairs[facing=south]" or omit the brackets.`
      };
    }
    for (const part of rawStates.split(',')) {
      const property = PROPERTY.exec(part.trim());
      if (!property) {
        return {
          ok: false,
          error: `Invalid block state "${part.trim()}" in "${input}". Expected "property=value".`
        };
      }
      const propertyName = property[1];
      const propertyValue = property[2];
      if (!isSafeStateName(propertyName)) {
        return {
          ok: false,
          error: `Unsupported block state name "${propertyName}" in "${input}".`
        };
      }
      if (!isSafeStateValue(propertyValue)) {
        return {
          ok: false,
          error: `Unsupported block state value "${propertyValue}" for "${propertyName}" in "${input}".`
        };
      }
      if (Object.hasOwn(states, propertyName)) {
        return {
          ok: false,
          error: `Duplicate block state "${propertyName}" in "${input}".`
        };
      }
      states[propertyName] = propertyValue;
      stateCount += 1;
      if (stateCount > MAX_STATES) {
        return {
          ok: false,
          error: `Too many block states in "${input}" (max ${MAX_STATES}).`
        };
      }
    }
  }

  return { ok: true, block, states: normalizeStates(states) };
}
