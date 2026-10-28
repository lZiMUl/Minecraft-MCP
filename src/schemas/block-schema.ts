import * as z from 'zod/v4';

import type { IBlock } from '../interfaces/block.interface.js';

/** Public block properties returned by tools and resources. */
export const blockInfoSchema = z.object({
  key: z.string(),
  name: z.string(),
  displayName: z.string(),
  hardness: z.number(),
  resistance: z.number(),
  diggable: z.boolean(),
  transparent: z.boolean(),
  emitLight: z.number(),
  filterLight: z.number(),
  boundingBox: z.string()
});

export type BlockInfo = z.infer<typeof blockInfoSchema>;

/** Project a registry block into the public tool/resource shape. */
export function toBlockInfo(block: IBlock): BlockInfo {
  return {
    key: block.key,
    name: block.name,
    displayName: block.displayName,
    hardness: block.hardness,
    resistance: block.resistance,
    diggable: block.diggable,
    transparent: block.transparent,
    emitLight: block.emitLight,
    filterLight: block.filterLight,
    boundingBox: block.boundingBox
  };
}
