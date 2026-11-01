import { WebSocket, WebSocketServer } from 'ws';

import { toErrorMessage } from '../utils/error-message.js';
import { logger } from '../utils/logger.js';
import { dimensionState } from '../resources/dimension-resources.js';
import { World } from '../world/world.js';

import type { IWebSocketConfig } from '../config/websocket.js';
import type {
  IToolCallEvent,
  IWebSocketClientMessage,
  IWebSocketServerMessage,
  IWorldSnapshotMessage
} from '../interfaces/websocket.interface.js';

/** Handle for the live WebSocket fan-out service. */
export interface IWebSocketService {
  /** Broadcast a tool-call event to every connected client. */
  broadcast(event: IToolCallEvent): void;
  /** Number of currently connected clients. */
  clientCount(): number;
  /** Close every client and stop listening. */
  close(): Promise<void>;
}

/** Build the world snapshot sent to each client on connect. */
function buildWorldSnapshot(world: World): IWorldSnapshotMessage {
  return {
    type: 'world-snapshot',
    timestamp: Date.now(),
    dimensions: World.listDimensions().map(dimension =>
      dimensionState(world, dimension)
    )
  };
}

/** Send a pre-serialized text payload to one socket, ignoring closed ones. */
function sendText(socket: WebSocket, text: string): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }
  try {
    socket.send(text);
  } catch (error) {
    logger.warn(`WebSocket send failed: ${toErrorMessage(error)}`);
  }
}

/** Serialize a payload and send it to one socket. */
function sendObject(socket: WebSocket, payload: IWebSocketServerMessage): void {
  try {
    sendText(socket, JSON.stringify(payload));
  } catch (error) {
    logger.warn(`WebSocket serialize failed: ${toErrorMessage(error)}`);
  }
}

/** Narrow a parsed JSON value to a supported client control message. */
function isClientMessage(value: unknown): value is IWebSocketClientMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return type === 'world-request' || type === 'world';
}

/** Reply to a small set of client control messages. */
function handleClientMessage(
  world: World,
  socket: WebSocket,
  data: WebSocket.RawData
): void {
  const text = data.toString().trim();
  if (text.length === 0) {
    return;
  }

  let request: unknown;
  try {
    request = JSON.parse(text);
  } catch {
    // Ignore non-JSON payloads; the service is push-oriented.
    return;
  }

  if (isClientMessage(request)) {
    sendObject(socket, buildWorldSnapshot(world));
  }
}

/**
 * Start the WebSocket fan-out service.
 *
 * Every connected client receives the full world state on connect, then a
 * `tool-call` event for every MCP tool invocation (arguments, result, error
 * and timing). A listen failure is logged but never crashes the process.
 */
export function startWebSocketService(
  world: World,
  config: IWebSocketConfig
): IWebSocketService {
  const clients = new Set<WebSocket>();

  const wss = new WebSocketServer({
    host: config.host,
    port: config.port,
    path: config.path
  });

  wss.on('error', error => {
    logger.error(`WebSocket service error: ${toErrorMessage(error)}`);
  });

  wss.on('connection', socket => {
    clients.add(socket);
    logger.info(`WebSocket client connected (${clients.size} client(s))`);

    sendObject(socket, buildWorldSnapshot(world));

    socket.on('message', data => {
      handleClientMessage(world, socket, data);
    });
    socket.on('close', () => {
      clients.delete(socket);
      logger.info(`WebSocket client disconnected (${clients.size} client(s))`);
    });
    socket.on('error', error => {
      logger.warn(`WebSocket client error: ${toErrorMessage(error)}`);
      clients.delete(socket);
    });
  });

  function broadcast(event: IToolCallEvent): void {
    if (clients.size === 0) {
      return;
    }
    let text: string;
    try {
      text = JSON.stringify(event);
    } catch (error) {
      logger.warn(
        `WebSocket tool-call serialize failed: ${toErrorMessage(error)}`
      );
      return;
    }
    for (const socket of clients) {
      sendText(socket, text);
    }
  }

  function clientCount(): number {
    return clients.size;
  }

  async function close(): Promise<void> {
    for (const socket of clients) {
      try {
        socket.close(1001, 'Server shutting down');
      } catch {
        // Ignore per-socket close failures; the server close below is enough.
      }
    }
    clients.clear();
    await new Promise<void>(resolve => {
      wss.close(() => {
        resolve();
      });
    });
  }

  return { broadcast, clientCount, close };
}
