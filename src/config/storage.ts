import path from 'node:path';

/** Supported persistence backends. */
export type EWorldStorageKind = 'file' | 'memory';

/** Runtime storage configuration derived from environment variables. */
export interface IWorldStorageConfig {
  readonly kind: EWorldStorageKind;
  readonly directory: string;
  readonly writeDelayMs: number;
}

/** Default to file storage unless `MCP_WORLD_STORAGE=memory` is set. */
function storageKind(): EWorldStorageKind {
  return process.env.MCP_WORLD_STORAGE?.trim().toLowerCase() === 'memory'
    ? 'memory'
    : 'file';
}

/** Default world-data directory, relative to the process working directory. */
const DEFAULT_WORLD_DIRECTORY = './app/dimensions';

/** Resolve `MCP_WORLD_DIR` relative to the process working directory. */
function storageDirectory(): string {
  const configured = process.env.MCP_WORLD_DIR?.trim();
  return path.resolve(
    configured && configured.length > 0 ? configured : DEFAULT_WORLD_DIRECTORY
  );
}

export const WORLD_STORAGE: IWorldStorageConfig = {
  kind: storageKind(),
  directory: storageDirectory(),
  writeDelayMs: 25
};
