import { WORLD_STORAGE } from '../../config/storage.js';
import { FileWorldStore } from './file-world-store.js';
import { MemoryWorldStore } from './memory-world-store.js';

import type { IWorldStore } from '../../interfaces/world-store.interface.js';

/** Build the store selected by the environment configuration. */
export function createWorldStore(): IWorldStore {
  if (WORLD_STORAGE.kind === 'memory') {
    return new MemoryWorldStore();
  }
  return new FileWorldStore(WORLD_STORAGE.directory);
}
