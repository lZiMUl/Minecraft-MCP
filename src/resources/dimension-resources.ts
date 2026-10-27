import type { McpServer } from '@modelcontextprotocol/server';

import { toBlockInfo } from '../schemas/block-schema.js';
import { errorResource } from './error-content.js';

import type { IDimension } from '../interfaces/dimension.interface.js';
import { World } from '../world/world.js';

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
    placedBlocks: simulated.placedBlocks
      .map(placed => ({
        x: placed.x,
        y: placed.y,
        z: placed.z,
        block: toBlockInfo(placed.block),
        states: placed.states
      }))
      .toSorted((a, b) => a.x - b.x || a.y - b.y || a.z - b.z)
  };
}

export function registerDimensionIndexResource(
  server: McpServer,
  world: World
): void {
  server.registerResource(
    'minecraft/dimensions',
    'lzimul://minecraft/dimensions',
    {
      title: 'Minecraft Dimension List',
      description: 'Index of the persisted Minecraft dimensions',
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
                  dimensionState(world, dimension)
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
