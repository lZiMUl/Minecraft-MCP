/**
 * End-to-end smoke test.
 *
 * Starts the real stdio server against a temporary world directory and covers
 * tools, resources, block states, dimensions, entities and inventories.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MINECRAFT_BLOCK_COUNT } from "../build/data/blocks.js";
import { MINECRAFT_ENTITY_COUNT } from "../build/data/entities.js";
import { MINECRAFT_ITEM_COUNT } from "../build/data/items.js";
import { MINECRAFT_DATA_VERSION } from "../build/data/version.js";
import {
  clientEnvelope,
  discoverRequest,
  PROTOCOL_VERSION,
} from "./protocol.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_RESOURCES =
  MINECRAFT_BLOCK_COUNT + MINECRAFT_ITEM_COUNT + MINECRAFT_ENTITY_COUNT + 7;
const dataDir = await mkdtemp(path.join(tmpdir(), "lzimul-smoke-"));
const proc = spawn("node", ["build/index.js"], {
  cwd: root,
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, MCP_WORLD_STORAGE: "file", MCP_WORLD_DIR: dataDir },
});

let buf = "";
const results = {};
proc.stdout.on("data", (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.id !== void 0) results[msg.id] = msg;
  }
});

const send = (m) => proc.stdin.write(JSON.stringify(m) + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const envelope = clientEnvelope("smoke-test");
const call = (id, name, args) =>
  send({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args, _meta: envelope },
  });

const checks = [];
function check(name, condition, detail) {
  checks.push({ name, pass: Boolean(condition), detail });
}

async function waitFor(predicate, timeoutMs = 5000) {
  for (let t = 0; t < timeoutMs / 100 && !predicate(); t++) await sleep(100);
  return predicate();
}

const X0 = 300,
  Y0 = 51,
  Z = 7033;
const plan = [];
for (let x = X0; x <= X0 + 3; x++) {
  plan.push({ x, y: Y0, z: Z, blockType: "obsidian" });
  plan.push({ x, y: Y0 + 4, z: Z, blockType: "obsidian" });
}
for (let y = Y0 + 1; y <= Y0 + 3; y++) {
  plan.push({ x: X0, y, z: Z, blockType: "obsidian" });
  plan.push({ x: X0 + 3, y, z: Z, blockType: "obsidian" });
  plan.push({ x: X0 + 1, y, z: Z, blockType: "nether_portal" });
  plan.push({ x: X0 + 2, y, z: Z, blockType: "nether_portal" });
}

async function main() {
  send(discoverRequest(1, "smoke-test"));
  await waitFor(() => results[1]);

  const serverInfo =
    results[1]?.result?._meta?.["io.modelcontextprotocol/serverInfo"];
  check(
    "server/discover negotiates 2026-07-28",
    results[1]?.result?.supportedVersions?.includes(PROTOCOL_VERSION),
    JSON.stringify(results[1]?.result?.supportedVersions),
  );
  check(
    "modern result envelope",
    results[1]?.result?.resultType === "complete",
    results[1]?.result?.resultType,
  );
  check("server title", serverInfo?.title === "lZiMUl Minecraft MCP");
  check("server version", serverInfo?.version === "1.0.5", serverInfo?.version);
  check(
    "description mentions data version and counts",
    serverInfo?.description?.includes(
      `${MINECRAFT_BLOCK_COUNT} blocks, ${MINECRAFT_ITEM_COUNT} items and ${MINECRAFT_ENTITY_COUNT} entity types`,
    ) &&
      serverInfo?.description?.includes(
        `Java Edition ${MINECRAFT_DATA_VERSION}`,
      ),
  );

  send({
    jsonrpc: "2.0",
    id: 2,
    method: "resources/list",
    params: { _meta: envelope },
  });
  send({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/list",
    params: { _meta: envelope },
  });
  await waitFor(() => results[2] && results[3]);

  const resources = results[2]?.result?.resources ?? [];
  check(
    "resource count matches data",
    resources.length === EXPECTED_RESOURCES,
    `got ${resources.length}, expected ${EXPECTED_RESOURCES}`,
  );
  check("tool count 21", (results[3]?.result?.tools ?? []).length === 21);

  call(10, "getItem", { item: "diamond_sword" });
  call(11, "getItem", { item: "not_an_item" });
  await waitFor(() => results[10] && results[11]);
  check(
    "getItem structured",
    results[10]?.result?.structuredContent?.item?.maxDurability === 1561,
  );
  check("getItem unknown isError", results[11]?.result?.isError === true);

  plan.forEach((b, i) => call(100 + i, "setBlock", b));
  await waitFor(() => plan.every((_, i) => results[100 + i]));
  check(
    "setBlock x20 no errors",
    plan.every(
      (_, i) => results[100 + i]?.result && !results[100 + i].result.isError,
    ),
  );

  plan.forEach((b, i) => call(200 + i, "getBlock", { x: b.x, y: b.y, z: b.z }));
  call(250, "getBlock", { x: X0, y: Y0, z: Z, dimension: "the_nether" });
  call(251, "setBlock", {
    x: X0,
    y: Y0,
    z: Z,
    blockType: "netherrack",
    dimension: "the_nether",
  });
  call(252, "getBlock", { x: X0, y: Y0, z: Z, dimension: "the_nether" });
  call(253, "getBlock", { x: 0, y: 300, z: 0, dimension: "the_nether" });
  call(254, "getBlock", { x: 0, y: 300, z: 0 });
  call(255, "getBlock", { x: 0, y: 0, z: 0, dimension: "moon" });
  call(256, "setBlock", { x: 0, y: 0, z: 0, blockType: "not_a_block" });
  call(257, "setBlock", {
    x: X0,
    y: Y0 + 5,
    z: Z,
    blockType: "minecraft:oak_stairs[facing=south,half=bottom]",
  });
  call(258, "getBlock", { x: X0, y: Y0 + 5, z: Z });
  call(259, "setBlock", {
    x: X0,
    y: Y0 + 6,
    z: Z,
    blockType: "oak_stairs[facing]",
  });
  call(260, "setBlock", {
    x: X0,
    y: Y0 + 6,
    z: Z,
    blockType: "foo:stone",
  });
  call(261, "setBlock", {
    x: X0,
    y: Y0 + 6,
    z: Z,
    blockType: "oak_stairs[__proto__=x]",
  });
  call(262, "setBlock", {
    x: X0,
    y: Y0 + 6,
    z: Z,
    blockType: "minecraft:air[facing=south]",
  });
  call(263, "getItem", { item: "  DIAMOND_SWORD  " });
  await waitFor(
    () =>
      results[250] &&
      results[251] &&
      results[252] &&
      results[253] &&
      results[254] &&
      results[255] &&
      results[256] &&
      results[257] &&
      results[258] &&
      results[259] &&
      results[260] &&
      results[261] &&
      results[262] &&
      results[263] &&
      plan.every((_, i) => results[200 + i]),
  );

  check(
    "world readback matches plan",
    plan.every(
      (b, i) =>
        results[200 + i]?.result?.structuredContent?.block?.name ===
        b.blockType,
    ),
  );
  check(
    "dimension isolation (nether empty)",
    results[250]?.result?.structuredContent?.block?.name === "air",
  );
  check(
    "setBlock in nether",
    results[251]?.result?.structuredContent?.block?.name === "netherrack",
  );
  check(
    "nether keeps its own state",
    results[252]?.result?.structuredContent?.block?.name === "netherrack",
  );
  check("nether Y range check", results[253]?.result?.isError === true);
  check("overworld Y=300 valid", results[254]?.result?.isError !== true);
  check(
    "invalid dimension rejected",
    /validation/i.test(results[255]?.result?.content?.[0]?.text ?? ""),
  );
  check("unknown block isError", results[256]?.result?.isError === true);
  check(
    "block states round-trip",
    results[258]?.result?.structuredContent?.states?.facing === "south" &&
      results[258]?.result?.structuredContent?.states?.half === "bottom",
    JSON.stringify(results[258]?.result?.structuredContent?.states),
  );
  check("invalid state syntax isError", results[259]?.result?.isError === true);
  check("unknown namespace isError", results[260]?.result?.isError === true);
  check("reserved state name isError", results[261]?.result?.isError === true);
  check("air with states isError", results[262]?.result?.isError === true);
  check(
    "item ids are normalized",
    results[263]?.result?.structuredContent?.item?.name === "diamond_sword",
  );

  call(270, "createPlayer", {
    name: "SmokePlayer",
    x: 0,
    y: 64,
    z: 0,
  });
  call(271, "setInventory", {
    target: "smokeplayer",
    section: "hotbar",
    slot: 0,
    item: "diamond_sword",
    count: 1,
  });
  call(272, "getInventory", { target: "SmokePlayer" });
  call(273, "createEntity", { type: "chicken", x: 1, y: 64, z: 0 });
  call(274, "getDimension", { dimension: "overworld" });
  call(275, "getDimensionBlocks", { dimension: "overworld", limit: 5 });
  call(276, "getPlayer", { name: "SMOKEPLAYER" });
  await waitFor(() => results[270] && results[276]);
  call(277, "getEntity", {
    id: results[270]?.result?.structuredContent?.id,
  });
  call(278, "getEntity", { id: "missing-entity" });
  call(279, "getDimensionEntities", { dimension: "overworld" });
  call(280, "getDimensionRawFile", { dimension: "overworld" });
  call(281, "getEntityPosition", {
    id: results[270]?.result?.structuredContent?.id,
  });
  call(282, "moveEntity", {
    id: results[270]?.result?.structuredContent?.id,
    direction: "forward",
  });
  call(283, "setEntityPosition", {
    id: results[270]?.result?.structuredContent?.id,
    position: { x: 4, y: 64, z: 1 },
  });
  call(284, "setInventory", {
    target: "SmokePlayer",
    section: "hotbar",
    slot: 1,
    item: "minecraft:apple",
    count: 2,
  });
  call(285, "swapInventorySlots", {
    target: "SmokePlayer",
    fromSection: "hotbar",
    fromSlot: 0,
    toSection: "hotbar",
    toSlot: 1,
  });
  call(286, "clearInventory", { target: "SmokePlayer" });
  call(287, "getInventory", { target: "SmokePlayer" });
  call(288, "deleteEntity", {
    target: results[273]?.result?.structuredContent?.id,
  });
  call(289, "getDimensionEntities", { dimension: "overworld" });
  call(290, "deleteEntity", { target: "SmokePlayer" });
  call(291, "getDimensionEntities", { dimension: "overworld" });
  await waitFor(
    () =>
      results[271] &&
      results[272] &&
      results[273] &&
      results[274] &&
      results[275] &&
      results[277] &&
      results[278] &&
      results[279] &&
      results[280] &&
      results[281] &&
      results[282] &&
      results[283] &&
      results[284] &&
      results[285] &&
      results[286] &&
      results[287] &&
      results[288] &&
      results[289] &&
      results[290] &&
      results[291],
  );

  call(292, "fillBlocks", {
    dimension: "overworld",
    from: { x: 50, y: 64, z: 50 },
    to: { x: 51, y: 64, z: 51 },
    blockType: "stone",
  });
  await waitFor(() => results[292]);
  call(293, "getBlocksInArea", {
    dimension: "overworld",
    from: { x: 50, y: 64, z: 50 },
    to: { x: 51, y: 64, z: 51 },
  });
  await waitFor(() => results[293]);
  call(294, "fillBlocks", {
    dimension: "overworld",
    from: { x: 50, y: 64, z: 50 },
    to: { x: 51, y: 64, z: 51 },
    blockType: "minecraft:air",
    overwrite: true,
  });
  await waitFor(() => results[294]);
  call(295, "getBlocksInArea", {
    dimension: "overworld",
    from: { x: 50, y: 64, z: 50 },
    to: { x: 51, y: 64, z: 51 },
  });
  await waitFor(() => results[295]);

  check(
    "createPlayer succeeds",
    results[270]?.result && !results[270].result.isError,
  );
  check(
    "setInventory writes hotbar",
    results[271]?.result?.structuredContent?.hotbar?.[0]?.item ===
      "minecraft:diamond_sword",
  );
  check(
    "getInventory reports used slot",
    results[272]?.result?.structuredContent?.usedSlots === 1,
  );
  check(
    "createEntity succeeds",
    results[273]?.result?.structuredContent?.type === "minecraft:chicken",
  );
  check(
    "getDimension counts entities and players",
    results[274]?.result?.structuredContent?.entityCount === 2 &&
      results[274]?.result?.structuredContent?.playerCount === 1,
  );
  check(
    "getDimensionBlocks pages placed blocks",
    results[275]?.result?.structuredContent?.total === 21 &&
      results[275]?.result?.structuredContent?.returned === 5,
  );
  check(
    "getPlayer is case-insensitive",
    results[276]?.result?.structuredContent?.name === "SmokePlayer",
  );
  check(
    "getEntity reads by UUID",
    results[277]?.result?.structuredContent?.id ===
      results[270]?.result?.structuredContent?.id,
  );
  check("getEntity unknown id isError", results[278]?.result?.isError === true);
  check(
    "getDimensionEntities lists entities and players",
    results[279]?.result?.structuredContent?.entityCount === 2 &&
      results[279]?.result?.structuredContent?.playerCount === 1,
  );
  check(
    "getDimensionRawFile returns a usable snapshot",
    (() => {
      try {
        const snapshot = JSON.parse(
          results[280]?.result?.structuredContent?.raw ?? "{}",
        );
        return (
          snapshot?.format === "lzimul:minecraft/dimension" &&
          snapshot?.dimension === "minecraft:overworld" &&
          snapshot?.blocks?.length === 21 &&
          snapshot?.entities?.length === 2
        );
      } catch {
        return false;
      }
    })(),
  );
  check(
    "getEntityPosition returns the player position",
    results[281]?.result?.structuredContent?.x === 0 &&
      results[281]?.result?.structuredContent?.y === 64 &&
      results[281]?.result?.structuredContent?.z === 0,
  );
  check(
    "moveEntity moves the player forward one block",
    results[282]?.result?.structuredContent?.direction === "forward" &&
      results[282]?.result?.structuredContent?.z === 1,
  );
  check(
    "setEntityPosition moves the player to exact coordinates",
    results[283]?.result?.structuredContent?.x === 4 &&
      results[283]?.result?.structuredContent?.y === 64 &&
      results[283]?.result?.structuredContent?.z === 1,
  );
  check(
    "swapInventorySlots swaps the hotbar stacks",
    results[285]?.result?.structuredContent?.previousFrom?.item ===
      "minecraft:diamond_sword" &&
      results[285]?.result?.structuredContent?.previousTo?.item ===
        "minecraft:apple" &&
      results[285]?.result?.structuredContent?.hotbar?.[0]?.item ===
        "minecraft:apple" &&
      results[285]?.result?.structuredContent?.hotbar?.[1]?.item ===
        "minecraft:diamond_sword",
  );
  check(
    "clearInventory clears both stacks",
    results[286]?.result?.structuredContent?.clearedSlots === 2 &&
      results[286]?.result?.structuredContent?.usedSlots === 0,
  );
  check(
    "getInventory confirms clearInventory",
    results[287]?.result?.structuredContent?.usedSlots === 0,
  );
  check(
    "deleteEntity deletes the chicken",
    results[288]?.result?.structuredContent?.id ===
      results[273]?.result?.structuredContent?.id &&
      results[288]?.result?.structuredContent?.type === "minecraft:chicken",
  );
  check(
    "getDimensionEntities reflects one deletion",
    results[289]?.result?.structuredContent?.entityCount === 1 &&
      results[289]?.result?.structuredContent?.playerCount === 1,
  );
  check(
    "deleteEntity deletes the player by name",
    results[290]?.result?.structuredContent?.name === "SmokePlayer",
  );
  check(
    "getDimensionEntities is empty after deletes",
    results[291]?.result?.structuredContent?.entityCount === 0 &&
      results[291]?.result?.structuredContent?.playerCount === 0,
  );
  check(
    "fillBlocks adds four blocks",
    results[292]?.result?.structuredContent?.changed === 4 &&
      results[292]?.result?.structuredContent?.modifiedBlockCount === 25,
  );
  check(
    "getBlocksInArea sees the filled blocks",
    results[293]?.result?.structuredContent?.total === 4,
  );
  check(
    "fillBlocks clears the region with air",
    results[294]?.result?.structuredContent?.removed === 4 &&
      results[294]?.result?.structuredContent?.modifiedBlockCount === 21,
  );
  check(
    "getBlocksInArea sees the cleared region",
    results[295]?.result?.structuredContent?.total === 0,
  );

  send({
    jsonrpc: "2.0",
    id: 300,
    method: "resources/read",
    params: { uri: "lzimul://minecraft/dimensions/overworld", _meta: envelope },
  });
  send({
    jsonrpc: "2.0",
    id: 301,
    method: "resources/read",
    params: { uri: "lzimul://minecraft/blocks/stone", _meta: envelope },
  });
  send({
    jsonrpc: "2.0",
    id: 302,
    method: "resources/read",
    params: { uri: "lzimul://minecraft/items/diamond_sword", _meta: envelope },
  });
  await waitFor(() => results[300] && results[301] && results[302]);

  const overworld = JSON.parse(
    results[300]?.result?.contents?.[0]?.text ?? "{}",
  );
  check(
    "overworld modifiedBlockCount 21",
    overworld.modifiedBlockCount === 21,
    `got ${overworld.modifiedBlockCount}`,
  );
  check("placedBlocks list", (overworld.placedBlocks ?? []).length === 21);
  check(
    "placedBlocks include states",
    (overworld.placedBlocks ?? []).some(
      (placed) =>
        placed.states?.facing === "south" && placed.states?.half === "bottom",
    ),
  );
  check(
    "block resource",
    JSON.parse(results[301]?.result?.contents?.[0]?.text ?? "{}").name ===
      "stone",
  );
  check(
    "item resource",
    JSON.parse(results[302]?.result?.contents?.[0]?.text ?? "{}").name ===
      "diamond_sword",
  );

  let failed = 0;
  for (const c of checks) {
    console.log(
      `${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail ? ` (${c.detail})` : ""}`,
    );
    if (!c.pass) failed++;
  }
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  proc.kill();
  await rm(dataDir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}

await main();
