import type { BlockStates } from '../interfaces/block-states.interface.js';

export const EMPTY_BLOCK_STATES: BlockStates = Object.freeze({});

const MAX_STATE_NAME_LENGTH = 64;
const MAX_STATE_VALUE_LENGTH = 64;
const SAFE_STATE_NAME = /^[a-z0-9_]+$/;
const SAFE_STATE_VALUE = /^[a-z0-9_.-]+$/;
const RESERVED_STATE_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Block state names and values end up in JSON snapshots and in tool output, so
 * they are restricted to the character set Mojang uses. Reserved object keys
 * are rejected explicitly to rule out prototype pollution.
 */
export function isSafeStateName(name: string): boolean {
  const normalized = name.toLowerCase();
  return (
    normalized.length > 0 &&
    normalized.length <= MAX_STATE_NAME_LENGTH &&
    SAFE_STATE_NAME.test(normalized) &&
    !RESERVED_STATE_NAMES.has(normalized)
  );
}

/**
 * Lower-case and validate a block state value. Values use a conservative
 * character set so they are safe in JSON snapshots and tool output.
 */
export function isSafeStateValue(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.length > 0 &&
    normalized.length <= MAX_STATE_VALUE_LENGTH &&
    SAFE_STATE_VALUE.test(normalized)
  );
}

/** Stable comparator used to keep serialized state keys deterministic. */
export function compareStateNames(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/** Return true when a state map contains no own properties. */
export function isEmptyStates(states: BlockStates | null | undefined): boolean {
  if (!states) {
    return true;
  }
  for (const key in states) {
    if (Object.hasOwn(states, key)) {
      return false;
    }
  }
  return true;
}

/** Drop unsafe entries, lower-case everything and sort keys for stable output. */
export function normalizeStates(
  states: BlockStates | null | undefined
): BlockStates {
  if (!states || isEmptyStates(states)) {
    return EMPTY_BLOCK_STATES;
  }

  const entries = Object.entries(states)
    .filter(
      ([key, value]) =>
        typeof value === 'string' &&
        isSafeStateName(key) &&
        isSafeStateValue(value)
    )
    .map(([key, value]) => [key.toLowerCase(), value.toLowerCase()] as const)
    .sort(([a], [b]) => compareStateNames(a, b));

  return entries.length === 0
    ? EMPTY_BLOCK_STATES
    : Object.fromEntries(entries);
}

/** Compare two normalized state maps without allocating a sorted copy. */
export function sameStates(a: BlockStates, b: BlockStates): boolean {
  const entries = Object.entries(a);
  return (
    entries.length === Object.keys(b).length &&
    entries.every(([key, value]) => b[key] === value)
  );
}

/** Format states the way Minecraft does: `[facing=south,half=bottom]`. */
export function formatStates(states: BlockStates): string {
  const entries = Object.entries(states).sort(([a], [b]) =>
    compareStateNames(a, b)
  );
  if (entries.length === 0) {
    return '';
  }
  return `[${entries.map(([key, value]) => `${key}=${value}`).join(',')}]`;
}
