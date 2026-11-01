import type { McpServer } from '@modelcontextprotocol/server';

import { toErrorMessage } from '../utils/error-message.js';
import { logger } from '../utils/logger.js';

import type {
  IToolCallEvent,
  ToolCallListener
} from '../interfaces/websocket.interface.js';

export type { IToolCallEvent, ToolCallListener };

/**
 * Structural callback shape we intercept. The real SDK callback is narrower,
 * but the wrapper only needs to forward arguments and observe the outcome.
 */
type InterceptedCallback = (
  args: unknown,
  extra: unknown
) => unknown | Promise<unknown>;

/** Structural registration signature used to swap in the wrapper. */
type InterceptedRegistrar = (
  name: string,
  config: unknown,
  cb: InterceptedCallback
) => unknown;

/** Detect the `isError` flag on a returned tool result. */
function readIsError(result: unknown): boolean {
  if (typeof result !== 'object' || result === null) {
    return false;
  }
  return (result as { isError?: unknown }).isError === true;
}

/** Best-effort message from a returned `{ isError: true, content }` result. */
function extractErrorMessage(result: unknown): string {
  if (typeof result !== 'object' || result === null) {
    return 'Tool call failed';
  }
  const content = (result as { content?: unknown }).content;
  if (Array.isArray(content)) {
    const first = content.find(
      (entry): entry is { type: string; text: string } =>
        typeof entry === 'object' &&
        entry !== null &&
        (entry as { type?: unknown }).type === 'text' &&
        typeof (entry as { text?: unknown }).text === 'string'
    );
    if (first) {
      return first.text;
    }
  }
  return 'Tool call failed';
}

/** Publish an event without ever letting an observer failure escape. */
function safeNotify(listener: ToolCallListener, event: IToolCallEvent): void {
  try {
    listener(event);
  } catch (error) {
    logger.warn(`Tool-call listener failed: ${toErrorMessage(error)}`);
  }
}

/**
 * Wrap `server.registerTool` so every tool call (present and future) emits an
 * `IToolCallEvent` to `listener`. Must run before tools are registered.
 */
export function instrumentToolCalls(
  server: McpServer,
  listener: ToolCallListener
): void {
  const host = server as unknown as { registerTool: InterceptedRegistrar };
  const original = host.registerTool.bind(server) as InterceptedRegistrar;

  host.registerTool = (name, config, cb) => {
    const wrapped: InterceptedCallback = async (args, extra) => {
      const startedAt = Date.now();
      try {
        const result = await cb(args, extra);
        const durationMs = Date.now() - startedAt;
        const isError = readIsError(result);
        safeNotify(listener, {
          type: 'tool-call',
          tool: name,
          arguments: args,
          result,
          isError,
          error: isError ? extractErrorMessage(result) : null,
          startedAt,
          durationMs
        });
        return result;
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        safeNotify(listener, {
          type: 'tool-call',
          tool: name,
          arguments: args,
          result: null,
          isError: true,
          error: toErrorMessage(error),
          startedAt,
          durationMs
        });
        throw error;
      }
    };

    return original(name, config, wrapped);
  };
}
