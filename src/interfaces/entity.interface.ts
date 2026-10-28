import type { EEntityKind } from '../enums/entity-kind.enum.js';
import type { EDimensionType } from '../enums/dimension-type.enum.js';
import type { IEntityInventory } from './entity-inventory.interface.js';
import type { IEntityType } from './entity-type.interface.js';

/** One entity or player stored in a dimension. */
export interface IEntity {
  readonly id: string;
  readonly kind: EEntityKind;
  readonly type: IEntityType;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly dimension: EDimensionType;
  readonly inventory: IEntityInventory;
  readonly createdAt: string;
}
