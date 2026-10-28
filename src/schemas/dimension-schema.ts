import * as z from 'zod/v4';

import { EDimensionType } from '../enums/dimension-type.enum.js';

/** Dimension selector that defaults to the overworld. */
export const dimensionSchema = z
  .enum(EDimensionType)
  .default(EDimensionType.Overworld);

/** Required dimension selector for metadata tools. */
export const dimensionTypeSchema = z.enum(EDimensionType);

/** Shared field description keeps every tool schema consistent. */
export const dimensionField = dimensionSchema.describe(
  'Dimension: "overworld" (default), "the_nether" or "the_end"'
);
