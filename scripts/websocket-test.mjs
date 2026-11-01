/**
 * End-to-end WebSocket fan-out test.
 *
 * Starts the real stdio server (with the WebSocket service enabled) against a
 * temporary world directory, connects two WebSocket clients and verifies that:
 *   - each client receives the world snapshot on connect,
 *   - every tool call is broadcast to every connected client,
 *   - success and error tool calls are reported with their arguments, result
 *     and timing,
 *   - a client can request the world snapshot again.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { WebSocket } from "ws";

import {
  clientEnvelope,
  discoverRequest,
  PROTOCOL_VERSION,
} from "./protocol.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = await mkdtemp(path.join(tmpdir(), "lzimul-ws-"));

/** Ask the OS for a free TCP port so parallel runs never collide. */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const port = await findFreePort();
const url = `ws://127.0.0.1:${port}/`;

const proc = spawn("node", ["build/index.js"], {
  cwd: root,
  stdio: ["pipe", "pipe", "inherit"],
  env: {
    ...process.env,
    MCP_WORLD_STORAGE: "file",
    MCP_WORLD_DIR: dataDir,
    MCP_WS_ENABLED: "true",
    MCP_WS_HOST: "127.0.0.1",
    MCP_WS_PORT: String(port),
  },
});

// --- stdio MCP plumbing -----------------------------------------------------

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
const envelope = clientEnvelope("websocket-test");
const call = (id, name, args) =>
  send({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args, _meta: envelope },
  });

// --- WebSocket helpers ------------------------------------------------------

/** Connect with retries while the server is still binding the port. The
 * message collector is attached at construction so the on-connect snapshot
 * can never be missed. */
function connect(target, attempts = 50) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const attempt = () => {
      tries++;
      const socket = new WebSocket(target);
      const messages = collect(socket);
      socket.on("open", () => resolve({ socket, messages }));
      socket.on("error", (err) => {
        if (tries >= attempts) reject(err);
        else setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}

/** Collect every parsed JSON message a socket receives. */
function collect(socket) {
  const messages = [];
  socket.on("message", (data) => {
    try {
      messages.push(JSON.parse(data.toString()));
    } catch {
      // Ignore unparseable frames; the service only sends JSON.
    }
  });
  return messages;
}

const checks = [];
function check(name, condition, detail) {
  checks.push({ name, pass: Boolean(condition), detail });
}

async function waitFor(predicate, timeoutMs = 5000) {
  for (let t = 0; t < timeoutMs / 100 && !predicate(); t++) await sleep(100);
  return predicate();
}

// --- main -------------------------------------------------------------------

async function main() {
  const ws1 = await connect(url);
  const messages1 = ws1.messages;
  const ws2 = await connect(url);
  const messages2 = ws2.messages;

  // Both clients get the world snapshot on connect.
  await waitFor(() => messages1.some((m) => m.type === "world-snapshot"));
  const snapshot = messages1.find((m) => m.type === "world-snapshot");
  check("client 1 receives world-snapshot on connect", Boolean(snapshot));
  check(
    "snapshot exposes all three dimensions",
    (snapshot?.dimensions ?? []).length === 3,
    `got ${(snapshot?.dimensions ?? []).length}`,
  );
  const overworld = (snapshot?.dimensions ?? []).find(
    (d) => d.type === "overworld",
  );
  check(
    "snapshot overworld has counters",
    typeof overworld?.modifiedBlockCount === "number" &&
      typeof overworld?.entityCount === "number",
  );

  await waitFor(() => messages2.some((m) => m.type === "world-snapshot"));
  const snapshot2 = messages2.find((m) => m.type === "world-snapshot");
  check("client 2 receives world-snapshot on connect", Boolean(snapshot2));
  check(
    "client 2 snapshot exposes all three dimensions",
    (snapshot2?.dimensions ?? []).length === 3,
    `got ${(snapshot2?.dimensions ?? []).length}`,
  );

  // Bring the MCP session up.
  send(discoverRequest(1, "websocket-test"));
  await waitFor(() => results[1]);
  check(
    "server/discover negotiates 2026-07-28",
    results[1]?.result?.supportedVersions?.includes(PROTOCOL_VERSION),
    JSON.stringify(results[1]?.result?.supportedVersions),
  );

  // Successful tool call is broadcast to both clients.
  call(10, "getItem", { item: "minecraft:diamond_sword" });
  await waitFor(() =>
    messages1.some((m) => m.type === "tool-call" && m.tool === "getItem"),
  );
  const success = messages1.find(
    (m) => m.type === "tool-call" && m.tool === "getItem",
  );
  check("tool-call event received for getItem", Boolean(success));
  check(
    "success event arguments echoed",
    success?.arguments?.item === "minecraft:diamond_sword",
    JSON.stringify(success?.arguments),
  );
  check("success event isError false", success?.isError === false);
  check(
    "success event carries a result",
    typeof success?.result === "object" && success?.result !== null,
  );
  check(
    "success event records timing",
    typeof success?.startedAt === "number" &&
      typeof success?.durationMs === "number" &&
      success.durationMs >= 0,
    String(success?.durationMs),
  );

  await waitFor(() =>
    messages2.some((m) => m.type === "tool-call" && m.tool === "getItem"),
  );
  check(
    "tool-call broadcast reaches client 2",
    messages2.some((m) => m.type === "tool-call" && m.tool === "getItem"),
  );

  // Error tool call is reported with isError and a message. `y=320` is within
  // the zod schema range (maxVertical) but outside the overworld's runtime
  // bounds (maxY=320 excludes 320), so the handler returns a tool error.
  call(11, "getBlock", { dimension: "overworld", x: 0, y: 320, z: 0 });
  await waitFor(() =>
    messages1.some((m) => m.type === "tool-call" && m.tool === "getBlock"),
  );
  const failure = messages1.find(
    (m) => m.type === "tool-call" && m.tool === "getBlock",
  );
  check("tool-call event received for getBlock", Boolean(failure));
  check("error event isError true", failure?.isError === true);
  check(
    "error event carries a message",
    typeof failure?.error === "string" && failure.error.length > 0,
    String(failure?.error),
  );

  // A client can re-request the world snapshot.
  ws1.socket.send(JSON.stringify({ type: "world-request" }));
  await waitFor(
    () => messages1.filter((m) => m.type === "world-snapshot").length >= 2,
  );
  check(
    "world-request re-sends the snapshot",
    messages1.filter((m) => m.type === "world-snapshot").length >= 2,
  );

  ws1.socket.close();
  ws2.socket.close();

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
