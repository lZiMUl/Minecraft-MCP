import { EBoundingBox } from '../enums/bounding-box.enum.js';

import type { IDataEntry } from './data-entry.interface.js';

export interface IBlock extends IDataEntry {
  readonly hardness: number;
  readonly resistance: number;
  readonly stackSize: number;
  readonly diggable: boolean;
  readonly material: string;
  readonly transparent: boolean;
  readonly emitLight: number;
  readonly filterLight: number;
  readonly boundingBox: EBoundingBox;
}
