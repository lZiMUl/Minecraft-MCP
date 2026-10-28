import type { EDimensionType } from '../enums/dimension-type.enum.js';
import type { IEntity } from './entity.interface.js';
import type { IPlacedBlock } from './placed-block.interface.js';

/** Complete persisted state for one dimension. */
export interface IWorldSnapshot {
  readonly blocks: readonly IPlacedBlock[];
  readonly entities: readonly IEntity[];
}

/** Backend contract shared by the file and memory stores. */
export interface IWorldStore {
  load(type: EDimensionType): Promise<IWorldSnapshot>;
  save(type: EDimensionType, snapshot: IWorldSnapshot): Promise<void>;
  readRaw(type: EDimensionType): Promise<string>;
}
