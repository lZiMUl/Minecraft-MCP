import type { EDimensionType } from '../enums/dimension-type.enum.js';
import type { BlockInfo } from '../schemas/block-schema.js';
import type { EntityInfo } from '../schemas/entity-schema.js';
import type { BlockStates } from './block-states.interface.js';

/** One placed block serialized into a world snapshot. */
export interface ISnapshotPlacedBlock {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly block: BlockInfo;
  readonly states: BlockStates;
}

/** Live state of one dimension as sent to WebSocket clients. */
export interface IDimensionSnapshot {
  readonly key: string;
  readonly type: EDimensionType;
  readonly displayName: string;
  readonly minY: number;
  readonly maxY: number;
  readonly hasSkylight: boolean;
  readonly modifiedBlockCount: number;
  readonly entityCount: number;
  readonly playerCount: number;
  readonly placedBlocks: readonly ISnapshotPlacedBlock[];
  readonly entities: readonly EntityInfo[];
}

/** Full world state pushed on connect and on demand. */
export interface IWorldSnapshotMessage {
  readonly type: 'world-snapshot';
  /** Epoch milliseconds when the snapshot was built. */
  readonly timestamp: number;
  readonly dimensions: readonly IDimensionSnapshot[];
}

/** A single tool invocation observed by the instrumentation hook. */
export interface IToolCallEvent {
  readonly type: 'tool-call';
  readonly tool: string;
  readonly arguments: unknown;
  readonly result: unknown;
  readonly isError: boolean;
  readonly error: string | null;
  /** Epoch milliseconds when the handler started. */
  readonly startedAt: number;
  /** Wall-clock duration of the handler in milliseconds. */
  readonly durationMs: number;
}

/** Listener invoked after every tool call settles (success or failure). */
export type ToolCallListener = (event: IToolCallEvent) => void;

/** Control messages accepted from a WebSocket client. */
export type IWebSocketClientMessage =
  { readonly type: 'world-request' } | { readonly type: 'world' };

/** Every message the server pushes to WebSocket clients. */
export type IWebSocketServerMessage = IWorldSnapshotMessage | IToolCallEvent;
