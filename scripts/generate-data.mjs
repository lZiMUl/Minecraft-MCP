/**
 * Regenerate the checked-in registry data from minecraft-data.
 *
 * Usage: node scripts/generate-data.mjs [version] [blocks.json] [items.json] [entities.json]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [versionArg, blocksSource, itemsSource, entitiesSource] =
  process.argv.slice(2);
const MC_VERSION = versionArg ?? "26.1";
const BASE_URL = `https://raw.githubusercontent.com/PrismarineJS/minecraft-data/master/data/pc/${MC_VERSION}`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadJson(source, fallbackUrl) {
  if (source && fs.existsSync(source)) {
    return JSON.parse(fs.readFileSync(source, "utf8"));
  }
  const response = await fetch(fallbackUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${fallbackUrl}: ${response.status}`);
  }
  return response.json();
}

/**
 * Render a string or string array as a single-quoted TypeScript literal.
 * Using one helper keeps generated files compatible with the project's
 * Prettier configuration instead of emitting JSON double quotes.
 */
function tsValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map(tsValue).join(", ")}]`;
  }
  const escaped = String(value)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
  return `'${escaped}'`;
}

function generateVersion() {
  return `export const MINECRAFT_DATA_VERSION = '${MC_VERSION}';
`;
}

function generateBlocks(blocks) {
  const boxEnum = { empty: "EBoundingBox.Empty", block: "EBoundingBox.Block" };
  for (const b of blocks) {
    if (!boxEnum[b.boundingBox]) {
      throw new Error(
        `Unknown boundingBox value: ${b.boundingBox} (${b.name})`,
      );
    }
  }
  const body = blocks
    .map((b) => {
      const parts = [
        `id: ${b.id}`,
        `key: ${tsValue(`minecraft:${b.name}`)}`,
        `name: ${tsValue(b.name)}`,
        `displayName: ${tsValue(b.displayName)}`,
        `hardness: ${b.hardness}`,
        `resistance: ${b.resistance}`,
        `stackSize: ${b.stackSize}`,
        `diggable: ${b.diggable}`,
        `material: ${tsValue(b.material)}`,
        `transparent: ${b.transparent}`,
        `emitLight: ${b.emitLight}`,
        `filterLight: ${b.filterLight}`,
        `boundingBox: ${boxEnum[b.boundingBox]}`,
      ];
      return `  { ${parts.join(", ")} },`;
    })
    .join("\n");

  return `import { EBoundingBox } from '../enums/bounding-box.enum.js';

import type { IBlock } from '../interfaces/block.interface.js';

export const MINECRAFT_BLOCKS: readonly IBlock[] = [
${body}
];

export const MINECRAFT_BLOCK_COUNT = MINECRAFT_BLOCKS.length;

const blocksByName = new Map<string, IBlock>();
for (const block of MINECRAFT_BLOCKS) {
  blocksByName.set(block.name, block);
  blocksByName.set(block.key, block);
}

export function getBlockByName(name: string): IBlock | undefined {
  return blocksByName.get(name);
}
`;
}

function generateItems(items) {
  const body = items
    .map((it) => {
      const parts = [
        `id: ${it.id}`,
        `key: ${tsValue(`minecraft:${it.name}`)}`,
        `name: ${tsValue(it.name)}`,
        `displayName: ${tsValue(it.displayName)}`,
        `stackSize: ${it.stackSize}`,
      ];
      if (it.maxDurability) parts.push(`maxDurability: ${it.maxDurability}`);
      if (it.enchantCategories) {
        parts.push(`enchantCategories: ${tsValue(it.enchantCategories)}`);
      }
      if (it.repairWith) parts.push(`repairWith: ${tsValue(it.repairWith)}`);
      return `  { ${parts.join(", ")} },`;
    })
    .join("\n");

  return `import type { IItem } from '../interfaces/item.interface.js';

export const MINECRAFT_ITEMS: readonly IItem[] = [
${body}
];

export const MINECRAFT_ITEM_COUNT = MINECRAFT_ITEMS.length;

const itemsByName = new Map<string, IItem>();
for (const item of MINECRAFT_ITEMS) {
  itemsByName.set(item.name, item);
  itemsByName.set(item.key, item);
}

export function getItemByName(name: string): IItem | undefined {
  return itemsByName.get(name);
}
`;
}

function generateEntities(entities) {
  for (const entity of entities) {
    if (
      typeof entity.name !== "string" ||
      typeof entity.displayName !== "string" ||
      typeof entity.type !== "string" ||
      typeof entity.category !== "string" ||
      typeof entity.width !== "number" ||
      typeof entity.height !== "number"
    ) {
      throw new Error(`Invalid entity entry: ${JSON.stringify(entity.name)}`);
    }
  }
  const body = entities
    .map((entity) => {
      const parts = [
        `    id: ${entity.id}`,
        `    key: ${tsValue(`minecraft:${entity.name}`)}`,
        `    name: ${tsValue(entity.name)}`,
        `    displayName: ${tsValue(entity.displayName)}`,
        `    type: ${tsValue(entity.type)}`,
        `    category: ${tsValue(entity.category)}`,
        `    width: ${entity.width}`,
        `    height: ${entity.height}`,
      ];
      return `  {\n${parts.join(",\n")}\n  }`;
    })
    .join(",\n");

  return `import type { IEntityType } from '../interfaces/entity-type.interface.js';

export const MINECRAFT_ENTITY_TYPES: readonly IEntityType[] = [
${body}
];

export const MINECRAFT_ENTITY_COUNT = MINECRAFT_ENTITY_TYPES.length;

const entityTypesByName = new Map<string, IEntityType>();
for (const entity of MINECRAFT_ENTITY_TYPES) {
  entityTypesByName.set(entity.name, entity);
  entityTypesByName.set(entity.key, entity);
}

export function getEntityTypeByName(name: string): IEntityType | undefined {
  return entityTypesByName.get(name);
}
`;
}

const blocks = await loadJson(blocksSource, `${BASE_URL}/blocks.json`);
const items = await loadJson(itemsSource, `${BASE_URL}/items.json`);
const entities = await loadJson(entitiesSource, `${BASE_URL}/entities.json`);

const dataDir = path.join(root, "src", "data");
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, "version.ts"), generateVersion(), "utf8");
fs.writeFileSync(
  path.join(dataDir, "blocks.ts"),
  generateBlocks(blocks),
  "utf8",
);
fs.writeFileSync(path.join(dataDir, "items.ts"), generateItems(items), "utf8");
fs.writeFileSync(
  path.join(dataDir, "entities.ts"),
  generateEntities(entities),
  "utf8",
);

console.log(
  `Generated version.ts, blocks.ts (${blocks.length}), items.ts (${items.length}) and entities.ts (${entities.length}) for Java ${MC_VERSION}`,
);
