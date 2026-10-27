import { EDimensionType } from '../enums/dimension-type.enum.js';

import type { IDimension } from '../interfaces/dimension.interface.js';

export const DIMENSIONS: readonly IDimension[] = [
  {
    key: 'minecraft:overworld',
    type: EDimensionType.Overworld,
    displayName: 'Overworld',
    minY: -64,
    maxY: 320,
    hasSkylight: true
  },
  {
    key: 'minecraft:the_nether',
    type: EDimensionType.TheNether,
    displayName: 'The Nether',
    minY: 0,
    maxY: 256,
    hasSkylight: false
  },
  {
    key: 'minecraft:the_end',
    type: EDimensionType.TheEnd,
    displayName: 'The End',
    minY: 0,
    maxY: 256,
    hasSkylight: false
  }
];
