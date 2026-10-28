import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { WORLD_LIMITS } from '../config/world-limits.js';
import { blockPositionShape } from '../schemas/coordinate-schema.js';
import { dimensionField } from '../schemas/dimension-schema.js';
import {
  entitySummarySchema,
  toEntitySummary
} from '../schemas/entity-schema.js';
import { toErrorMessage } from '../utils/error-message.js';
import {
  formatStates,
  isEmptyStates,
  sameStates
} from '../world/block-states.js';
import { parseBlockSpec } from '../world/block-spec.js';
import { SNAPSHOT_FORMAT } from '../world/stores/serialized-snapshot.js';
import { coordinateRangeError, toolError } from './result.js';

import type { World } from '../world/world.js';

const blockStatesSchema = z.record(z.string(), z.string());

const positionSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  z: z.number().int()
});

const blockTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .describe(
    'Block id, such as "minecraft:stone" or "stone"; states are optional, for example "oak_stairs[facing=south]"'
  );

type Position = { readonly x: number; readonly y: number; readonly z: number };

/** Normalize two corners into an inclusive minimum/maximum box. */
function normalizeArea(
  from: Position,
  to: Position
): { readonly from: Position; readonly to: Position } {
  return {
    from: {
      x: Math.min(from.x, to.x),
      y: Math.min(from.y, to.y),
      z: Math.min(from.z, to.z)
    },
    to: {
      x: Math.max(from.x, to.x),
      y: Math.max(from.y, to.y),
      z: Math.max(from.z, to.z)
    }
  };
}

/** Register dimension metadata and paginated block listing tools. */
export function registerWorldTools(server: McpServer, world: World): void {
  server.registerTool(
    'getDimension',
    {
      title: 'Get Dimension',
      description:
        'Get metadata and live state for one simulated dimension: id, display name, height range, modified block count, entity count and player count. Dimensions are "overworld", "the_nether" and "the_end"; each has its own persisted world state.',
      inputSchema: z.object({
        dimension: dimensionField
      }),
      outputSchema: z.object({
        key: z.string(),
        type: z.string(),
        displayName: z.string(),
        minY: z.number().int(),
        maxY: z.number().int(),
        hasSkylight: z.boolean(),
        modifiedBlockCount: z.number().int(),
        entityCount: z.number().int(),
        playerCount: z.number().int(),
        blocksUri: z.string(),
        dimensionsUri: z.string()
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ dimension: dimensionType }) => {
      try {
        const dimension = world.getDimension(dimensionType);
        const info = dimension.info;
        return {
          content: [
            {
              type: 'text',
              text: `${info.displayName} (${info.key}): ${dimension.modifiedBlockCount} modified blocks, ${dimension.entityCount} entities, ${dimension.playerCount} players; Y ${info.minY} to ${info.maxY - 1}`
            }
          ],
          structuredContent: {
            key: info.key,
            type: info.type,
            displayName: info.displayName,
            minY: info.minY,
            maxY: info.maxY,
            hasSkylight: info.hasSkylight,
            modifiedBlockCount: dimension.modifiedBlockCount,
            entityCount: dimension.entityCount,
            playerCount: dimension.playerCount,
            blocksUri: `lzimul://minecraft/dimensions/${info.type}`,
            dimensionsUri: 'lzimul://minecraft/dimensions'
          }
        };
      } catch (error) {
        return toolError(`getDimension failed: ${toErrorMessage(error)}`);
      }
    }
  );

  server.registerTool(
    'getDimensionBlocks',
    {
      title: 'Get Dimension Blocks',
      description:
        'List the placed (non-air) blocks of a dimension, sorted by coordinates. Results are paginated because a dimension can hold up to 250,000 modified blocks: use limit and offset to page through, and hasMore to continue. Unmodified coordinates are air and are not listed; use getBlock for a single coordinate. Each row contains x, y, z, block id, display name and block states.',
      inputSchema: z.object({
        dimension: dimensionField,
        limit: z
          .number()
          .int()
          .min(1)
          .max(10_000)
          .default(1_000)
          .describe(
            'Maximum number of blocks to return (1-10000, default 1000)'
          ),
        offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe('Number of blocks to skip, for pagination (default 0)')
      }),
      outputSchema: z.object({
        dimension: z.string(),
        displayName: z.string(),
        total: z.number().int(),
        offset: z.number().int(),
        limit: z.number().int(),
        returned: z.number().int(),
        hasMore: z.boolean(),
        blocks: z.array(
          z.object({
            x: z.number().int(),
            y: z.number().int(),
            z: z.number().int(),
            block: z.string(),
            displayName: z.string(),
            states: blockStatesSchema
          })
        )
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ dimension: dimensionType, limit, offset }) => {
      try {
        const dimension = world.getDimension(dimensionType);
        const total = dimension.modifiedBlockCount;
        const page = dimension.sortedPlacedBlocks.slice(offset, offset + limit);
        const returned = page.length;
        const hasMore = offset + returned < total;
        return {
          content: [
            {
              type: 'text',
              text: `Returned ${returned} of ${total} placed block(s) in ${dimension.info.displayName} (offset ${offset}, limit ${limit}${hasMore ? ', more available' : ''})`
            }
          ],
          structuredContent: {
            dimension: dimension.info.key,
            displayName: dimension.info.displayName,
            total,
            offset,
            limit,
            returned,
            hasMore,
            blocks: page.map(placed => ({
              x: placed.x,
              y: placed.y,
              z: placed.z,
              block: placed.block.key,
              displayName: placed.block.displayName,
              states: placed.states
            }))
          }
        };
      } catch (error) {
        return toolError(`getDimensionBlocks failed: ${toErrorMessage(error)}`);
      }
    }
  );

  server.registerTool(
    'getBlocksInArea',
    {
      title: 'Get Blocks In Area',
      description:
        'List placed (non-air) blocks inside an inclusive box in one dimension, sorted by x, y and z. Corners may be supplied in any order. An optional blockType filter matches the block id and, when states are supplied, the exact state map. Results are paginated with limit and offset. Unmodified coordinates are air and are not listed.',
      inputSchema: z.object({
        dimension: dimensionField,
        from: z.object(blockPositionShape),
        to: z.object(blockPositionShape),
        blockType: blockTypeSchema
          .optional()
          .describe(
            'Optional block filter, such as "minecraft:oak_stairs" or "oak_stairs[facing=south]"'
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(10_000)
          .default(1_000)
          .describe(
            'Maximum number of matching blocks to return (1-10000, default 1000)'
          ),
        offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe('Number of matching blocks to skip (default 0)')
      }),
      outputSchema: z.object({
        dimension: z.string(),
        displayName: z.string(),
        from: positionSchema,
        to: positionSchema,
        blockType: z.string().nullable(),
        total: z.number().int(),
        offset: z.number().int(),
        limit: z.number().int(),
        returned: z.number().int(),
        hasMore: z.boolean(),
        blocks: z.array(
          z.object({
            x: z.number().int(),
            y: z.number().int(),
            z: z.number().int(),
            block: z.string(),
            displayName: z.string(),
            states: blockStatesSchema
          })
        )
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({
      dimension: dimensionType,
      from,
      to,
      blockType,
      limit,
      offset
    }) => {
      try {
        const dimension = world.getDimension(dimensionType);
        if (!dimension.contains(from.x, from.y, from.z)) {
          return coordinateRangeError(dimension.info, from.x, from.y, from.z);
        }
        if (!dimension.contains(to.x, to.y, to.z)) {
          return coordinateRangeError(dimension.info, to.x, to.y, to.z);
        }

        const area = normalizeArea(from, to);
        const spec = blockType ? parseBlockSpec(blockType) : null;
        if (spec && !spec.ok) {
          return toolError(spec.error);
        }
        const matches = dimension.sortedPlacedBlocks.filter(placed => {
          if (
            placed.x < area.from.x ||
            placed.x > area.to.x ||
            placed.y < area.from.y ||
            placed.y > area.to.y ||
            placed.z < area.from.z ||
            placed.z > area.to.z
          ) {
            return false;
          }
          if (!spec) {
            return true;
          }
          return (
            placed.block.key === spec.block.key &&
            (isEmptyStates(spec.states) ||
              sameStates(placed.states, spec.states))
          );
        });
        const total = matches.length;
        const page = matches.slice(offset, offset + limit);
        const returned = page.length;
        const hasMore = offset + returned < total;
        const filter = spec
          ? `${spec.block.key}${formatStates(spec.states)}`
          : null;
        return {
          content: [
            {
              type: 'text',
              text: `Returned ${returned} of ${total} placed block(s) in ${dimension.info.displayName} from (${area.from.x}, ${area.from.y}, ${area.from.z}) to (${area.to.x}, ${area.to.y}, ${area.to.z})${filter ? ` matching ${filter}` : ''} (offset ${offset}, limit ${limit}${hasMore ? ', more available' : ''})`
            }
          ],
          structuredContent: {
            dimension: dimension.info.key,
            displayName: dimension.info.displayName,
            from: area.from,
            to: area.to,
            blockType: filter,
            total,
            offset,
            limit,
            returned,
            hasMore,
            blocks: page.map(placed => ({
              x: placed.x,
              y: placed.y,
              z: placed.z,
              block: placed.block.key,
              displayName: placed.block.displayName,
              states: placed.states
            }))
          }
        };
      } catch (error) {
        return toolError(`getBlocksInArea failed: ${toErrorMessage(error)}`);
      }
    }
  );

  server.registerTool(
    'fillBlocks',
    {
      title: 'Fill Blocks',
      description:
        'Fill an inclusive box in one dimension with one block type and optional states. Corners may be supplied in any order. By default only air coordinates are filled; set overwrite to true to replace existing blocks. Use "minecraft:air" with overwrite to clear a region. The maximum volume per request is 16,384 blocks.',
      inputSchema: z.object({
        dimension: dimensionField,
        from: z.object(blockPositionShape),
        to: z.object(blockPositionShape),
        blockType: blockTypeSchema,
        overwrite: z
          .boolean()
          .default(false)
          .describe(
            'Replace existing non-air blocks when true; default false fills air only'
          )
      }),
      outputSchema: z.object({
        dimension: z.string(),
        displayName: z.string(),
        from: positionSchema,
        to: positionSchema,
        blockType: z.string(),
        block: z.string(),
        states: blockStatesSchema,
        overwrite: z.boolean(),
        volume: z.number().int(),
        changed: z.number().int(),
        placed: z.number().int(),
        removed: z.number().int(),
        skipped: z.number().int(),
        modifiedBlockCount: z.number().int()
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ dimension: dimensionType, from, to, blockType, overwrite }) => {
      try {
        const dimension = world.getDimension(dimensionType);
        if (!dimension.contains(from.x, from.y, from.z)) {
          return coordinateRangeError(dimension.info, from.x, from.y, from.z);
        }
        if (!dimension.contains(to.x, to.y, to.z)) {
          return coordinateRangeError(dimension.info, to.x, to.y, to.z);
        }

        const area = normalizeArea(from, to);
        const volume =
          (area.to.x - area.from.x + 1) *
          (area.to.y - area.from.y + 1) *
          (area.to.z - area.from.z + 1);
        if (
          !Number.isSafeInteger(volume) ||
          volume > WORLD_LIMITS.maxFillVolume
        ) {
          return toolError(
            `The requested fill volume is too large (${volume}); the maximum is ${WORLD_LIMITS.maxFillVolume} blocks.`
          );
        }

        const spec = parseBlockSpec(blockType);
        if (!spec.ok) {
          return toolError(spec.error);
        }
        const isAirTarget = spec.block.key === 'minecraft:air';
        if (isAirTarget && !isEmptyStates(spec.states)) {
          return toolError(
            'Air cannot carry block states. Use "minecraft:air" to remove blocks.'
          );
        }

        let newBlocks = 0;
        let skipped = 0;
        for (let x = area.from.x; x <= area.to.x; x += 1) {
          for (let y = area.from.y; y <= area.to.y; y += 1) {
            for (let z = area.from.z; z <= area.to.z; z += 1) {
              const existing = dimension.getBlockState(x, y, z);
              const existingIsAir = existing.block.key === 'minecraft:air';
              if (!overwrite && !existingIsAir) {
                skipped += 1;
                continue;
              }
              if (isAirTarget) {
                if (existingIsAir) {
                  skipped += 1;
                }
                continue;
              }
              if (
                !existingIsAir &&
                existing.block.key === spec.block.key &&
                sameStates(existing.states, spec.states)
              ) {
                skipped += 1;
                continue;
              }
              if (existingIsAir) {
                newBlocks += 1;
              }
            }
          }
        }

        if (
          dimension.modifiedBlockCount + newBlocks >
          WORLD_LIMITS.maxModifiedBlocks
        ) {
          return toolError(
            `The ${dimension.info.displayName} world would exceed the maximum of ${WORLD_LIMITS.maxModifiedBlocks} modified blocks.`
          );
        }

        let placed = 0;
        let removed = 0;
        let changed = 0;
        for (let x = area.from.x; x <= area.to.x; x += 1) {
          for (let y = area.from.y; y <= area.to.y; y += 1) {
            for (let z = area.from.z; z <= area.to.z; z += 1) {
              const existing = dimension.getBlockState(x, y, z);
              const existingIsAir = existing.block.key === 'minecraft:air';
              if (!overwrite && !existingIsAir) {
                continue;
              }
              if (isAirTarget) {
                if (!existingIsAir) {
                  dimension.setBlock(x, y, z, spec.block, spec.states);
                  removed += 1;
                  changed += 1;
                }
                continue;
              }
              if (
                !existingIsAir &&
                existing.block.key === spec.block.key &&
                sameStates(existing.states, spec.states)
              ) {
                continue;
              }
              dimension.setBlock(x, y, z, spec.block, spec.states);
              placed += 1;
              changed += 1;
            }
          }
        }

        if (changed > 0) {
          try {
            await dimension.flush();
          } catch (error) {
            return toolError(
              `The region was changed but could not be persisted to the world store: ${toErrorMessage(error)}`
            );
          }
        }

        const normalizedType = `${spec.block.key}${formatStates(spec.states)}`;
        return {
          content: [
            {
              type: 'text',
              text: `Filled ${changed} of ${volume} coordinate(s) in ${dimension.info.displayName} with ${normalizedType} (${placed} placed, ${removed} removed, ${skipped} skipped)`
            }
          ],
          structuredContent: {
            dimension: dimension.info.key,
            displayName: dimension.info.displayName,
            from: area.from,
            to: area.to,
            blockType: normalizedType,
            block: spec.block.key,
            states: spec.states,
            overwrite,
            volume,
            changed,
            placed,
            removed,
            skipped,
            modifiedBlockCount: dimension.modifiedBlockCount
          }
        };
      } catch (error) {
        return toolError(`fillBlocks failed: ${toErrorMessage(error)}`);
      }
    }
  );

  server.registerTool(
    'getDimensionEntities',
    {
      title: 'Get Dimension Entities',
      description:
        'List every entity and player in one dimension, sorted by UUID. Each row contains the entity UUID, kind, type, display name, name, position and dimension. Use getEntity or getInventory for one entity and its full inventory.',
      inputSchema: z.object({
        dimension: dimensionField
      }),
      outputSchema: z.object({
        dimension: z.string(),
        displayName: z.string(),
        entityCount: z.number().int(),
        playerCount: z.number().int(),
        entities: z.array(entitySummarySchema)
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ dimension: dimensionType }) => {
      try {
        const dimension = world.getDimension(dimensionType);
        const entities = dimension.sortedPlacedEntities.map(toEntitySummary);
        return {
          content: [
            {
              type: 'text',
              text: `${dimension.info.displayName} (${dimension.info.key}) holds ${entities.length} entities and ${dimension.playerCount} players`
            }
          ],
          structuredContent: {
            dimension: dimension.info.key,
            displayName: dimension.info.displayName,
            entityCount: entities.length,
            playerCount: dimension.playerCount,
            entities
          }
        };
      } catch (error) {
        return toolError(
          `getDimensionEntities failed: ${toErrorMessage(error)}`
        );
      }
    }
  );

  server.registerTool(
    'getDimensionRawFile',
    {
      title: 'Get Dimension Raw File',
      description:
        'Return the raw JSON snapshot of one dimension, including its top-level blocks and entities arrays. The result is the on-disk JSON for file storage, or the equivalent serialized state for memory storage, and can be loaded directly by minecraft_world_viewer.html.',
      inputSchema: z.object({
        dimension: dimensionField
      }),
      outputSchema: z.object({
        dimension: z.string(),
        format: z.string(),
        bytes: z.number().int(),
        raw: z.string()
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ dimension: dimensionType }) => {
      try {
        const dimension = world.getDimension(dimensionType);
        const raw = await dimension.readRaw();
        return {
          content: [{ type: 'text', text: raw }],
          structuredContent: {
            dimension: dimension.info.key,
            format: SNAPSHOT_FORMAT,
            bytes: Buffer.byteLength(raw, 'utf8'),
            raw
          }
        };
      } catch (error) {
        return toolError(
          `getDimensionRawFile failed: ${toErrorMessage(error)}`
        );
      }
    }
  );
}
