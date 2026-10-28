import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { WORLD_LIMITS } from '../config/world-limits.js';
import { getEntityTypeByName } from '../data/entities.js';
import { EInventorySection } from '../enums/inventory-section.enum.js';
import { EMoveDirection } from '../enums/move-direction.enum.js';
import { blockPositionShape } from '../schemas/coordinate-schema.js';
import { dimensionField } from '../schemas/dimension-schema.js';
import {
  entityInfoSchema,
  entitySummarySchema,
  inventoryChangeSchema,
  inventoryViewSchema,
  itemStackSchema,
  toEntityInfo,
  toEntitySummary,
  toInventoryView,
  toItemStackInfo
} from '../schemas/entity-schema.js';
import { toErrorMessage } from '../utils/error-message.js';
import {
  HOTBAR_SLOT_COUNT,
  INVENTORY_SLOT_COUNT,
  slotCount
} from '../world/entity-inventory.js';
import { parseItemSpec } from '../world/item-spec.js';
import { coordinateRangeError, toolError } from './result.js';

import type { IEntity } from '../interfaces/entity.interface.js';
import type { IItemStack } from '../interfaces/entity-inventory.interface.js';
import type { IEntityType } from '../interfaces/entity-type.interface.js';
import type { World } from '../world/world.js';

const entityIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(WORLD_LIMITS.maxEntityIdLength)
  .describe('Entity UUID returned by createEntity or createPlayer');

const targetSchema = z
  .string()
  .trim()
  .min(1)
  .max(WORLD_LIMITS.maxEntityIdLength)
  .describe('Entity UUID or player name (player names are case-insensitive)');

const playerNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(WORLD_LIMITS.maxPlayerNameLength)
  .regex(
    /^[A-Za-z0-9_]+$/u,
    'Player names may only contain letters, digits and underscores'
  )
  .describe('Unique player name (letters, digits and underscores)');

const entityNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(WORLD_LIMITS.maxEntityNameLength)
  .optional()
  .describe('Optional display name; defaults to the entity type display name');

const itemIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .describe(
    'Item id, such as "minecraft:diamond_sword" or "diamond_sword". Use "minecraft:air" or count 0 to clear the slot.'
  );

const entityPositionShape = {
  x: z.number().int(),
  y: z.number().int(),
  z: z.number().int()
} as const;

const entityPositionSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  ...entityPositionShape
});

const entityMovementSchema = entityPositionSchema.extend({
  direction: z.enum(EMoveDirection),
  previous: z.object(entityPositionShape)
});

const entityPositionChangeSchema = entityPositionSchema.extend({
  previous: z.object(entityPositionShape)
});

const inventoryClearSchema = inventoryViewSchema.extend({
  clearedSlots: z.number().int()
});

const inventorySwapSchema = inventoryViewSchema.extend({
  fromSection: z.enum(EInventorySection),
  fromSlot: z.number().int(),
  toSection: z.enum(EInventorySection),
  toSlot: z.number().int(),
  previousFrom: itemStackSchema.nullable(),
  previousTo: itemStackSchema.nullable()
});

/** Convert one entity to the compact position response. */
function toEntityPosition(entity: IEntity): {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  z: number;
} {
  return {
    id: entity.id,
    type: entity.type.key,
    name: entity.name,
    x: entity.x,
    y: entity.y,
    z: entity.z
  };
}

/** Resolve a short or namespaced entity type id. */
function resolveEntityType(input: string): IEntityType | undefined {
  const normalized = input.trim().toLowerCase();
  return (
    getEntityTypeByName(normalized) ??
    getEntityTypeByName(`minecraft:${normalized}`)
  );
}

/** Resolve an inventory target by entity UUID first, then player name. */
function resolveTarget(world: World, target: string): IEntity | undefined {
  const normalized = target.trim();
  return world.findEntity(normalized) ?? world.findPlayer(normalized);
}

/** Shared error for an inventory target that does not exist. */
function unknownTargetError(target: string): ReturnType<typeof toolError> {
  return toolError(
    `Unknown entity or player "${target}". Use an entity UUID from createEntity/createPlayer or a player name.`
  );
}

/** Small helper for tool text content. */
function text(message: string): { type: 'text'; text: string } {
  return { type: 'text', text: message };
}

/** Register entity, player and inventory tools. */
export function registerEntityTools(server: McpServer, world: World): void {
  server.registerTool(
    'createEntity',
    {
      title: 'Create Entity',
      description:
        'Create a non-player entity (mob, projectile, vehicle, etc.) in a dimension with an empty 9-slot hotbar and 27-slot backpack. Entity ids come from the generated registry; see the resource lzimul://minecraft/entities for the full list. Use createPlayer for players.',
      inputSchema: z.object({
        type: z
          .string()
          .trim()
          .min(1)
          .max(128)
          .describe(
            'Entity id, such as "minecraft:zombie" or "zombie"; see lzimul://minecraft/entities'
          ),
        ...blockPositionShape,
        dimension: dimensionField,
        name: entityNameSchema
      }),
      outputSchema: entityInfoSchema,
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ type: typeId, x, y, z, dimension: dimensionType, name }) => {
      try {
        const type = resolveEntityType(typeId);
        if (!type) {
          return toolError(
            `Unknown entity type "${typeId}". Use an id such as "minecraft:zombie"; see the resource lzimul://minecraft/entities for the full list.`
          );
        }
        if (type.name === 'player') {
          return toolError(
            'The minecraft:player type cannot be created with createEntity. Use createPlayer instead.'
          );
        }

        const dimension = world.getDimension(dimensionType);
        if (!dimension.contains(x, y, z)) {
          return coordinateRangeError(dimension.info, x, y, z);
        }
        if (!dimension.canAddEntity()) {
          return toolError(
            `The ${dimension.info.displayName} world already holds the maximum of ${WORLD_LIMITS.maxEntitiesPerDimension} entities.`
          );
        }

        const entity = dimension.createEntity(
          type,
          name ?? type.displayName,
          x,
          y,
          z
        );
        try {
          await dimension.flush();
        } catch (error) {
          return toolError(
            `Entity ${type.key} "${entity.name}" was created at (${x}, ${y}, ${z}) in ${dimension.info.displayName} but could not be persisted to the world store: ${toErrorMessage(error)}`
          );
        }

        return {
          content: [
            text(
              `Created ${entity.type.displayName} "${entity.name}" (${entity.type.key}) with id ${entity.id} at (${x}, ${y}, ${z}) in ${dimension.info.displayName}`
            )
          ],
          structuredContent: toEntityInfo(entity)
        };
      } catch (error) {
        return toolError(`createEntity failed: ${toErrorMessage(error)}`);
      }
    }
  );

  server.registerTool(
    'getEntity',
    {
      title: 'Get Entity',
      description:
        'Get an entity or player by UUID, including its type, position, dimension, creation time and full hotbar/backpack contents. Use getInventory or setInventory to change items.',
      inputSchema: z.object({
        id: entityIdSchema
      }),
      outputSchema: entityInfoSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ id }) => {
      try {
        const entity = world.findEntity(id);
        if (!entity) {
          return toolError(
            `Unknown entity "${id}". Use the id returned by createEntity or createPlayer; use getPlayer for a player name.`
          );
        }
        const info = toEntityInfo(entity);
        return {
          content: [
            text(
              `${info.typeDisplayName} "${info.name}" (${info.type}, ${info.kind}) at (${info.x}, ${info.y}, ${info.z}) in ${info.dimension}; ${info.usedSlots}/${info.totalSlots} inventory slots used`
            )
          ],
          structuredContent: info
        };
      } catch (error) {
        return toolError(`getEntity failed: ${toErrorMessage(error)}`);
      }
    }
  );

  server.registerTool(
    'createPlayer',
    {
      title: 'Create Player',
      description:
        'Create a uniquely named player in a dimension with an empty 9-slot hotbar and 27-slot backpack. Player names are case-insensitively unique across the whole world (all dimensions).',
      inputSchema: z.object({
        name: playerNameSchema,
        ...blockPositionShape,
        dimension: dimensionField
      }),
      outputSchema: entityInfoSchema,
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ name, x, y, z, dimension: dimensionType }) => {
      try {
        const existing = world.findPlayer(name);
        if (existing) {
          const where = world.getDimension(existing.dimension).info.displayName;
          return toolError(
            `A player named "${name}" already exists in ${where}. Player names are case-insensitive and unique across all dimensions.`
          );
        }

        const dimension = world.getDimension(dimensionType);
        if (!dimension.contains(x, y, z)) {
          return coordinateRangeError(dimension.info, x, y, z);
        }
        if (!dimension.canAddEntity()) {
          return toolError(
            `The ${dimension.info.displayName} world already holds the maximum of ${WORLD_LIMITS.maxEntitiesPerDimension} entities.`
          );
        }

        const player = dimension.createPlayer(name, x, y, z);
        try {
          await dimension.flush();
        } catch (error) {
          return toolError(
            `Player "${name}" was created at (${x}, ${y}, ${z}) in ${dimension.info.displayName} but could not be persisted to the world store: ${toErrorMessage(error)}`
          );
        }

        return {
          content: [
            text(
              `Created player "${player.name}" with id ${player.id} at (${x}, ${y}, ${z}) in ${dimension.info.displayName}`
            )
          ],
          structuredContent: toEntityInfo(player)
        };
      } catch (error) {
        return toolError(`createPlayer failed: ${toErrorMessage(error)}`);
      }
    }
  );

  server.registerTool(
    'getPlayer',
    {
      title: 'Get Player',
      description:
        'Get a player by name (case-insensitive), including position, dimension, creation time and full hotbar/backpack contents.',
      inputSchema: z.object({
        name: playerNameSchema
      }),
      outputSchema: entityInfoSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ name }) => {
      try {
        const player = world.findPlayer(name);
        if (!player) {
          return toolError(
            `Unknown player "${name}". Player names are case-insensitive; use createPlayer to create one.`
          );
        }
        const info = toEntityInfo(player);
        return {
          content: [
            text(
              `Player "${info.name}" (${info.id}) at (${info.x}, ${info.y}, ${info.z}) in ${info.dimension}; ${info.usedSlots}/${info.totalSlots} inventory slots used`
            )
          ],
          structuredContent: info
        };
      } catch (error) {
        return toolError(`getPlayer failed: ${toErrorMessage(error)}`);
      }
    }
  );

  server.registerTool(
    'deleteEntity',
    {
      title: 'Delete Entity',
      description:
        'Delete one entity or player by UUID or player name. The entity is removed from its dimension and its inventory is discarded. Player names become available again after deletion.',
      inputSchema: z.object({
        target: targetSchema
      }),
      outputSchema: entitySummarySchema,
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ target }) => {
      try {
        const entity = resolveTarget(world, target);
        if (!entity) {
          return unknownTargetError(target);
        }
        const dimension = world.getDimension(entity.dimension);
        const deleted = dimension.deleteEntity(entity.id) ?? entity;
        try {
          await dimension.flush();
        } catch (error) {
          return toolError(
            `Entity "${deleted.name}" was deleted but could not be persisted to the world store: ${toErrorMessage(error)}`
          );
        }
        return {
          content: [
            text(
              `Deleted ${deleted.kind} "${deleted.name}" (${deleted.id}, ${deleted.type.key}) from ${dimension.info.displayName}`
            )
          ],
          structuredContent: toEntitySummary(deleted)
        };
      } catch (error) {
        return toolError(`deleteEntity failed: ${toErrorMessage(error)}`);
      }
    }
  );

  server.registerTool(
    'moveEntity',
    {
      title: 'Move Entity',
      description:
        'Move one entity or player exactly one block in a fixed direction: forward (+Z, south), back (-Z, north), left (-X, west), right (+X, east), up (+Y) or down (-Y). The destination must stay inside the entity dimension.',
      inputSchema: z.object({
        id: entityIdSchema,
        direction: z
          .enum(EMoveDirection)
          .describe(
            'One-block direction: forward (+Z), back (-Z), left (-X), right (+X), up (+Y), down (-Y)'
          )
      }),
      outputSchema: entityMovementSchema,
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ id, direction }) => {
      try {
        const entity = world.findEntity(id);
        if (!entity) {
          return toolError(
            `Unknown entity "${id}". Use an entity UUID returned by createEntity or createPlayer.`
          );
        }
        const dimension = world.getDimension(entity.dimension);
        const { previous, entity: moved } = dimension.moveEntity(id, direction);
        try {
          await dimension.flush();
        } catch (error) {
          return toolError(
            `Entity "${moved.name}" was moved but could not be persisted to the world store: ${toErrorMessage(error)}`
          );
        }
        return {
          content: [
            text(
              `Moved ${moved.name} (${moved.id}) ${direction} from (${previous.x}, ${previous.y}, ${previous.z}) to (${moved.x}, ${moved.y}, ${moved.z}) in ${dimension.info.displayName}`
            )
          ],
          structuredContent: {
            ...toEntityPosition(moved),
            direction,
            previous
          }
        };
      } catch (error) {
        return toolError(`moveEntity failed: ${toErrorMessage(error)}`);
      }
    }
  );

  server.registerTool(
    'getEntityPosition',
    {
      title: 'Get Entity Position',
      description:
        'Get the UUID, entity type, name and exact x/y/z position of one entity or player.',
      inputSchema: z.object({
        id: entityIdSchema
      }),
      outputSchema: entityPositionSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ id }) => {
      try {
        const entity = world.findEntity(id);
        if (!entity) {
          return toolError(
            `Unknown entity "${id}". Use an entity UUID returned by createEntity or createPlayer.`
          );
        }
        const position = toEntityPosition(entity);
        return {
          content: [
            text(
              `${position.name} (${position.type}, ${position.id}) is at (${position.x}, ${position.y}, ${position.z})`
            )
          ],
          structuredContent: position
        };
      } catch (error) {
        return toolError(`getEntityPosition failed: ${toErrorMessage(error)}`);
      }
    }
  );

  server.registerTool(
    'setEntityPosition',
    {
      title: 'Set Entity Position',
      description:
        'Set the exact x/y/z position of one entity or player. The position must stay inside the entity dimension.',
      inputSchema: z.object({
        id: entityIdSchema,
        position: z.object(blockPositionShape)
      }),
      outputSchema: entityPositionChangeSchema,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ id, position }) => {
      try {
        const entity = world.findEntity(id);
        if (!entity) {
          return toolError(
            `Unknown entity "${id}". Use an entity UUID returned by createEntity or createPlayer.`
          );
        }
        const dimension = world.getDimension(entity.dimension);
        if (!dimension.contains(position.x, position.y, position.z)) {
          return coordinateRangeError(
            dimension.info,
            position.x,
            position.y,
            position.z
          );
        }
        const { previous, entity: updated } = dimension.setEntityPosition(
          id,
          position.x,
          position.y,
          position.z
        );
        try {
          await dimension.flush();
        } catch (error) {
          return toolError(
            `Entity "${updated.name}" was moved but could not be persisted to the world store: ${toErrorMessage(error)}`
          );
        }
        return {
          content: [
            text(
              `Set ${updated.name} (${updated.id}) position from (${previous.x}, ${previous.y}, ${previous.z}) to (${updated.x}, ${updated.y}, ${updated.z}) in ${dimension.info.displayName}`
            )
          ],
          structuredContent: {
            ...toEntityPosition(updated),
            previous
          }
        };
      } catch (error) {
        return toolError(`setEntityPosition failed: ${toErrorMessage(error)}`);
      }
    }
  );

  server.registerTool(
    'getInventory',
    {
      title: 'Get Inventory',
      description:
        'Get the full inventory of an entity or player: the 9 hotbar slots and the 27 backpack slots, plus used-slot counts. Empty slots are null. The target is an entity UUID or a player name.',
      inputSchema: z.object({
        target: targetSchema
      }),
      outputSchema: inventoryViewSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ target }) => {
      try {
        const entity = resolveTarget(world, target);
        if (!entity) {
          return unknownTargetError(target);
        }
        const view = toInventoryView(entity);
        return {
          content: [
            text(
              `${entity.name} (${entity.kind}, ${entity.type.key}): ${view.usedSlots}/${view.totalSlots} inventory slots used (hotbar ${view.hotbarUsed}/${HOTBAR_SLOT_COUNT}, backpack ${view.inventoryUsed}/${INVENTORY_SLOT_COUNT})`
            )
          ],
          structuredContent: view
        };
      } catch (error) {
        return toolError(`getInventory failed: ${toErrorMessage(error)}`);
      }
    }
  );

  server.registerTool(
    'clearInventory',
    {
      title: 'Clear Inventory',
      description:
        'Remove every item from the 9 hotbar slots and 27 backpack slots of one entity or player. The target is an entity UUID or a player name. The cleared slot count is returned.',
      inputSchema: z.object({
        target: targetSchema
      }),
      outputSchema: inventoryClearSchema,
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ target }) => {
      try {
        const entity = resolveTarget(world, target);
        if (!entity) {
          return unknownTargetError(target);
        }
        const dimension = world.getDimension(entity.dimension);
        const { clearedSlots, entity: updated } = dimension.clearInventory(
          entity.id
        );
        if (clearedSlots > 0) {
          try {
            await dimension.flush();
          } catch (error) {
            return toolError(
              `The inventory of "${updated.name}" was cleared but could not be persisted to the world store: ${toErrorMessage(error)}`
            );
          }
        }
        return {
          content: [
            text(
              clearedSlots > 0
                ? `Cleared ${clearedSlots} inventory slot(s) of "${updated.name}"`
                : `The inventory of "${updated.name}" was already empty`
            )
          ],
          structuredContent: {
            ...toInventoryView(updated),
            clearedSlots
          }
        };
      } catch (error) {
        return toolError(`clearInventory failed: ${toErrorMessage(error)}`);
      }
    }
  );

  server.registerTool(
    'swapInventorySlots',
    {
      title: 'Swap Inventory Slots',
      description:
        'Swap two inventory slots of one entity or player. section is "hotbar" (slots 0-8) or "inventory" (backpack, slots 0-26). Both slots may be in the same or different sections. The target is an entity UUID or a player name.',
      inputSchema: z.object({
        target: targetSchema,
        fromSection: z
          .enum(EInventorySection)
          .describe('"hotbar" or "inventory" for the first slot'),
        fromSlot: z
          .number()
          .int()
          .min(0)
          .max(INVENTORY_SLOT_COUNT - 1)
          .describe('First slot index (hotbar 0-8, backpack 0-26)'),
        toSection: z
          .enum(EInventorySection)
          .describe('"hotbar" or "inventory" for the second slot'),
        toSlot: z
          .number()
          .int()
          .min(0)
          .max(INVENTORY_SLOT_COUNT - 1)
          .describe('Second slot index (hotbar 0-8, backpack 0-26)')
      }),
      outputSchema: inventorySwapSchema,
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ target, fromSection, fromSlot, toSection, toSlot }) => {
      try {
        const entity = resolveTarget(world, target);
        if (!entity) {
          return unknownTargetError(target);
        }
        const fromMax = slotCount(fromSection) - 1;
        if (fromSlot > fromMax) {
          return toolError(
            `Slot ${fromSlot} is out of range for the ${fromSection} section (0-${fromMax}).`
          );
        }
        const toMax = slotCount(toSection) - 1;
        if (toSlot > toMax) {
          return toolError(
            `Slot ${toSlot} is out of range for the ${toSection} section (0-${toMax}).`
          );
        }

        const dimension = world.getDimension(entity.dimension);
        const {
          previousFrom,
          previousTo,
          entity: updated
        } = dimension.swapInventorySlots(
          entity.id,
          fromSection,
          fromSlot,
          toSection,
          toSlot
        );
        try {
          await dimension.flush();
        } catch (error) {
          return toolError(
            `The inventory slots of "${updated.name}" were swapped but could not be persisted to the world store: ${toErrorMessage(error)}`
          );
        }
        return {
          content: [
            text(
              `Swapped ${fromSection} slot ${fromSlot} with ${toSection} slot ${toSlot} of "${updated.name}"`
            )
          ],
          structuredContent: {
            ...toInventoryView(updated),
            fromSection,
            fromSlot,
            toSection,
            toSlot,
            previousFrom: previousFrom ? toItemStackInfo(previousFrom) : null,
            previousTo: previousTo ? toItemStackInfo(previousTo) : null
          }
        };
      } catch (error) {
        return toolError(`swapInventorySlots failed: ${toErrorMessage(error)}`);
      }
    }
  );

  server.registerTool(
    'setInventory',
    {
      title: 'Set Inventory',
      description:
        'Set one inventory slot of an entity or player. section is "hotbar" (slots 0-8) or "inventory" (backpack, slots 0-26). The item is validated against the item registry and the count must fit the item stack size. Use "minecraft:air" or count 0 to clear a slot. The target is an entity UUID or a player name.',
      inputSchema: z.object({
        target: targetSchema,
        section: z
          .enum(EInventorySection)
          .default(EInventorySection.Inventory)
          .describe(
            '"hotbar" for the 9 hotbar slots or "inventory" for the 27 backpack slots'
          ),
        slot: z
          .number()
          .int()
          .min(0)
          .max(INVENTORY_SLOT_COUNT - 1)
          .describe(
            'Slot index within the section (hotbar 0-8, backpack 0-26)'
          ),
        item: itemIdSchema,
        count: z
          .number()
          .int()
          .min(0)
          .max(64)
          .default(1)
          .describe('Stack count (1 to the item stack size); 0 clears the slot')
      }),
      outputSchema: inventoryChangeSchema,
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ target, section, slot, item, count }) => {
      try {
        const entity = resolveTarget(world, target);
        if (!entity) {
          return unknownTargetError(target);
        }

        const maxSlot = slotCount(section) - 1;
        if (slot > maxSlot) {
          return toolError(
            `Slot ${slot} is out of range for the ${section} section (0-${maxSlot}).`
          );
        }

        const spec = parseItemSpec(item);
        if (!spec.ok) {
          return toolError(spec.error);
        }

        const isAir = spec.item.key === 'minecraft:air';
        let stack: IItemStack | null = null;
        if (!isAir && count > 0) {
          if (count > spec.item.stackSize) {
            return toolError(
              `${spec.item.displayName} stacks up to ${spec.item.stackSize} per slot; received ${count}.`
            );
          }
          stack = { item: spec.item.key, count };
        }

        const dimension = world.getDimension(entity.dimension);
        const { previous, entity: updated } = dimension.setInventorySlot(
          entity.id,
          section,
          slot,
          stack
        );
        try {
          await dimension.flush();
        } catch (error) {
          return toolError(
            `The ${section} slot ${slot} of "${updated.name}" was changed but could not be persisted to the world store: ${toErrorMessage(error)}`
          );
        }

        const message = stack
          ? `Set ${section} slot ${slot} of "${updated.name}" to ${spec.item.displayName} x${stack.count}`
          : `Cleared ${section} slot ${slot} of "${updated.name}"`;
        return {
          content: [text(message)],
          structuredContent: {
            ...toInventoryView(updated),
            section,
            slot,
            previous: previous ? toItemStackInfo(previous) : null,
            item: stack ? toItemStackInfo(stack) : null
          }
        };
      } catch (error) {
        return toolError(`setInventory failed: ${toErrorMessage(error)}`);
      }
    }
  );
}
