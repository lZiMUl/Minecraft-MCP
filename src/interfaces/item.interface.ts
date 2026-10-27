import type { IDataEntry } from './data-entry.interface.js';

export interface IItem extends IDataEntry {
  readonly stackSize: number;
  readonly maxDurability?: number;
  readonly enchantCategories?: readonly string[];
  readonly repairWith?: readonly string[];
}
