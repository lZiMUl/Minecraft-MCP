/**
 * Error and storage-hardening tests.
 *
 * Covers error message fallbacks, state sanitizing, snapshot format/limits,
 * corrupt-file quarantine and flush retry behavior.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { getBlockByName } from "../build/data/blocks.js";
import { toErrorMessage } from "../build/utils/error-message.js";
import { normalizeStates } from "../build/world/block-states.js";
import { parseBlockSpec } from "../build/world/block-spec.js";
import { FileWorldStore } from "../build/world/stores/file-world-store.js";
import { World } from "../build/world/world.js";

const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass: Boolean(pass), detail });
}

function testErrorMessages() {
  const circular = {};
  circular.self = circular;

  check(
    "void 0 becomes a fallback",
    toErrorMessage(void 0) === "Unknown error",
  );
  check("null becomes a fallback", toErrorMessage(null) === "Unknown error");
  check(
    "empty string becomes a fallback",
    toErrorMessage("") === "Unknown error",
  );
  check(
    "circular values become a fallback",
    toErrorMessage(circular) === "Unknown error",
  );
  check("messages are trimmed", toErrorMessage("  boom  ") === "boom");
  check(
    "empty errors keep their name",
    toErrorMessage(new Error("")) === "Error",
  );
}

function testStateSanitizing() {
  const polluted = JSON.parse('{"__proto__":"x","facing":"NORTH"}');
  const states = normalizeStates(polluted);
  check(
    "reserved state names are dropped",
    JSON.stringify(states) === '{"facing":"north"}',
    JSON.stringify(states),
  );
  check("prototype pollution is impossible", {}.facing === void 0);

  const reserved = parseBlockSpec("oak_stairs[constructor=x]");
  check("reserved state names are rejected", reserved.ok === false);
  const normalized = parseBlockSpec(" Oak_Stairs[Facing=SOUTH] ");
  check(
    "state names are normalized",
    normalized.ok === true && normalized.states.facing === "south",
  );
  check(
    "empty state lists are rejected",
    parseBlockSpec("minecraft:stone[]").ok === false,
  );
}

async function testFileStore() {
  const directory = await mkdtemp(path.join(tmpdir(), "lzimul-errors-"));
  const store = new FileWorldStore(directory);
  const stairs = getBlockByName("oak_stairs");

  await store.save("overworld", {
    blocks: [
      {
        x: 0,
        y: 64,
        z: 0,
        block: stairs,
        states: { facing: "east", half: "top" },
      },
    ],
    entities: [],
  });
  const loaded = await store.load("overworld");
  check(
    "file store round-trips states",
    loaded.blocks[0]?.states?.facing === "east" &&
      loaded.blocks[0]?.states?.half === "top",
  );

  const raw = JSON.parse(
    await readFile(path.join(directory, "overworld.json"), "utf8"),
  );
  check(
    "snapshots use the current format",
    raw.format === "lzimul:minecraft/dimension" &&
      raw.blocks.length === 1 &&
      raw.blocks[0].states.facing === "east" &&
      raw.entityCount === 0,
  );

  let tooLarge = false;
  try {
    await store.save("overworld", {
      blocks: new Array(250_001),
      entities: [],
    });
  } catch (error) {
    tooLarge = error instanceof RangeError;
  }
  check("oversized snapshots are rejected", tooLarge);

  await writeFile(path.join(directory, "the_nether.json"), "{not json", "utf8");
  const corrupt = await store.load("the_nether");
  const files = await readdir(directory);
  check(
    "corrupt snapshots are quarantined",
    corrupt.blocks.length === 0 &&
      corrupt.entities.length === 0 &&
      files.some((file) => file.startsWith("the_nether.json.corrupt-")),
  );

  await rm(directory, { recursive: true, force: true });
}

async function testFlushCoalescing() {
  let saves = 0;
  let persisted = [];
  const store = {
    async load() {
      return { blocks: [], entities: [] };
    },
    async save(_type, snapshot) {
      saves++;
      persisted = snapshot;
      await new Promise((resolve) => setTimeout(resolve, 2));
    },
  };

  const world = await World.load(store, 0);
  const dimension = world.getDimension("overworld");
  const stone = getBlockByName("stone");
  const flushes = [];
  for (let index = 0; index < 100; index++) {
    dimension.setBlock(index, 64, 0, stone);
    flushes.push(dimension.flush());
  }
  await Promise.all(flushes);

  check(
    "parallel flushes coalesce into few writes",
    saves <= 3,
    `${saves} saves for 100 blocks`,
  );
  check("coalesced snapshot has every block", persisted.blocks.length === 100);
}

async function testFlushRetry() {
  let attempts = 0;
  const store = {
    async load() {
      return { blocks: [], entities: [] };
    },
    async save() {
      attempts++;
      if (attempts === 1) {
        throw new Error("simulated write failure");
      }
    },
  };

  const world = await World.load(store, 0);
  const dimension = world.getDimension("overworld");
  dimension.setBlock(0, 64, 0, getBlockByName("stone"));

  let failed = false;
  try {
    await dimension.flush();
  } catch {
    failed = true;
  }

  await dimension.flush();
  check(
    "failed flush retries on the next call",
    failed && attempts === 2,
    `${attempts} attempts`,
  );
}

async function testOutOfRangeLoad() {
  const directory = await mkdtemp(path.join(tmpdir(), "lzimul-range-"));
  await writeFile(
    path.join(directory, "overworld.json"),
    JSON.stringify({
      format: "lzimul-world/2",
      dimension: "minecraft:overworld",
      updatedAt: new Date().toISOString(),
      modifiedBlockCount: 3,
      blocks: [
        { x: 0, y: 64, z: 0, block: "minecraft:stone" },
        { x: 0, y: 999, z: 0, block: "minecraft:stone" },
        { x: 99999999, y: 64, z: 0, block: "minecraft:stone" },
      ],
    }),
    "utf8",
  );

  const world = await World.load(new FileWorldStore(directory), 0);
  check(
    "out-of-range blocks are ignored on load",
    world.getDimension("overworld").modifiedBlockCount === 1,
    `${world.getDimension("overworld").modifiedBlockCount} kept`,
  );

  await rm(directory, { recursive: true, force: true });
}

testErrorMessages();
testStateSanitizing();
await testFileStore();
await testFlushCoalescing();
await testFlushRetry();
await testOutOfRangeLoad();

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
process.exit(failed ? 1 : 0);
