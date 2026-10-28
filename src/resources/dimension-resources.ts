import type { McpServer } from '@modelcontextprotocol/server';

import { toBlockInfo } from '../schemas/block-schema.js';
import { toEntityInfo } from '../schemas/entity-schema.js';
import { World } from '../world/world.js';
import { errorResource } from './error-content.js';

import type { IDimension } from '../interfaces/dimension.interface.js';

/** Compact dimension row used by the dimensions index. */
function dimensionSummary(
  world: World,
  dimension: IDimension
): Record<string, unknown> {
  const simulated = world.getDimension(dimension.type);
  return {
    key: dimension.key,
    type: dimension.type,
    displayName: dimension.displayName,
    minY: dimension.minY,
    maxY: dimension.maxY,
    hasSkylight: dimension.hasSkylight,
    modifiedBlockCount: simulated.modifiedBlockCount,
    entityCount: simulated.entityCount,
    playerCount: simulated.playerCount,
    uri: `lzimul://minecraft/dimensions/${dimension.type}`
  };
}

/** Full dimension state, including placed blocks and every entity/player. */
function dimensionState(
  world: World,
  dimension: IDimension
): Record<string, unknown> {
  const simulated = world.getDimension(dimension.type);
  return {
    key: dimension.key,
    type: dimension.type,
    displayName: dimension.displayName,
    minY: dimension.minY,
    maxY: dimension.maxY,
    hasSkylight: dimension.hasSkylight,
    modifiedBlockCount: simulated.modifiedBlockCount,
    entityCount: simulated.entityCount,
    playerCount: simulated.playerCount,
    placedBlocks: simulated.sortedPlacedBlocks.map(placed => ({
      x: placed.x,
      y: placed.y,
      z: placed.z,
      block: toBlockInfo(placed.block),
      states: placed.states
    })),
    entities: simulated.sortedPlacedEntities.map(toEntityInfo)
  };
}

/** Register `lzimul://minecraft/dimensions`, which stays small on purpose. */
export function registerDimensionIndexResource(
  server: McpServer,
  world: World
): void {
  server.registerResource(
    'minecraft/dimensions',
    'lzimul://minecraft/dimensions',
    {
      title: 'Minecraft Dimension List',
      description:
        'Index of the persisted Minecraft dimensions with their block counts (read the per-dimension resource for placed blocks)',
      mimeType: 'application/json'
    },
    async uri => {
      try {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify(
                World.listDimensions().map(dimension =>
                  dimensionSummary(world, dimension)
                ),
                null,
                2
              )
            }
          ]
        };
      } catch (error) {
        return errorResource(uri.href, error);
      }
    }
  );
}

/** Register one live state resource per dimension. */
export function registerDimensionResources(
  server: McpServer,
  world: World
): void {
  for (const dimension of World.listDimensions()) {
    server.registerResource(
      `minecraft/dimensions/${dimension.type}`,
      `lzimul://minecraft/dimensions/${dimension.type}`,
      {
        title: `${dimension.displayName} (${dimension.key})`,
        description: `Persisted state of the ${dimension.displayName} dimension`,
        mimeType: 'application/json'
      },
      async uri => {
        try {
          return {
            contents: [
              {
                uri: uri.href,
                mimeType: 'application/json',
                text: JSON.stringify(dimensionState(world, dimension), null, 2)
              }
            ]
          };
        } catch (error) {
          return errorResource(uri.href, error);
        }
      }
    );
  }
}
