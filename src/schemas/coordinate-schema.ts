import * as z from 'zod/v4';

import { WORLD_LIMITS } from '../config/world-limits.js';

export const horizontalCoordinate = z
  .number()
  .int()
  .min(WORLD_LIMITS.minHorizontal)
  .max(WORLD_LIMITS.maxHorizontal);

export const verticalCoordinate = z
  .number()
  .int()
  .min(WORLD_LIMITS.minVertical)
  .max(WORLD_LIMITS.maxVertical);
