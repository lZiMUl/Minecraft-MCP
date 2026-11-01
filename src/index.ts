#!/usr/bin/env node

import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { createServer } from './app/server.js';
import { startWebSocketService } from './app/websocket.js';
import { WEBSOCKET_CONFIG } from './config/websocket.js';
import { WORLD_STORAGE } from './config/storage.js';
import { toErrorMessage } from './utils/error-message.js';
import { logger } from './utils/logger.js';
import { createWorldStore } from './world/stores/index.js';
import { World } from './world/world.js';

import type { IWebSocketService } from './app/websocket.js';

async function main(): Promise<void> {
  // Load persisted world snapshots before accepting requests so the first
  // `getBlock` already sees the stored blocks.
  const world = await World.load(
    createWorldStore(),
    WORLD_STORAGE.writeDelayMs
  );

  // Start the WebSocket fan-out service (best-effort; a listen failure is
  // logged but never prevents the MCP transport from running).
  let wsService: IWebSocketService | null = null;
  if (WEBSOCKET_CONFIG.enabled) {
    wsService = startWebSocketService(world, WEBSOCKET_CONFIG);
    logger.info(
      `WebSocket service listening on ws://${WEBSOCKET_CONFIG.host}:${WEBSOCKET_CONFIG.port}${WEBSOCKET_CONFIG.path}`
    );
  }

  const handle = serveStdio(
    () =>
      createServer(world, wsService ? { onToolCall: wsService.broadcast } : {}),
    {
      // This project targets MCP 2026-07-28 only: do not serve the legacy
      // 2025-era `initialize` handshake. Modern clients start with
      // `server/discover` or send any request with the per-request `_meta`
      // envelope.
      legacy: 'reject'
    }
  );

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

    if (wsService) {
      try {
        await wsService.close();
      } catch (error) {
        logger.error(
          `Failed to close the WebSocket service: ${toErrorMessage(error)}`
        );
        code = 1;
      }
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

// Public WebSocket protocol types for clients importing the package.
export type {
  IDimensionSnapshot,
  ISnapshotPlacedBlock,
  IToolCallEvent,
  IWebSocketClientMessage,
  IWebSocketServerMessage,
  IWorldSnapshotMessage,
  ToolCallListener
} from './interfaces/websocket.interface.js';
