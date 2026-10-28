import { EDimensionType } from '../enums/dimension-type.enum.js';

/** Static metadata for one simulated dimension. */
export interface IDimension {
  readonly key: string;
  readonly type: EDimensionType;
  readonly displayName: string;
  readonly minY: number;
  readonly maxY: number;
  readonly hasSkylight: boolean;
}
