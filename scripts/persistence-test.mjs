/**
 * Restart test: writes blocks, a player and an inventory, stops the server,
 * starts a new process against the same directory and reads the state back.
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { clientEnvelope, discoverRequest } from "./protocol.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = await mkdtemp(path.join(tmpdir(), "lzimul-persist-"));
const envelope = clientEnvelope("persistence-test");
const BLOCK = "minecraft:oak_stairs";
const POS = { x: 321, y: 70, z: -654 };
const PLAIN_POS = { x: 322, y: 70, z: -654 };

const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass: Boolean(pass), detail });
}

function startServer() {
  const proc = spawn("node", ["build/index.js"], {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, MCP_WORLD_STORAGE: "file", MCP_WORLD_DIR: dataDir },
  });

  const pending = new Map();
  let buffer = "";
  let stderr = "";

  proc.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  proc.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) {
        continue;
      }
      const message = JSON.parse(line);
      pending.set(message.id, message);
    }
  });

  const send = (message) => proc.stdin.write(JSON.stringify(message) + "\n");
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const client = {
    proc,
    stderr: () => stderr,
    send,
    async waitFor(id, timeout = 8000) {
      for (let waited = 0; waited < timeout && !pending.has(id); waited += 50) {
        await sleep(50);
      }
      return pending.get(id);
    },
    async init() {
      send(discoverRequest(1, "persistence-test"));
      return client.waitFor(1);
    },
    call(id, name, args) {
      send({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: args, _meta: envelope },
      });
      return client.waitFor(id);
    },
    async stop() {
      proc.stdin.end();
      proc.kill();
      await Promise.race([
        once(proc, "exit"),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    },
  };

  return client;
}

async function main() {
  // Phase 1: write a block, make sure it is acknowledged before shutdown.
  const first = startServer();
  await first.init();
  const set = await first.call(10, "setBlock", {
    ...POS,
    blockType: "minecraft:oak_stairs[facing=north,half=top]",
  });
  check(
    "phase 1 setBlock",
    set?.result?.structuredContent?.block?.key === BLOCK,
    set?.result?.content?.[0]?.text,
  );
  check(
    "setBlock echoes states",
    set?.result?.structuredContent?.states?.facing === "north" &&
      set?.result?.structuredContent?.states?.half === "top",
  );
  const setPlain = await first.call(12, "setBlock", {
    ...PLAIN_POS,
    blockType: "lapis_block",
  });
  check(
    "phase 1 setBlock without states",
    setPlain?.result?.structuredContent?.block?.key ===
      "minecraft:lapis_block" &&
      Object.keys(setPlain?.result?.structuredContent?.states ?? {}).length ===
        0,
  );
  const PLAYER_POS = { x: 323, y: 70, z: -654 };
  const player = await first.call(13, "createPlayer", {
    ...PLAYER_POS,
    name: "PersistentPlayer",
  });
  check(
    "phase 1 createPlayer",
    player?.result?.structuredContent?.name === "PersistentPlayer",
  );
  const inventory = await first.call(14, "setInventory", {
    target: "PersistentPlayer",
    section: "inventory",
    slot: 0,
    item: "minecraft:stone",
    count: 3,
  });
  check(
    "phase 1 setInventory",
    inventory?.result?.structuredContent?.inventory?.[0]?.item ===
      "minecraft:stone",
  );
  const read = await first.call(11, "getBlock", POS);
  check(
    "phase 1 readback",
    read?.result?.structuredContent?.block?.key === BLOCK &&
      read?.result?.structuredContent?.states?.facing === "north",
  );
  await first.stop();

  // Phase 2: the on-disk snapshot must exist and be per dimension.
  const file = path.join(dataDir, "overworld.json");
  const snapshot = JSON.parse(await readFile(file, "utf8"));
  check(
    "one snapshot file per dimension",
    snapshot.dimension === "minecraft:overworld" &&
      snapshot.format === "lzimul:minecraft/dimension" &&
      snapshot.blocks.length === 2 &&
      snapshot.entityCount === 1,
    `${snapshot.dimension} / ${snapshot.blocks?.length} blocks / ${snapshot.entityCount} entities`,
  );
  check(
    "snapshot stores entities",
    snapshot.entities?.length === 1 &&
      snapshot.entities[0]?.name === "PersistentPlayer" &&
      snapshot.entities[0]?.type === "minecraft:player",
  );
  check(
    "snapshot stores entity inventory",
    snapshot.entities[0]?.inventory?.inventory?.[0]?.item ===
      "minecraft:stone" &&
      snapshot.entities[0]?.inventory?.inventory?.[0]?.count === 3,
  );
  check("snapshot stores the block id", snapshot.blocks[0]?.block === BLOCK);
  check(
    "snapshot stores block states",
    snapshot.blocks[0]?.states?.facing === "north" &&
      snapshot.blocks[0]?.states?.half === "top",
  );
  check(
    "snapshot omits empty states",
    snapshot.blocks[1]?.states === void 0 &&
      snapshot.blocks[1]?.block === "minecraft:lapis_block",
  );

  // Phase 3: a brand new process must see the stored block.
  const second = startServer();
  await second.init();
  const after = await second.call(20, "getBlock", POS);
  check(
    "block survives a restart",
    after?.result?.structuredContent?.block?.key === BLOCK &&
      after?.result?.structuredContent?.states?.facing === "north" &&
      after?.result?.structuredContent?.states?.half === "top",
    after?.result?.content?.[0]?.text,
  );
  const plainAfter = await second.call(23, "getBlock", PLAIN_POS);
  check(
    "stateless block survives a restart",
    plainAfter?.result?.structuredContent?.block?.key ===
      "minecraft:lapis_block",
  );
  const playerAfter = await second.call(24, "getPlayer", {
    name: "persistentplayer",
  });
  check(
    "player survives a restart",
    playerAfter?.result?.structuredContent?.name === "PersistentPlayer" &&
      playerAfter?.result?.structuredContent?.dimension === "overworld",
    playerAfter?.result?.content?.[0]?.text,
  );
  const inventoryAfter = await second.call(25, "getInventory", {
    target: "PersistentPlayer",
  });
  check(
    "entity inventory survives a restart",
    inventoryAfter?.result?.structuredContent?.inventory?.[0]?.item ===
      "minecraft:stone",
  );
  const nether = await second.call(21, "getBlock", {
    ...POS,
    dimension: "the_nether",
  });
  check(
    "dimensions stay isolated after restart",
    nether?.result?.structuredContent?.block?.key === "minecraft:air",
  );

  second.send({
    jsonrpc: "2.0",
    id: 22,
    method: "resources/read",
    params: { uri: "lzimul://minecraft/dimensions/overworld", _meta: envelope },
  });
  const resource = await second.waitFor(22);
  const state = JSON.parse(resource?.result?.contents?.[0]?.text ?? "{}");
  check(
    "dimension resource reports persisted count",
    state.modifiedBlockCount === 2,
    `got ${state.modifiedBlockCount}`,
  );
  await second.stop();

  if (second.stderr()) {
    console.error(second.stderr());
  }

  let failed = 0;
  for (const entry of checks) {
    console.log(
      `${entry.pass ? "PASS" : "FAIL"}  ${entry.name}${entry.detail ? ` (${entry.detail})` : ""}`,
    );
    if (!entry.pass) {
      failed++;
    }
  }
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);

  await rm(dataDir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}

await main();
