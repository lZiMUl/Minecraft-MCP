/**
 * Parallel-write stress test: many simultaneous setBlock calls must coalesce
 * into a small number of snapshot writes without losing data, then survive a
 * server restart.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { clientEnvelope, discoverRequest } from "./protocol.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = await mkdtemp(path.join(tmpdir(), "lzimul-stress-"));
const CHECKS = 300;
const BASE = { x: 12000, y: 64, z: -8000 };
const envelope = clientEnvelope("stress-test");

const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass: Boolean(pass), detail });
}

function startServer() {
  const proc = spawn("node", ["build/index.js"], {
    cwd: root,
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, MCP_WORLD_STORAGE: "file", MCP_WORLD_DIR: dataDir },
  });
  const state = { buf: "", results: new Map(), proc };
  proc.stdout.on("data", (chunk) => {
    state.buf += chunk.toString();
    let index;
    while ((index = state.buf.indexOf("\n")) >= 0) {
      const line = state.buf.slice(0, index).trim();
      state.buf = state.buf.slice(index + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.id !== void 0) state.results.set(message.id, message);
    }
  });
  state.send = (message) => proc.stdin.write(`${JSON.stringify(message)}\n`);
  state.call = (id, name, args) =>
    state.send({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args, _meta: envelope },
    });
  state.discover = async () => {
    state.send(discoverRequest(0, "stress-test"));
    const started = performance.now();
    while (!state.results.has(0)) {
      if (performance.now() - started > 10_000) {
        throw new Error("server/discover timed out");
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return performance.now() - started;
  };
  state.stop = async (signal) => {
    proc.kill(signal);
    await new Promise((resolve) => proc.once("exit", resolve));
  };
  return state;
}

async function waitForResults(server, ids, timeoutMs = 20_000) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if (ids.every((id) => server.results.has(id))) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

const first = startServer();
const startupMs = await first.discover();
check("stdio startup", startupMs < 5000, `${startupMs.toFixed(0)}ms`);

const ids = Array.from({ length: CHECKS }, (_, index) => index + 1);
const started = performance.now();
for (const [index, id] of ids.entries()) {
  first.call(id, "setBlock", {
    x: BASE.x + (index % 20),
    y: BASE.y + Math.floor(index / 100),
    z: BASE.z + (Math.floor(index / 20) % 5),
    blockType: index % 3 === 0 ? "oak_stairs[facing=south]" : "stone",
  });
}
const allAnswered = await waitForResults(first, ids);
const elapsed = performance.now() - started;
check("parallel setBlock answered", allAnswered, `${elapsed.toFixed(0)}ms`);

const failures = ids.filter((id) => first.results.get(id)?.result?.isError);
check(
  "no parallel write failed",
  allAnswered && failures.length === 0,
  `${failures.length} failures`,
);

const snapshot = JSON.parse(
  await readFile(path.join(dataDir, "overworld.json"), "utf8"),
);
const unique = new Set(
  snapshot.blocks.map((block) => `${block.x},${block.y},${block.z}`),
);
check(
  "every write reached disk",
  unique.size === CHECKS &&
    snapshot.blocks.length === CHECKS &&
    snapshot.modifiedBlockCount === CHECKS,
  `${unique.size} unique / ${snapshot.blocks.length} stored`,
);

check(
  "states reached disk",
  snapshot.blocks.some(
    (block) =>
      block.block === "minecraft:oak_stairs" &&
      block.states?.facing === "south",
  ),
);

const readback = first.call(9001, "getBlock", {
  x: BASE.x,
  y: BASE.y,
  z: BASE.z,
});
await readback;
await waitForResults(first, [9001]);
check(
  "parallel writes are readable",
  first.results.get(9001)?.result?.structuredContent?.block?.key ===
    "minecraft:oak_stairs",
);
await first.stop("SIGTERM");

const second = startServer();
await second.discover();
for (const id of [10001, 10002, 10003]) {
  second.call(id, "getBlock", {
    x: BASE.x + (id - 10001),
    y: BASE.y,
    z: BASE.z,
  });
}
await waitForResults(second, [10001, 10002, 10003]);
check(
  "blocks survive a restart",
  [10001, 10002, 10003].every(
    (id) =>
      second.results.get(id)?.result?.structuredContent?.block?.key !==
      "minecraft:air",
  ),
);
await second.stop("SIGTERM");

await rm(dataDir, { recursive: true, force: true });

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
