import type { BlockStates } from './block-states.interface.js';
import type { IBlock } from './block.interface.js';

/** A block placed at a specific coordinate with optional states. */
export interface IPlacedBlock {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly block: IBlock;
  readonly states: BlockStates;
}
