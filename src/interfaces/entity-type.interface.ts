import type { IDataEntry } from './data-entry.interface.js';

/** Entity type properties from the generated registry. */
export interface IEntityType extends IDataEntry {
  readonly type: string;
  readonly category: string;
  readonly width: number;
  readonly height: number;
}
