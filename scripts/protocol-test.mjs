/**
 * Protocol regression test for the MCP 2026-07-28 handshake.
 *
 * It verifies that legacy `initialize` requests are rejected without closing
 * the connection, that modern discovery works, and that the per-request
 * envelope is required for normal requests.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  clientEnvelope,
  discoverRequest,
  PROTOCOL_VERSION,
} from "./protocol.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const proc = spawn("node", ["build/index.js"], {
  cwd: root,
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, MCP_WORLD_STORAGE: "memory" },
});

let stderr = "";
proc.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

let buf = "";
const results = new Map();
proc.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let index;
  while ((index = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, index).trim();
    buf = buf.slice(index + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.id !== void 0) results.set(message.id, message);
  }
});

const send = (message) => proc.stdin.write(`${JSON.stringify(message)}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(id, timeout = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeout && !results.has(id)) {
    await sleep(50);
  }
  return results.get(id);
}

const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass: Boolean(pass), detail });
}

const envelope = clientEnvelope("protocol-test");

async function main() {
  // A legacy opening must be refused, but must not close the connection.
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "protocol-test", version: "1.0" },
    },
  });
  const legacy = await waitFor(1);
  check(
    "legacy initialize is rejected",
    legacy?.error?.code === -32022,
    JSON.stringify(legacy?.error),
  );
  check(
    "rejection advertises 2026-07-28",
    legacy?.error?.data?.supported?.includes(PROTOCOL_VERSION),
    JSON.stringify(legacy?.error?.data),
  );

  // The same connection still accepts a modern opening.
  send(discoverRequest(2, "protocol-test"));
  const discover = await waitFor(2);
  check(
    "server/discover works after a rejected legacy opening",
    discover?.result?.supportedVersions?.includes(PROTOCOL_VERSION),
    JSON.stringify(discover?.result?.supportedVersions),
  );
  check(
    "discovery resultType is complete",
    discover?.result?.resultType === "complete",
    discover?.result?.resultType,
  );
  check(
    "discovery identifies the server",
    discover?.result?._meta?.["io.modelcontextprotocol/serverInfo"]?.title ===
      "lZiMUl Minecraft MCP",
  );

  // Modern requests without the per-request envelope are refused.
  send({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} });
  const noEnvelope = await waitFor(3);
  check(
    "request without the envelope is rejected",
    noEnvelope?.error?.code === -32022,
    JSON.stringify(noEnvelope?.error),
  );
  check(
    "missing envelope error names 2026-07-28",
    noEnvelope?.error?.data?.supported?.includes(PROTOCOL_VERSION),
    JSON.stringify(noEnvelope?.error?.data),
  );

  // The envelope makes the same request valid.
  send({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/list",
    params: { _meta: envelope },
  });
  const tools = await waitFor(4);
  const toolNames = (tools?.result?.tools ?? []).map((tool) => tool.name);
  check(
    "request with the envelope is served",
    toolNames.length === 21,
    `${toolNames.length} tools`,
  );
  check(
    "tool list contains block and entity tools",
    [
      "getBlock",
      "setBlock",
      "getDimensionEntities",
      "getDimensionRawFile",
      "getBlocksInArea",
      "fillBlocks",
      "deleteEntity",
      "clearInventory",
      "swapInventorySlots",
      "moveEntity",
      "getEntityPosition",
      "setEntityPosition",
      "createEntity",
      "setInventory",
    ].every((name) => toolNames.includes(name)),
    toolNames.join(", "),
  );
  check(
    "tool list resultType is complete",
    tools?.result?.resultType === "complete",
    tools?.result?.resultType,
  );

  send({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: {
      name: "getItem",
      arguments: { item: "diamond_sword" },
      _meta: envelope,
    },
  });
  const call = await waitFor(5);
  check(
    "tool call with the envelope is served",
    call?.result?.structuredContent?.item?.maxDurability === 1561,
    call?.result?.content?.[0]?.text,
  );
  check(
    "tool call resultType is complete",
    call?.result?.resultType === "complete",
    call?.result?.resultType,
  );

  let failed = 0;
  for (const entry of checks) {
    console.log(
      `${entry.pass ? "PASS" : "FAIL"}  ${entry.name}${entry.detail ? ` (${entry.detail})` : ""}`,
    );
    if (!entry.pass) failed++;
  }
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);

  if (stderr) {
    console.error(stderr);
  }
  proc.kill();
  process.exit(failed ? 1 : 0);
}

await main();
