import path from 'node:path';

export type EWorldStorageKind = 'file' | 'memory';

export interface IWorldStorageConfig {
  readonly kind: EWorldStorageKind;
  readonly directory: string;
  readonly writeDelayMs: number;
}

function storageKind(): EWorldStorageKind {
  return process.env.MCP_WORLD_STORAGE?.trim().toLowerCase() === 'memory'
    ? 'memory'
    : 'file';
}

function storageDirectory(): string {
  const configured = process.env.MCP_WORLD_DIR?.trim();
  return path.resolve(
    configured && configured.length > 0 ? configured : './world-data'
  );
}

export const WORLD_STORAGE: IWorldStorageConfig = {
  kind: storageKind(),
  directory: storageDirectory(),
  writeDelayMs: 25
};
