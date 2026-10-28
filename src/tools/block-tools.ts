import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { WORLD_LIMITS } from '../config/world-limits.js';
import { blockInfoSchema, toBlockInfo } from '../schemas/block-schema.js';
import { blockPositionShape } from '../schemas/coordinate-schema.js';
import { dimensionField } from '../schemas/dimension-schema.js';
import { toErrorMessage } from '../utils/error-message.js';
import { formatStates } from '../world/block-states.js';
import { parseBlockSpec } from '../world/block-spec.js';
import { coordinateRangeError, toolError } from './result.js';

import type { World } from '../world/world.js';

const blockStatesSchema = z.record(z.string(), z.string());

/** Register block read and placement tools. */
export function registerBlockTools(server: McpServer, world: World): void {
  server.registerTool(
    'getBlock',
    {
      title: 'Get Block',
      description:
        'Get the block at the given coordinates in the given dimension, including its properties (name, hardness, light level, etc.) and its block states (for example facing=south). Each dimension has its own persisted world state; unmodified coordinates return air (minecraft:air).',
      inputSchema: z.object({
        ...blockPositionShape,
        dimension: dimensionField
      }),
      outputSchema: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number(),
        dimension: z.string(),
        block: blockInfoSchema,
        states: blockStatesSchema
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ x, y, z, dimension: dimensionType }) => {
      try {
        const dimension = world.getDimension(dimensionType);
        if (!dimension.contains(x, y, z)) {
          return coordinateRangeError(dimension.info, x, y, z);
        }
        const { block, states } = dimension.getBlockState(x, y, z);
        return {
          content: [
            {
              type: 'text',
              text: `Block at (${x}, ${y}, ${z}) in ${dimension.info.displayName} is ${block.displayName} (${block.key})${formatStates(states)}`
            }
          ],
          structuredContent: {
            x,
            y,
            z,
            dimension: dimension.info.key,
            block: toBlockInfo(block),
            states
          }
        };
      } catch (error) {
        return toolError(`getBlock failed: ${toErrorMessage(error)}`);
      }
    }
  );

  server.registerTool(
    'setBlock',
    {
      title: 'Set Block',
      description:
        'Place a block at the given coordinates in the given dimension and return the replaced block. Block states are supported: "minecraft:oak_stairs[facing=south,half=bottom]" or "oak_stairs[facing=south]". Each dimension has its own persisted world state; setting air removes the block. blockType is a block id such as "minecraft:stone" or "stone"; see the resource lzimul://minecraft/blocks for the full list.',
      inputSchema: z.object({
        ...blockPositionShape,
        blockType: z
          .string()
          .min(1)
          .max(256)
          .describe(
            'Block id with optional states, such as "minecraft:stone" or "minecraft:oak_stairs[facing=south]"'
          ),
        dimension: dimensionField
      }),
      outputSchema: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number(),
        dimension: z.string(),
        block: blockInfoSchema,
        states: blockStatesSchema,
        previous: blockInfoSchema,
        previousStates: blockStatesSchema
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ x, y, z, blockType, dimension: dimensionType }) => {
      try {
        const dimension = world.getDimension(dimensionType);
        if (!dimension.contains(x, y, z)) {
          return coordinateRangeError(dimension.info, x, y, z);
        }

        const spec = parseBlockSpec(blockType);
        if (!spec.ok) {
          return toolError(spec.error);
        }

        const isAir = spec.block.key === 'minecraft:air';
        const hasStates = Object.keys(spec.states).length > 0;
        if (isAir && hasStates) {
          return toolError(
            'Air cannot carry block states. Use "minecraft:air" to remove a block.'
          );
        }
        if (!isAir && !dimension.canSetBlock(x, y, z)) {
          return toolError(
            `The ${dimension.info.displayName} world already holds the maximum of ${WORLD_LIMITS.maxModifiedBlocks} modified blocks. Remove blocks with "minecraft:air" before adding more.`
          );
        }

        const previous = dimension.getBlockState(x, y, z);
        dimension.setBlock(x, y, z, spec.block, spec.states);
        try {
          await dimension.flush();
        } catch (error) {
          return toolError(
            `Block ${spec.block.key} was applied at (${x}, ${y}, ${z}) in ${dimension.info.displayName} but could not be persisted to the world store: ${toErrorMessage(error)}`
          );
        }

        return {
          content: [
            {
              type: 'text',
              text: `Block set at (${x}, ${y}, ${z}) in ${dimension.info.displayName}: ${previous.block.displayName} (${previous.block.key})${formatStates(previous.states)} -> ${spec.block.displayName} (${spec.block.key})${formatStates(spec.states)}`
            }
          ],
          structuredContent: {
            x,
            y,
            z,
            dimension: dimension.info.key,
            block: toBlockInfo(spec.block),
            states: spec.states,
            previous: toBlockInfo(previous.block),
            previousStates: previous.states
          }
        };
      } catch (error) {
        return toolError(`setBlock failed: ${toErrorMessage(error)}`);
      }
    }
  );
}
