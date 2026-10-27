import * as z from 'zod/v4';

import { EDimensionType } from '../enums/dimension-type.enum.js';

export const dimensionSchema = z
  .enum(EDimensionType)
  .default(EDimensionType.Overworld);

export const dimensionTypeSchema = z.enum(EDimensionType);
