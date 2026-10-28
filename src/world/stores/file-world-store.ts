import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { WORLD_LIMITS } from '../../config/world-limits.js';
import { toErrorMessage } from '../../utils/error-message.js';
import { logger } from '../../utils/logger.js';
import { fromSerialized } from './serialized-block.js';
import { fromSerializedEntity } from './serialized-entity.js';
import {
  MAX_SNAPSHOT_BYTES,
  serializeSnapshot
} from './serialized-snapshot.js';

import type { EDimensionType } from '../../enums/dimension-type.enum.js';
import type { IEntity } from '../../interfaces/entity.interface.js';
import type { IPlacedBlock } from '../../interfaces/placed-block.interface.js';
import type {
  IWorldSnapshot,
  IWorldStore
} from '../../interfaces/world-store.interface.js';

interface IStoredWorld {
  readonly blocks?: unknown;
  readonly entities?: unknown;
}

function warn(message: string): void {
  logger.warn(message);
}

function emptySnapshot(): IWorldSnapshot {
  return { blocks: [], entities: [] };
}

/**
 * Persist one JSON document per dimension.
 *
 * Reads tolerate older snapshot formats and quarantine unusable files. Writes
 * are atomic (temporary file + rename) and bounded by the same size limit used
 * when loading, so a successful write can always be read back.
 */
export class FileWorldStore implements IWorldStore {
  private readonly directory: string;
  private directoryReady = false;

  constructor(directory: string) {
    this.directory = directory;
  }

  /** Create the snapshot directory once, lazily. */
  private async ensureDirectory(): Promise<void> {
    if (!this.directoryReady) {
      await mkdir(this.directory, { recursive: true });
      this.directoryReady = true;
    }
  }

  /** Map a dimension enum to its dedicated snapshot file. */
  private fileFor(type: EDimensionType): string {
    return path.join(this.directory, `${type}.json`);
  }

  /** Load and validate one dimension snapshot. */
  async load(type: EDimensionType): Promise<IWorldSnapshot> {
    const file = this.fileFor(type);

    let raw: string;
    try {
      const info = await stat(file);
      if (info.size > MAX_SNAPSHOT_BYTES) {
        await this.quarantine(
          file,
          `snapshot is larger than ${MAX_SNAPSHOT_BYTES} bytes`
        );
        return emptySnapshot();
      }
      raw = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return emptySnapshot();
      }
      throw new Error(
        `Cannot read world snapshot ${file}: ${toErrorMessage(error)}`,
        { cause: error }
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await this.quarantine(file, 'invalid JSON');
      return emptySnapshot();
    }

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      !Array.isArray((parsed as IStoredWorld).blocks)
    ) {
      await this.quarantine(file, 'missing blocks array');
      return emptySnapshot();
    }

    const stored = parsed as { blocks: readonly unknown[]; entities?: unknown };
    if (stored.blocks.length > WORLD_LIMITS.maxModifiedBlocks) {
      await this.quarantine(
        file,
        `${stored.blocks.length} blocks exceed the limit of ${WORLD_LIMITS.maxModifiedBlocks}`
      );
      return emptySnapshot();
    }

    let serializedEntities: readonly unknown[] = [];
    if (typeof stored.entities !== 'undefined') {
      if (!Array.isArray(stored.entities)) {
        await this.quarantine(file, 'invalid entities array');
        return emptySnapshot();
      }
      if (stored.entities.length > WORLD_LIMITS.maxEntitiesPerDimension) {
        await this.quarantine(
          file,
          `${stored.entities.length} entities exceed the limit of ${WORLD_LIMITS.maxEntitiesPerDimension}`
        );
        return emptySnapshot();
      }
      serializedEntities = stored.entities;
    }

    const blocks: IPlacedBlock[] = [];
    for (const entry of stored.blocks) {
      const block = fromSerialized(entry);
      if (block) {
        blocks.push(block);
      } else {
        warn(`Skipped malformed block entry in ${file}`);
      }
    }

    const entities: IEntity[] = [];
    for (const entry of serializedEntities) {
      try {
        const entity = fromSerializedEntity(entry, type);
        if (entity) {
          entities.push(entity);
          continue;
        }
      } catch {
        // Treat converter failures like any other malformed entry.
      }
      warn(`Skipped malformed entity entry in ${file}`);
    }

    return { blocks, entities };
  }

  /** Return the raw snapshot file, or an empty snapshot when none exists. */
  async readRaw(type: EDimensionType): Promise<string> {
    const file = this.fileFor(type);
    try {
      const info = await stat(file);
      if (info.size > MAX_SNAPSHOT_BYTES) {
        throw new RangeError(
          `World snapshot ${file} is larger than ${MAX_SNAPSHOT_BYTES} bytes`
        );
      }
      return await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return serializeSnapshot(type, emptySnapshot());
      }
      if (error instanceof RangeError) {
        throw error;
      }
      throw new Error(
        `Cannot read world snapshot ${file}: ${toErrorMessage(error)}`,
        { cause: error }
      );
    }
  }

  /** Validate, sort and atomically replace one dimension snapshot. */
  async save(type: EDimensionType, snapshot: IWorldSnapshot): Promise<void> {
    if (snapshot.blocks.length > WORLD_LIMITS.maxModifiedBlocks) {
      throw new RangeError(
        `World snapshot has ${snapshot.blocks.length} blocks, above the limit of ${WORLD_LIMITS.maxModifiedBlocks}`
      );
    }
    if (snapshot.entities.length > WORLD_LIMITS.maxEntitiesPerDimension) {
      throw new RangeError(
        `World snapshot has ${snapshot.entities.length} entities, above the limit of ${WORLD_LIMITS.maxEntitiesPerDimension}`
      );
    }

    const file = this.fileFor(type);
    const text = serializeSnapshot(type, snapshot);
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > MAX_SNAPSHOT_BYTES) {
      throw new RangeError(
        `World snapshot for ${type} would be ${bytes} bytes, above the load limit of ${MAX_SNAPSHOT_BYTES} bytes. Remove blocks, block states or entities and retry.`
      );
    }

    try {
      await this.ensureDirectory();
      const temporary = `${file}.tmp`;
      await writeFile(temporary, text, 'utf8');
      await rename(temporary, file);
    } catch (error) {
      this.directoryReady = false;
      throw new Error(
        `Failed to write world snapshot ${file}: ${toErrorMessage(error)}`,
        { cause: error }
      );
    }
  }

  /** Move an unreadable or oversized file aside so startup can continue. */
  private async quarantine(file: string, reason: string): Promise<void> {
    const backup = `${file}.corrupt-${randomUUID()}`;
    try {
      await rename(file, backup);
      warn(`World file ${file} is unusable (${reason}); moved it to ${backup}`);
    } catch (error) {
      warn(
        `World file ${file} is unusable (${reason}); could not move it: ${toErrorMessage(error)}`
      );
    }
  }
}
