import * as z from 'zod/v4';

import { WORLD_LIMITS } from '../config/world-limits.js';

/** Horizontal coordinates are bounded to the Minecraft world border. */
export const horizontalCoordinate = z
  .number()
  .int()
  .min(WORLD_LIMITS.minHorizontal)
  .max(WORLD_LIMITS.maxHorizontal);

/** Vertical bounds are narrowed further by each dimension at runtime. */
export const verticalCoordinate = z
  .number()
  .int()
  .min(WORLD_LIMITS.minVertical)
  .max(WORLD_LIMITS.maxVertical);

/** Reusable x/y/z fields for block and entity tools. */
export const blockPositionShape = {
  x: horizontalCoordinate.describe('X coordinate (-30000000 to 30000000)'),
  y: verticalCoordinate.describe(
    'Y coordinate, within the dimension height range'
  ),
  z: horizontalCoordinate.describe('Z coordinate (-30000000 to 30000000)')
} as const;
