import type { IDataEntry } from './data-entry.interface.js';

/** Item properties from the generated registry. */
export interface IItem extends IDataEntry {
  readonly stackSize: number;
  readonly maxDurability?: number;
  readonly enchantCategories?: readonly string[];
  readonly repairWith?: readonly string[];
}
