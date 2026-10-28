/** Frozen limits shared by validation, world state and storage. */
export const WORLD_LIMITS = {
  minHorizontal: -30000000,
  maxHorizontal: 30000000,
  minVertical: -64,
  maxVertical: 320,
  /** Upper bound per dimension, protecting process memory and storage. */
  maxModifiedBlocks: 250_000,
  /** Upper bound for one fillBlocks request (32 x 32 x 16). */
  maxFillVolume: 16_384,
  maxEntitiesPerDimension: 10_000,
  maxEntityIdLength: 128,
  maxEntityNameLength: 64,
  maxPlayerNameLength: 32
} as const;
