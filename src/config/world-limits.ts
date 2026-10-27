export const WORLD_LIMITS = {
  minHorizontal: -30000000,
  maxHorizontal: 30000000,
  minVertical: -64,
  maxVertical: 320,
  /** Upper bound per dimension, protecting process memory and storage. */
  maxModifiedBlocks: 250_000
} as const;
