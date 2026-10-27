import type { EDimensionType } from '../enums/dimension-type.enum.js';
import type { IPlacedBlock } from './placed-block.interface.js';

export interface IWorldStore {
  load(type: EDimensionType): Promise<readonly IPlacedBlock[]>;
  save(type: EDimensionType, blocks: readonly IPlacedBlock[]): Promise<void>;
}
