/**
 * Exhaustive contract test for every tool and every listed resource.
 *
 * The test starts the real stdio server against a temporary world directory,
 * validates every tool result against its advertised output schema, then reads
 * all static registry resources and all live dimension resources. It also
 * checks cross-resource consistency, such as registry counts, per-entry keys,
 * entity inventories and dimension state counts.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MINECRAFT_BLOCK_COUNT } from "../build/data/blocks.js";
import { MINECRAFT_ENTITY_COUNT } from "../build/data/entities.js";
import { MINECRAFT_ITEM_COUNT } from "../build/data/items.js";
import { clientEnvelope, PROTOCOL_VERSION } from "./protocol.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_RESOURCES =
  MINECRAFT_BLOCK_COUNT + MINECRAFT_ITEM_COUNT + MINECRAFT_ENTITY_COUNT + 7;
const dataDir = await mkdtemp(path.join(tmpdir(), "lzimul-exhaustive-"));
const proc = spawn("node", ["build/index.js"], {
  cwd: root,
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, MCP_WORLD_STORAGE: "file", MCP_WORLD_DIR: dataDir },
});

const checks = [];
const pending = new Map();
let nextId = 1;
let buffer = "";

function check(name, condition, detail) {
  checks.push({ name, pass: Boolean(condition), detail });
  const suffix = detail ? ` (${detail})` : "";
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${suffix}`);
}

function settle(message) {
  const waiter = pending.get(message.id);
  if (!waiter) {
    return;
  }
  pending.delete(message.id);
  waiter(message);
}

proc.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) {
      continue;
    }
    settle(JSON.parse(line));
  }
});

proc.on("exit", (code) => {
  for (const [id, waiter] of pending) {
    pending.delete(id);
    waiter({ error: { message: `Server exited with code ${code}` } });
  }
});

function rpc(method, params = {}, timeoutMs = 30_000) {
  const id = nextId++;
  const message = {
    jsonrpc: "2.0",
    id,
    method,
    params: { ...params, _meta: clientEnvelope("exhaustive-test") },
  };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout waiting for ${method} (id ${id})`));
    }, timeoutMs);
    pending.set(id, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
    proc.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isInteger(value) {
  return Number.isInteger(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function matchesType(type, value) {
  switch (type) {
    case "object":
      return isObject(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return isInteger(value);
    case "number":
      return isFiniteNumber(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}

/**
 * Validate the JSON Schema subset emitted by the MCP SDK. The full schemas are
 * small: object properties, required keys, additionalProperties, arrays,
 * enums, anyOf and numeric bounds are enough for this server.
 */
function validateSchema(schema, value, at, errors) {
  if (!isObject(schema)) {
    return;
  }

  if (Array.isArray(schema.anyOf)) {
    const branches = schema.anyOf.map((branch) => {
      const branchErrors = [];
      validateSchema(branch, value, at, branchErrors);
      return branchErrors;
    });
    if (!branches.some((branchErrors) => branchErrors.length === 0)) {
      errors.push(`${at}: no anyOf branch matched`);
      return;
    }
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(type, value))) {
      errors.push(`${at}: expected ${types.join("|")}`);
      return;
    }
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${at}: expected constant ${JSON.stringify(schema.const)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${at}: value is not one of ${schema.enum.join(", ")}`);
  }

  if (isFiniteNumber(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${at}: below minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${at}: above maximum ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${at}: fewer than ${schema.minItems} items`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${at}: more than ${schema.maxItems} items`);
    }
    if (schema.items !== undefined) {
      value.forEach((item, index) =>
        validateSchema(schema.items, item, `${at}[${index}]`, errors),
      );
    }
  }

  if (isObject(value)) {
    if (schema.propertyNames !== undefined) {
      for (const key of Object.keys(value)) {
        validateSchema(schema.propertyNames, key, `${at}.${key}`, errors);
      }
    }
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!(key in value)) {
          errors.push(`${at}.${key}: missing required property`);
        }
      }
    }
    const known = isObject(schema.properties) ? schema.properties : {};
    for (const [key, child] of Object.entries(known)) {
      if (key in value) {
        validateSchema(child, value[key], `${at}.${key}`, errors);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in known)) {
          errors.push(`${at}.${key}: additional property is not allowed`);
        }
      }
    } else if (isObject(schema.additionalProperties)) {
      for (const key of Object.keys(value)) {
        if (!(key in known)) {
          validateSchema(
            schema.additionalProperties,
            value[key],
            `${at}.${key}`,
            errors,
          );
        }
      }
    }
  }
}

const toolOutputSchemas = new Map();

async function callTool(name, args) {
  const response = await rpc("tools/call", { name, arguments: args }, 60_000);
  const result = response.result;
  check(`${name}: JSON-RPC result`, Boolean(result) && !response.error);
  check(`${name}: not an error result`, result?.isError !== true);
  check(
    `${name}: modern result type`,
    result?.resultType === "complete",
    result?.resultType,
  );
  const content = Array.isArray(result?.content) ? result.content : [];
  check(
    `${name}: non-empty text content`,
    content.length > 0 &&
      content.every(
        (part) => part.type === "text" && isNonEmptyString(part.text ?? ""),
      ),
  );

  const schema = toolOutputSchemas.get(name);
  const schemaErrors = [];
  if (schema) {
    validateSchema(
      schema,
      result?.structuredContent,
      `${name}.output`,
      schemaErrors,
    );
  } else {
    schemaErrors.push(`${name}: no advertised output schema`);
  }
  check(
    `${name}: output schema`,
    schemaErrors.length === 0,
    schemaErrors.slice(0, 4).join("; "),
  );
  return result?.structuredContent;
}

function requireObject(value, at, errors) {
  if (!isObject(value)) {
    errors.push(`${at}: expected object`);
    return false;
  }
  return true;
}

function requireKeys(value, keys, at, errors) {
  for (const key of keys) {
    if (!(key in value)) {
      errors.push(`${at}.${key}: missing`);
    }
  }
}

function allowOnlyKeys(value, keys, at, errors) {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      errors.push(`${at}.${key}: unexpected`);
    }
  }
}

function validateRegistryEntry(entry, at, errors, optional = []) {
  if (!requireObject(entry, at, errors)) {
    return;
  }
  const required = ["id", "key", "name", "displayName"];
  const allowed = [...required, ...optional];
  requireKeys(entry, required, at, errors);
  allowOnlyKeys(entry, allowed, at, errors);
  if (!isInteger(entry.id)) {
    errors.push(`${at}.id: expected integer`);
  }
  for (const key of ["key", "name", "displayName"]) {
    if (!isNonEmptyString(entry[key])) {
      errors.push(`${at}.${key}: expected non-empty string`);
    }
  }
  if (isNonEmptyString(entry.name) && entry.key !== `minecraft:${entry.name}`) {
    errors.push(`${at}.key: does not match name`);
  }
}

function validateRegistryIndex(entries, expected, at, errors) {
  if (!Array.isArray(entries)) {
    errors.push(`${at}: expected array`);
    return;
  }
  if (entries.length !== expected) {
    errors.push(`${at}: expected ${expected} entries, got ${entries.length}`);
  }
  entries.forEach((entry, index) =>
    validateRegistryEntry(entry, `${at}[${index}]`, errors),
  );
}

function validateItemStack(stack, at, errors) {
  if (stack === null) {
    return;
  }
  if (
    !requireObject(stack, at, errors) ||
    !requireKeys(stack, ["item", "count"], at, errors)
  ) {
    return;
  }
  allowOnlyKeys(stack, ["item", "count"], at, errors);
  if (!isNonEmptyString(stack.item)) {
    errors.push(`${at}.item: expected non-empty string`);
  }
  if (!isInteger(stack.count) || stack.count < 1) {
    errors.push(`${at}.count: expected positive integer`);
  }
}

function validateSlotArray(slots, expected, at, errors) {
  if (!Array.isArray(slots)) {
    errors.push(`${at}: expected array`);
    return 0;
  }
  if (slots.length !== expected) {
    errors.push(`${at}: expected ${expected} slots, got ${slots.length}`);
  }
  let used = 0;
  slots.forEach((stack, index) => {
    if (stack !== null) {
      used++;
    }
    validateItemStack(stack, `${at}[${index}]`, errors);
  });
  return used;
}

function validateEntityInfo(entity, at, errors) {
  if (!requireObject(entity, at, errors)) {
    return;
  }
  const keys = [
    "id",
    "kind",
    "type",
    "typeDisplayName",
    "category",
    "name",
    "x",
    "y",
    "z",
    "dimension",
    "createdAt",
    "usedSlots",
    "totalSlots",
    "inventory",
  ];
  requireKeys(entity, keys, at, errors);
  allowOnlyKeys(entity, keys, at, errors);
  if (!isNonEmptyString(entity.id)) {
    errors.push(`${at}.id: expected non-empty string`);
  }
  if (!["entity", "player"].includes(entity.kind)) {
    errors.push(`${at}.kind: expected entity or player`);
  }
  for (const key of [
    "type",
    "typeDisplayName",
    "category",
    "name",
    "dimension",
  ]) {
    if (!isNonEmptyString(entity[key])) {
      errors.push(`${at}.${key}: expected non-empty string`);
    }
  }
  for (const key of ["x", "y", "z"]) {
    if (!isFiniteNumber(entity[key])) {
      errors.push(`${at}.${key}: expected finite number`);
    }
  }
  if (
    !isNonEmptyString(entity.createdAt) ||
    Number.isNaN(Date.parse(entity.createdAt))
  ) {
    errors.push(`${at}.createdAt: expected ISO date`);
  }
  if (entity.totalSlots !== 36) {
    errors.push(`${at}.totalSlots: expected 36`);
  }
  if (requireObject(entity.inventory, `${at}.inventory`, errors)) {
    const inventoryKeys = ["hotbar", "inventory"];
    requireKeys(entity.inventory, inventoryKeys, `${at}.inventory`, errors);
    allowOnlyKeys(entity.inventory, inventoryKeys, `${at}.inventory`, errors);
    const hotbarUsed = validateSlotArray(
      entity.inventory.hotbar,
      9,
      `${at}.inventory.hotbar`,
      errors,
    );
    const inventoryUsed = validateSlotArray(
      entity.inventory.inventory,
      27,
      `${at}.inventory.inventory`,
      errors,
    );
    if (entity.usedSlots !== hotbarUsed + inventoryUsed) {
      errors.push(`${at}.usedSlots: does not match inventory contents`);
    }
  }
}

function validateBlockInfo(block, at, errors) {
  if (!requireObject(block, at, errors)) {
    return;
  }
  const keys = [
    "key",
    "name",
    "displayName",
    "hardness",
    "resistance",
    "diggable",
    "transparent",
    "emitLight",
    "filterLight",
    "boundingBox",
  ];
  requireKeys(block, keys, at, errors);
  allowOnlyKeys(block, keys, at, errors);
  for (const key of ["key", "name", "displayName"]) {
    if (!isNonEmptyString(block[key])) {
      errors.push(`${at}.${key}: expected non-empty string`);
    }
  }
  for (const key of ["hardness", "resistance", "emitLight", "filterLight"]) {
    if (!isFiniteNumber(block[key])) {
      errors.push(`${at}.${key}: expected finite number`);
    }
  }
  for (const key of ["diggable", "transparent"]) {
    if (typeof block[key] !== "boolean") {
      errors.push(`${at}.${key}: expected boolean`);
    }
  }
  if (!["empty", "block"].includes(block.boundingBox)) {
    errors.push(`${at}.boundingBox: unexpected value`);
  }
}

function validateStates(states, at, errors) {
  if (!requireObject(states, at, errors)) {
    return;
  }
  for (const [key, value] of Object.entries(states)) {
    if (!isNonEmptyString(key) || typeof value !== "string") {
      errors.push(`${at}.${key}: expected string state`);
    }
  }
}

function validateBlockEntry(entry, at, errors) {
  validateRegistryEntry(entry, at, errors, [
    "hardness",
    "resistance",
    "stackSize",
    "diggable",
    "material",
    "transparent",
    "emitLight",
    "filterLight",
    "boundingBox",
  ]);
  for (const key of [
    "hardness",
    "resistance",
    "stackSize",
    "emitLight",
    "filterLight",
  ]) {
    if (!isFiniteNumber(entry[key])) {
      errors.push(`${at}.${key}: expected finite number`);
    }
  }
  for (const key of ["diggable", "transparent"]) {
    if (typeof entry[key] !== "boolean") {
      errors.push(`${at}.${key}: expected boolean`);
    }
  }
  if (!isNonEmptyString(entry.material)) {
    errors.push(`${at}.material: expected non-empty string`);
  }
  if (!["empty", "block"].includes(entry.boundingBox)) {
    errors.push(`${at}.boundingBox: unexpected value`);
  }
}

function validateItemEntry(entry, at, errors) {
  validateRegistryEntry(entry, at, errors, [
    "stackSize",
    "maxDurability",
    "enchantCategories",
    "repairWith",
  ]);
  if (!isFiniteNumber(entry.stackSize) || entry.stackSize < 1) {
    errors.push(`${at}.stackSize: expected positive number`);
  }
  if (entry.maxDurability !== undefined) {
    if (!isFiniteNumber(entry.maxDurability) || entry.maxDurability < 1) {
      errors.push(`${at}.maxDurability: expected positive number`);
    }
  }
  for (const key of ["enchantCategories", "repairWith"]) {
    if (entry[key] === undefined) {
      continue;
    }
    if (
      !Array.isArray(entry[key]) ||
      !entry[key].every((value) => isNonEmptyString(value))
    ) {
      errors.push(`${at}.${key}: expected string array`);
    }
  }
}

function validateEntityEntry(entry, at, errors) {
  validateRegistryEntry(entry, at, errors, [
    "type",
    "category",
    "width",
    "height",
  ]);
  requireKeys(entry, ["type", "category", "width", "height"], at, errors);
  for (const key of ["type", "category"]) {
    if (!isNonEmptyString(entry[key])) {
      errors.push(`${at}.${key}: expected non-empty string`);
    }
  }
  for (const key of ["width", "height"]) {
    if (!isFiniteNumber(entry[key]) || entry[key] < 0) {
      errors.push(`${at}.${key}: expected non-negative number`);
    }
  }
}

function validateDimensionSummary(summary, at, errors) {
  if (!requireObject(summary, at, errors)) {
    return;
  }
  const keys = [
    "key",
    "type",
    "displayName",
    "minY",
    "maxY",
    "hasSkylight",
    "modifiedBlockCount",
    "entityCount",
    "playerCount",
    "uri",
  ];
  requireKeys(summary, keys, at, errors);
  allowOnlyKeys(summary, keys, at, errors);
  for (const key of ["key", "type", "displayName"]) {
    if (!isNonEmptyString(summary[key])) {
      errors.push(`${at}.${key}: expected non-empty string`);
    }
  }
  for (const key of [
    "minY",
    "maxY",
    "modifiedBlockCount",
    "entityCount",
    "playerCount",
  ]) {
    if (!isInteger(summary[key])) {
      errors.push(`${at}.${key}: expected integer`);
    }
  }
  if (typeof summary.hasSkylight !== "boolean") {
    errors.push(`${at}.hasSkylight: expected boolean`);
  }
  if (summary.uri !== `lzimul://minecraft/dimensions/${summary.type}`) {
    errors.push(`${at}.uri: does not match type`);
  }
}

function validateDimensionState(state, at, errors) {
  if (!requireObject(state, at, errors)) {
    return;
  }
  const keys = [
    "key",
    "type",
    "displayName",
    "minY",
    "maxY",
    "hasSkylight",
    "modifiedBlockCount",
    "entityCount",
    "playerCount",
    "placedBlocks",
    "entities",
  ];
  requireKeys(state, keys, at, errors);
  allowOnlyKeys(state, keys, at, errors);
  for (const key of ["key", "type", "displayName"]) {
    if (!isNonEmptyString(state[key])) {
      errors.push(`${at}.${key}: expected non-empty string`);
    }
  }
  for (const key of [
    "minY",
    "maxY",
    "modifiedBlockCount",
    "entityCount",
    "playerCount",
  ]) {
    if (!isInteger(state[key])) {
      errors.push(`${at}.${key}: expected integer`);
    }
  }
  if (typeof state.hasSkylight !== "boolean") {
    errors.push(`${at}.hasSkylight: expected boolean`);
  }
  if (!Array.isArray(state.placedBlocks)) {
    errors.push(`${at}.placedBlocks: expected array`);
  } else {
    if (state.modifiedBlockCount !== state.placedBlocks.length) {
      errors.push(`${at}.modifiedBlockCount: does not match placedBlocks`);
    }
    state.placedBlocks.forEach((placed, index) => {
      const placeAt = `${at}.placedBlocks[${index}]`;
      if (!requireObject(placed, placeAt, errors)) {
        return;
      }
      requireKeys(placed, ["x", "y", "z", "block", "states"], placeAt, errors);
      allowOnlyKeys(
        placed,
        ["x", "y", "z", "block", "states"],
        placeAt,
        errors,
      );
      for (const key of ["x", "y", "z"]) {
        if (!isInteger(placed[key])) {
          errors.push(`${placeAt}.${key}: expected integer`);
        }
      }
      validateBlockInfo(placed.block, `${placeAt}.block`, errors);
      validateStates(placed.states, `${placeAt}.states`, errors);
    });
  }
  if (!Array.isArray(state.entities)) {
    errors.push(`${at}.entities: expected array`);
  } else {
    const players = state.entities.filter(
      (entity) => entity?.kind === "player",
    );
    if (state.entityCount !== state.entities.length) {
      errors.push(`${at}.entityCount: does not match entities`);
    }
    if (state.playerCount !== players.length) {
      errors.push(`${at}.playerCount: does not match entities`);
    }
    state.entities.forEach((entity, index) =>
      validateEntityInfo(entity, `${at}.entities[${index}]`, errors),
    );
  }
}

function resourceKind(uri) {
  const pathname = uri.replace("lzimul://minecraft/", "");
  const parts = pathname.split("/");
  if (parts.length === 1) {
    if (pathname === "blocks") {
      return { kind: "blockIndex" };
    }
    if (pathname === "items") {
      return { kind: "itemIndex" };
    }
    if (pathname === "entities") {
      return { kind: "entityIndex" };
    }
    if (pathname === "dimensions") {
      return { kind: "dimensionIndex" };
    }
  }
  if (parts.length === 2) {
    if (parts[0] === "blocks") {
      return { kind: "block", name: parts[1] };
    }
    if (parts[0] === "items") {
      return { kind: "item", name: parts[1] };
    }
    if (parts[0] === "entities") {
      return { kind: "entity", name: parts[1] };
    }
    if (parts[0] === "dimensions") {
      return { kind: "dimension", name: parts[1] };
    }
  }
  return { kind: "unknown" };
}

const expectedDimensions = {
  overworld: { blocks: 2, entities: 0, players: 0 },
  the_nether: { blocks: 1, entities: 0, players: 0 },
  the_end: { blocks: 1, entities: 0, players: 0 },
};

function validateResource(uri, data) {
  const errors = [];
  const target = resourceKind(uri);
  switch (target.kind) {
    case "blockIndex":
      validateRegistryIndex(data, MINECRAFT_BLOCK_COUNT, "blocks", errors);
      break;
    case "itemIndex":
      validateRegistryIndex(data, MINECRAFT_ITEM_COUNT, "items", errors);
      break;
    case "entityIndex":
      validateRegistryIndex(data, MINECRAFT_ENTITY_COUNT, "entities", errors);
      break;
    case "dimensionIndex": {
      if (!Array.isArray(data)) {
        errors.push("dimensions: expected array");
        break;
      }
      if (data.length !== 3) {
        errors.push(`dimensions: expected 3 entries, got ${data.length}`);
      }
      data.forEach((summary, index) =>
        validateDimensionSummary(summary, `dimensions[${index}]`, errors),
      );
      break;
    }
    case "block":
      validateBlockEntry(data, "block", errors);
      if (data?.name !== target.name) {
        errors.push("block.name: does not match URI");
      }
      break;
    case "item":
      validateItemEntry(data, "item", errors);
      if (data?.name !== target.name) {
        errors.push("item.name: does not match URI");
      }
      break;
    case "entity":
      validateEntityEntry(data, "entity", errors);
      if (data?.name !== target.name) {
        errors.push("entity.name: does not match URI");
      }
      break;
    case "dimension": {
      validateDimensionState(data, "dimension", errors);
      if (data?.type !== target.name) {
        errors.push("dimension.type: does not match URI");
      }
      const expected = expectedDimensions[target.name];
      if (expected) {
        if (data?.modifiedBlockCount !== expected.blocks) {
          errors.push(
            `dimension.modifiedBlockCount: expected ${expected.blocks}`,
          );
        }
        if (data?.entityCount !== expected.entities) {
          errors.push(`dimension.entityCount: expected ${expected.entities}`);
        }
        if (data?.playerCount !== expected.players) {
          errors.push(`dimension.playerCount: expected ${expected.players}`);
        }
      }
      break;
    }
    default:
      errors.push("unknown resource URI");
      break;
  }
  return errors;
}

async function readResource(entry) {
  const response = await rpc("resources/read", { uri: entry.uri }, 60_000);
  const result = response.result;
  if (response.error || !result) {
    return [`${entry.uri}: JSON-RPC error`];
  }
  const errors = [];
  if (result.resultType !== "complete") {
    errors.push(`${entry.uri}: non-complete result`);
  }
  if (!Array.isArray(result.contents) || result.contents.length !== 1) {
    errors.push(`${entry.uri}: expected exactly one content item`);
    return errors;
  }
  const content = result.contents[0];
  if (content.uri !== entry.uri) {
    errors.push(`${entry.uri}: content URI mismatch`);
  }
  if (content.mimeType !== "application/json") {
    errors.push(`${entry.uri}: unexpected MIME type ${content.mimeType}`);
  }
  if (!isNonEmptyString(content.text)) {
    errors.push(`${entry.uri}: empty content text`);
    return errors;
  }
  let data;
  try {
    data = JSON.parse(content.text);
  } catch (error) {
    errors.push(`${entry.uri}: invalid JSON (${error.message})`);
    return errors;
  }
  errors.push(...validateResource(entry.uri, data));
  return errors;
}

async function close() {
  proc.stdin.end();
  if (proc.exitCode === null) {
    proc.kill();
    await new Promise((resolve) => proc.once("exit", resolve));
  }
  await rm(dataDir, { recursive: true, force: true });
}

async function main() {
  const discovery = await rpc("server/discover");
  const discovered = discovery.result;
  const serverInfo = discovered?._meta?.["io.modelcontextprotocol/serverInfo"];
  check(
    "server/discover negotiates 2026-07-28",
    discovered?.supportedVersions?.includes(PROTOCOL_VERSION),
    JSON.stringify(discovered?.supportedVersions),
  );
  check(
    "server/discover resultType complete",
    discovered?.resultType === "complete",
    discovered?.resultType,
  );
  check("server title", serverInfo?.title === "lZiMUl Minecraft MCP");
  check("server version", serverInfo?.version === "1.0.5", serverInfo?.version);
  check(
    "server description contains registry counts",
    serverInfo?.description?.includes(
      `${MINECRAFT_BLOCK_COUNT} blocks, ${MINECRAFT_ITEM_COUNT} items and ${MINECRAFT_ENTITY_COUNT} entity types`,
    ),
  );

  const toolsResponse = await rpc("tools/list");
  const tools = toolsResponse.result?.tools ?? [];
  check(
    "tools/list resultType complete",
    toolsResponse.result?.resultType === "complete",
  );
  check("tool count", tools.length === 21, `${tools.length} tools`);
  check(
    "all tools advertise output schemas",
    tools.length === 21 && tools.every((tool) => Boolean(tool.outputSchema)),
  );
  for (const tool of tools) {
    toolOutputSchemas.set(tool.name, tool.outputSchema);
  }

  const air = await callTool("getBlock", {
    x: 0,
    y: 64,
    z: 0,
    dimension: "overworld",
  });
  check(
    "getBlock returns air before placement",
    air?.block?.key === "minecraft:air",
  );
  check(
    "getBlock returns empty states before placement",
    Object.keys(air?.states ?? {}).length === 0,
  );

  const placedStairs = await callTool("setBlock", {
    x: 0,
    y: 64,
    z: 0,
    blockType: "minecraft:oak_stairs[facing=south,half=bottom]",
    dimension: "overworld",
  });
  check(
    "setBlock places oak_stairs",
    placedStairs?.block?.key === "minecraft:oak_stairs",
  );
  check(
    "setBlock echoes block states",
    placedStairs?.states?.facing === "south" &&
      placedStairs?.states?.half === "bottom",
  );
  check(
    "setBlock reports previous air",
    placedStairs?.previous?.key === "minecraft:air",
  );

  const placedStone = await callTool("setBlock", {
    x: 1,
    y: 64,
    z: 0,
    blockType: "stone",
    dimension: "overworld",
  });
  check(
    "setBlock accepts a short block id",
    placedStone?.block?.key === "minecraft:stone",
  );

  const overlapped = await callTool("getBlock", {
    x: 0,
    y: 64,
    z: 0,
    dimension: "overworld",
  });
  check(
    "getBlock reads the placed state",
    overlapped?.block?.key === "minecraft:oak_stairs",
  );
  check(
    "getBlock reads the placed states",
    overlapped?.states?.facing === "south",
  );

  const netherBlock = await callTool("setBlock", {
    x: 0,
    y: 64,
    z: 0,
    blockType: "minecraft:netherrack",
    dimension: "the_nether",
  });
  check(
    "setBlock targets the nether",
    netherBlock?.dimension === "minecraft:the_nether",
  );
  const netherRead = await callTool("getBlock", {
    x: 0,
    y: 64,
    z: 0,
    dimension: "the_nether",
  });
  check(
    "getBlock reads the nether",
    netherRead?.block?.key === "minecraft:netherrack",
  );

  const endBlock = await callTool("setBlock", {
    x: 0,
    y: 64,
    z: 0,
    blockType: "minecraft:end_stone",
    dimension: "the_end",
  });
  check(
    "setBlock targets the end",
    endBlock?.dimension === "minecraft:the_end",
  );
  const endRead = await callTool("getBlock", {
    x: 0,
    y: 64,
    z: 0,
    dimension: "the_end",
  });
  check(
    "getBlock reads the end",
    endRead?.block?.key === "minecraft:end_stone",
  );

  const item = await callTool("getItem", { item: "minecraft:diamond_sword" });
  check(
    "getItem returns the diamond sword",
    item?.item?.key === "minecraft:diamond_sword",
  );
  check("getItem returns durability", item?.item?.maxDurability === 1561);
  check("getItem returns stack size", item?.item?.stackSize === 1);

  const overworld = await callTool("getDimension", { dimension: "overworld" });
  check(
    "getDimension overworld identity",
    overworld?.key === "minecraft:overworld" && overworld?.type === "overworld",
  );
  check(
    "getDimension overworld bounds",
    overworld?.minY === -64 && overworld?.maxY === 320,
  );
  check(
    "getDimension overworld counts",
    overworld?.modifiedBlockCount === 2 &&
      overworld?.entityCount === 0 &&
      overworld?.playerCount === 0,
  );

  const nether = await callTool("getDimension", { dimension: "the_nether" });
  check(
    "getDimension nether identity",
    nether?.key === "minecraft:the_nether" && nether?.type === "the_nether",
  );
  check(
    "getDimension nether bounds",
    nether?.minY === 0 && nether?.maxY === 256,
  );

  const end = await callTool("getDimension", { dimension: "the_end" });
  check(
    "getDimension end identity",
    end?.key === "minecraft:the_end" && end?.type === "the_end",
  );
  check("getDimension end bounds", end?.minY === 0 && end?.maxY === 256);

  const firstPage = await callTool("getDimensionBlocks", {
    dimension: "overworld",
    limit: 1,
    offset: 0,
  });
  check(
    "getDimensionBlocks first page",
    firstPage?.total === 2 &&
      firstPage?.returned === 1 &&
      firstPage?.hasMore === true,
  );
  const secondPage = await callTool("getDimensionBlocks", {
    dimension: "overworld",
    limit: 1,
    offset: 1,
  });
  check(
    "getDimensionBlocks second page",
    secondPage?.total === 2 &&
      secondPage?.returned === 1 &&
      secondPage?.hasMore === false,
  );
  const allBlocks = await callTool("getDimensionBlocks", {
    dimension: "overworld",
    limit: 10,
    offset: 0,
  });
  check(
    "getDimensionBlocks returns both blocks",
    allBlocks?.returned === 2 &&
      new Set(allBlocks?.blocks?.map((block) => block.block)).size === 2,
  );

  const areaExisting = await callTool("getBlocksInArea", {
    dimension: "overworld",
    from: { x: 0, y: 64, z: 0 },
    to: { x: 1, y: 64, z: 0 },
  });
  check(
    "getBlocksInArea returns placed blocks",
    areaExisting?.total === 2 &&
      areaExisting?.returned === 2 &&
      areaExisting?.blocks?.length === 2,
  );

  const areaFiltered = await callTool("getBlocksInArea", {
    dimension: "overworld",
    from: { x: 0, y: 64, z: 0 },
    to: { x: 1, y: 64, z: 0 },
    blockType: "oak_stairs[facing=south,half=bottom]",
  });
  check(
    "getBlocksInArea filters by block and states",
    areaFiltered?.total === 1 &&
      areaFiltered?.blocks?.[0]?.block === "minecraft:oak_stairs",
  );

  const areaPaged = await callTool("getBlocksInArea", {
    dimension: "overworld",
    from: { x: 0, y: 64, z: 0 },
    to: { x: 1, y: 64, z: 0 },
    limit: 1,
    offset: 0,
  });
  check(
    "getBlocksInArea paginates",
    areaPaged?.total === 2 &&
      areaPaged?.returned === 1 &&
      areaPaged?.hasMore === true,
  );

  const filled = await callTool("fillBlocks", {
    dimension: "overworld",
    from: { x: 10, y: 64, z: 10 },
    to: { x: 11, y: 64, z: 11 },
    blockType: "stone",
  });
  check(
    "fillBlocks fills air by default",
    filled?.volume === 4 &&
      filled?.changed === 4 &&
      filled?.placed === 4 &&
      filled?.removed === 0 &&
      filled?.modifiedBlockCount === 6,
  );

  const areaFilled = await callTool("getBlocksInArea", {
    dimension: "overworld",
    from: { x: 10, y: 64, z: 10 },
    to: { x: 11, y: 64, z: 11 },
    blockType: "stone",
  });
  check(
    "getBlocksInArea sees the filled region",
    areaFilled?.total === 4 && areaFilled?.returned === 4,
  );

  const fillKept = await callTool("fillBlocks", {
    dimension: "overworld",
    from: { x: 10, y: 64, z: 10 },
    to: { x: 11, y: 64, z: 11 },
    blockType: "dirt",
  });
  check(
    "fillBlocks keeps existing blocks when overwrite is false",
    fillKept?.changed === 0 &&
      fillKept?.skipped === 4 &&
      fillKept?.modifiedBlockCount === 6,
  );

  const fillReplaced = await callTool("fillBlocks", {
    dimension: "overworld",
    from: { x: 10, y: 64, z: 10 },
    to: { x: 11, y: 64, z: 11 },
    blockType: "dirt",
    overwrite: true,
  });
  check(
    "fillBlocks replaces existing blocks when overwrite is true",
    fillReplaced?.changed === 4 &&
      fillReplaced?.placed === 4 &&
      fillReplaced?.modifiedBlockCount === 6,
  );

  const fillCleared = await callTool("fillBlocks", {
    dimension: "overworld",
    from: { x: 10, y: 64, z: 10 },
    to: { x: 11, y: 64, z: 11 },
    blockType: "minecraft:air",
    overwrite: true,
  });
  check(
    "fillBlocks removes blocks with air",
    fillCleared?.changed === 4 &&
      fillCleared?.removed === 4 &&
      fillCleared?.modifiedBlockCount === 2,
  );

  const areaCleared = await callTool("getBlocksInArea", {
    dimension: "overworld",
    from: { x: 10, y: 64, z: 10 },
    to: { x: 11, y: 64, z: 11 },
  });
  check(
    "getBlocksInArea sees the cleared region",
    areaCleared?.total === 0 && areaCleared?.returned === 0,
  );

  const fillTooLarge = await rpc("tools/call", {
    name: "fillBlocks",
    arguments: {
      dimension: "overworld",
      from: { x: 0, y: 64, z: 0 },
      to: { x: 128, y: 64, z: 128 },
      blockType: "stone",
    },
  });
  check(
    "fillBlocks rejects volumes over the limit",
    fillTooLarge.result?.isError === true,
  );

  const zombie = await callTool("createEntity", {
    type: "minecraft:zombie",
    x: 2,
    y: 64,
    z: 0,
    dimension: "overworld",
    name: "ExhaustiveZombie",
  });
  check("createEntity returns a UUID", isNonEmptyString(zombie?.id));
  check("createEntity kind", zombie?.kind === "entity");
  check("createEntity type", zombie?.type === "minecraft:zombie");
  check("createEntity name", zombie?.name === "ExhaustiveZombie");
  check("createEntity dimension", zombie?.dimension === "overworld");
  check(
    "createEntity starts with an empty inventory",
    zombie?.usedSlots === 0 && zombie?.totalSlots === 36,
  );

  const zombieRead = await callTool("getEntity", { id: zombie?.id });
  check(
    "getEntity reads the created entity",
    zombieRead?.id === zombie?.id && zombieRead?.name === zombie?.name,
  );
  check(
    "getEntity reports the full inventory",
    zombieRead?.inventory?.hotbar?.length === 9 &&
      zombieRead?.inventory?.inventory?.length === 27,
  );

  const player = await callTool("createPlayer", {
    name: "ExhaustivePlayer",
    x: 3,
    y: 64,
    z: 0,
    dimension: "overworld",
  });
  check("createPlayer kind", player?.kind === "player");
  check("createPlayer type", player?.type === "minecraft:player");
  check("createPlayer name", player?.name === "ExhaustivePlayer");
  check(
    "createPlayer starts with an empty inventory",
    player?.usedSlots === 0 && player?.totalSlots === 36,
  );

  const playerRead = await callTool("getPlayer", { name: "exhaustiveplayer" });
  check(
    "getPlayer is case-insensitive",
    playerRead?.id === player?.id && playerRead?.name === "ExhaustivePlayer",
  );

  const zombiePosition = await callTool("getEntityPosition", {
    id: zombie?.id,
  });
  check(
    "getEntityPosition returns the created position",
    zombiePosition?.id === zombie?.id &&
      zombiePosition?.type === "minecraft:zombie" &&
      zombiePosition?.name === "ExhaustiveZombie" &&
      zombiePosition?.x === 2 &&
      zombiePosition?.y === 64 &&
      zombiePosition?.z === 0,
  );

  const movementSteps = [
    ["forward", 2, 64, 1],
    ["back", 2, 64, 0],
    ["left", 1, 64, 0],
    ["right", 2, 64, 0],
    ["up", 2, 65, 0],
    ["down", 2, 64, 0],
  ];
  for (const [direction, x, y, z] of movementSteps) {
    const moved = await callTool("moveEntity", {
      id: zombie?.id,
      direction,
    });
    check(
      `moveEntity ${direction} moves one block`,
      moved?.direction === direction &&
        moved?.x === x &&
        moved?.y === y &&
        moved?.z === z,
    );
  }

  const setPosition = await callTool("setEntityPosition", {
    id: player?.id,
    position: { x: 4, y: 64, z: 1 },
  });
  check(
    "setEntityPosition updates the player position",
    setPosition?.x === 4 &&
      setPosition?.y === 64 &&
      setPosition?.z === 1 &&
      setPosition?.previous?.x === 3 &&
      setPosition?.previous?.y === 64 &&
      setPosition?.previous?.z === 0,
  );
  const playerPosition = await callTool("getEntityPosition", {
    id: player?.id,
  });
  check(
    "getEntityPosition reads the updated position",
    playerPosition?.x === 4 &&
      playerPosition?.y === 64 &&
      playerPosition?.z === 1,
  );

  const outOfRangePosition = await rpc("tools/call", {
    name: "setEntityPosition",
    arguments: {
      id: zombie?.id,
      position: { x: 0, y: 999, z: 0 },
    },
  });
  check(
    "setEntityPosition rejects out-of-range coordinates",
    outOfRangePosition.result?.isError === true,
  );

  const inventoryBefore = await callTool("getInventory", {
    target: "ExhaustivePlayer",
  });
  check(
    "getInventory entity identity",
    inventoryBefore?.entity?.id === player?.id,
  );
  check(
    "getInventory slot counts",
    inventoryBefore?.hotbar?.length === 9 &&
      inventoryBefore?.inventory?.length === 27,
  );
  check(
    "getInventory starts empty",
    inventoryBefore?.usedSlots === 0 && inventoryBefore?.hotbarUsed === 0,
  );

  const inventoryChange = await callTool("setInventory", {
    target: "ExhaustivePlayer",
    section: "hotbar",
    slot: 0,
    item: "minecraft:diamond_sword",
    count: 1,
  });
  check(
    "setInventory reports the section and slot",
    inventoryChange?.section === "hotbar" && inventoryChange?.slot === 0,
  );
  check(
    "setInventory sets the item",
    inventoryChange?.item?.item === "minecraft:diamond_sword" &&
      inventoryChange?.item?.count === 1,
  );
  check(
    "setInventory reports the previous value",
    inventoryChange?.previous === null,
  );
  check(
    "setInventory updates used slots",
    inventoryChange?.usedSlots === 1 && inventoryChange?.hotbarUsed === 1,
  );

  const inventoryAfter = await callTool("getInventory", {
    target: player?.id,
  });
  check(
    "getInventory reads by UUID",
    inventoryAfter?.entity?.id === player?.id,
  );
  check(
    "getInventory sees the item",
    inventoryAfter?.hotbar?.[0]?.item === "minecraft:diamond_sword" &&
      inventoryAfter?.usedSlots === 1,
  );

  const cleared = await callTool("setInventory", {
    target: "ExhaustivePlayer",
    section: "hotbar",
    slot: 0,
    item: "minecraft:air",
    count: 0,
  });
  check(
    "setInventory clears a slot",
    cleared?.item === null &&
      cleared?.previous?.item === "minecraft:diamond_sword",
  );
  check(
    "setInventory clears used slots",
    cleared?.usedSlots === 0 && cleared?.hotbarUsed === 0,
  );

  const inventoryCleared = await callTool("getInventory", {
    target: "ExhaustivePlayer",
  });
  check(
    "getInventory confirms the cleared slot",
    inventoryCleared?.hotbar?.[0] === null && inventoryCleared?.usedSlots === 0,
  );

  await callTool("setInventory", {
    target: "ExhaustivePlayer",
    section: "hotbar",
    slot: 0,
    item: "minecraft:diamond_sword",
    count: 1,
  });
  await callTool("setInventory", {
    target: "ExhaustivePlayer",
    section: "hotbar",
    slot: 1,
    item: "minecraft:apple",
    count: 3,
  });

  const swapped = await callTool("swapInventorySlots", {
    target: "ExhaustivePlayer",
    fromSection: "hotbar",
    fromSlot: 0,
    toSection: "hotbar",
    toSlot: 1,
  });
  check(
    "swapInventorySlots swaps both stacks",
    swapped?.previousFrom?.item === "minecraft:diamond_sword" &&
      swapped?.previousTo?.item === "minecraft:apple" &&
      swapped?.hotbar?.[0]?.item === "minecraft:apple" &&
      swapped?.hotbar?.[1]?.item === "minecraft:diamond_sword",
  );

  const swappedBack = await callTool("swapInventorySlots", {
    target: "ExhaustivePlayer",
    fromSection: "hotbar",
    fromSlot: 0,
    toSection: "hotbar",
    toSlot: 1,
  });
  check(
    "swapInventorySlots can swap back",
    swappedBack?.hotbar?.[0]?.item === "minecraft:diamond_sword" &&
      swappedBack?.hotbar?.[1]?.item === "minecraft:apple",
  );

  const clearedInventory = await callTool("clearInventory", {
    target: "ExhaustivePlayer",
  });
  check(
    "clearInventory clears all used slots",
    clearedInventory?.clearedSlots === 2 &&
      clearedInventory?.usedSlots === 0 &&
      clearedInventory?.hotbarUsed === 0 &&
      clearedInventory?.inventoryUsed === 0,
  );

  const emptyAfterClear = await callTool("getInventory", {
    target: "ExhaustivePlayer",
  });
  check(
    "getInventory confirms clearInventory",
    emptyAfterClear?.usedSlots === 0 &&
      emptyAfterClear?.hotbar?.[0] === null &&
      emptyAfterClear?.hotbar?.[1] === null,
  );

  const dimensionEntities = await callTool("getDimensionEntities", {
    dimension: "overworld",
  });
  const entityNames = dimensionEntities?.entities?.map((entity) => entity.name);
  check(
    "getDimensionEntities reports both entities",
    dimensionEntities?.entityCount === 2 &&
      dimensionEntities?.entities?.length === 2,
  );
  check(
    "getDimensionEntities reports the player count",
    dimensionEntities?.playerCount === 1,
  );
  check(
    "getDimensionEntities includes the entity and player",
    entityNames?.includes("ExhaustiveZombie") &&
      entityNames?.includes("ExhaustivePlayer"),
  );

  const rawFile = await callTool("getDimensionRawFile", {
    dimension: "overworld",
  });
  const rawSnapshot = JSON.parse(rawFile?.raw ?? "{}");
  check(
    "getDimensionRawFile returns the snapshot format",
    rawFile?.format === "lzimul:minecraft/dimension" && rawFile?.bytes > 0,
  );
  check(
    "getDimensionRawFile returns the dimension identity",
    rawSnapshot?.format === "lzimul:minecraft/dimension" &&
      rawSnapshot?.dimension === "minecraft:overworld",
  );
  check(
    "getDimensionRawFile contains blocks and entities",
    rawSnapshot?.blocks?.length === 2 && rawSnapshot?.entities?.length === 2,
  );

  const deletedZombie = await callTool("deleteEntity", {
    target: zombie?.id,
  });
  check(
    "deleteEntity deletes by UUID",
    deletedZombie?.id === zombie?.id &&
      deletedZombie?.name === "ExhaustiveZombie",
  );

  const entitiesAfterZombieDelete = await callTool("getDimensionEntities", {
    dimension: "overworld",
  });
  check(
    "getDimensionEntities reflects the deleted entity",
    entitiesAfterZombieDelete?.entityCount === 1 &&
      entitiesAfterZombieDelete?.playerCount === 1,
  );

  const deletedPlayer = await callTool("deleteEntity", {
    target: "exhaustiveplayer",
  });
  check(
    "deleteEntity deletes by player name",
    deletedPlayer?.id === player?.id &&
      deletedPlayer?.name === "ExhaustivePlayer",
  );

  const entitiesAfterAllDeletes = await callTool("getDimensionEntities", {
    dimension: "overworld",
  });
  check(
    "getDimensionEntities is empty after deletes",
    entitiesAfterAllDeletes?.entityCount === 0 &&
      entitiesAfterAllDeletes?.playerCount === 0,
  );

  const deletedRead = await rpc("tools/call", {
    name: "getEntity",
    arguments: { id: zombie?.id },
  });
  check(
    "deleted entities cannot be read",
    deletedRead.result?.isError === true,
  );

  const deleteMissing = await rpc("tools/call", {
    name: "deleteEntity",
    arguments: { target: "missing-entity" },
  });
  check(
    "deleteEntity rejects unknown targets",
    deleteMissing.result?.isError === true,
  );

  const resourcesResponse = await rpc("resources/list");
  const resources = resourcesResponse.result?.resources ?? [];
  const resourceUris = resources.map((resource) => resource.uri);
  const resourceNames = resources.map((resource) => resource.name);
  check(
    "resources/list resultType complete",
    resourcesResponse.result?.resultType === "complete",
  );
  check(
    "resource count",
    resources.length === EXPECTED_RESOURCES,
    `got ${resources.length}, expected ${EXPECTED_RESOURCES}`,
  );
  check(
    "resource URIs are unique",
    new Set(resourceUris).size === resources.length,
  );
  check(
    "resource names are unique",
    new Set(resourceNames).size === resources.length,
  );
  const metadataErrors = [];
  resources.forEach((resource, index) => {
    if (
      !isNonEmptyString(resource.uri) ||
      !resource.uri.startsWith("lzimul://minecraft/")
    ) {
      metadataErrors.push(`${index}: invalid URI`);
    }
    if (!isNonEmptyString(resource.name)) {
      metadataErrors.push(`${resource.uri}: missing name`);
    }
    if (!isNonEmptyString(resource.title)) {
      metadataErrors.push(`${resource.uri}: missing title`);
    }
    if (!isNonEmptyString(resource.description)) {
      metadataErrors.push(`${resource.uri}: missing description`);
    }
    if (resource.mimeType !== "application/json") {
      metadataErrors.push(`${resource.uri}: invalid MIME type`);
    }
    if (resource.name !== resource.uri.replace("lzimul://", "")) {
      metadataErrors.push(`${resource.uri}: name does not match URI`);
    }
  });
  check(
    "resource metadata is complete",
    metadataErrors.length === 0,
    metadataErrors.slice(0, 4).join("; "),
  );

  const resourceFailures = [];
  let nextResource = 0;
  async function worker() {
    while (true) {
      const index = nextResource++;
      if (index >= resources.length) {
        return;
      }
      try {
        const errors = await readResource(resources[index]);
        if (errors.length > 0) {
          resourceFailures.push(...errors);
        }
      } catch (error) {
        resourceFailures.push(`${resources[index].uri}: ${error.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: 32 }, () => worker()));

  if (resourceFailures.length > 0) {
    for (const failure of resourceFailures.slice(0, 20)) {
      console.log(`  RESOURCE FAIL  ${failure}`);
    }
  }
  check(
    "all resources read successfully",
    resourceFailures.length === 0,
    `${resourceFailures.length} issue(s)`,
  );
  check(
    "resource category counts",
    resources.filter((resource) =>
      resource.uri.startsWith("lzimul://minecraft/blocks/"),
    ).length === MINECRAFT_BLOCK_COUNT &&
      resources.filter((resource) =>
        resource.uri.startsWith("lzimul://minecraft/items/"),
      ).length === MINECRAFT_ITEM_COUNT &&
      resources.filter((resource) =>
        resource.uri.startsWith("lzimul://minecraft/entities/"),
      ).length === MINECRAFT_ENTITY_COUNT &&
      resources.filter((resource) =>
        resource.uri.startsWith("lzimul://minecraft/dimensions/"),
      ).length === 3,
  );

  const failed = checks.filter((entry) => !entry.pass).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

try {
  await main();
} finally {
  await close();
}
