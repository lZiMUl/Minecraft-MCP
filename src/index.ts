#!/usr/bin/env node

import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { createServer } from './app/server.js';
import { WORLD_STORAGE } from './config/storage.js';
import { toErrorMessage } from './utils/error-message.js';
import { logger } from './utils/logger.js';
import { createWorldStore } from './world/stores/index.js';
import { World } from './world/world.js';

async function main(): Promise<void> {
  // Load persisted world snapshots before accepting requests so the first
  // `getBlock` already sees the stored blocks.
  const world = await World.load(
    createWorldStore(),
    WORLD_STORAGE.writeDelayMs
  );
  const handle = serveStdio(() => createServer(world), {
    // This project targets MCP 2026-07-28 only: do not serve the legacy
    // 2025-era `initialize` handshake. Modern clients start with
    // `server/discover` or send any request with the per-request `_meta`
    // envelope.
    legacy: 'reject'
  });

  let shuttingDown = false;
  const shutdown = async (exitCode: number): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    let code = exitCode;
    try {
      await world.flush();
    } catch (error) {
      logger.error(
        `Failed to flush world state on shutdown: ${toErrorMessage(error)}`
      );
      code = 1;
    }

    try {
      await handle.close();
    } catch (error) {
      logger.error(
        `Failed to close the MCP transport: ${toErrorMessage(error)}`
      );
      code = 1;
    }

    process.exit(code);
  };
  process.once('SIGINT', () => {
    void shutdown(0);
  });
  process.once('SIGTERM', () => {
    void shutdown(0);
  });
}

try {
  await main();
} catch (error) {
  logger.error(`Fatal: ${toErrorMessage(error)}`);
  process.exitCode = 1;
}
