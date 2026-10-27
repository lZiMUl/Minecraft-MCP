import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { WORLD_LIMITS } from '../../config/world-limits.js';
import { toErrorMessage } from '../../utils/error-message.js';
import { fromSerialized, toSerialized } from './serialized-block.js';

import type { EDimensionType } from '../../enums/dimension-type.enum.js';
import type { IPlacedBlock } from '../../interfaces/placed-block.interface.js';
import type { IWorldStore } from '../../interfaces/world-store.interface.js';
import type { ISerializedBlock } from './serialized-block.js';

const FILE_FORMAT = 'lzimul-world/2';
/** Refuse to parse a snapshot larger than this, so a corrupt file cannot OOM. */
const MAX_SNAPSHOT_BYTES = 128 * 1024 * 1024;

interface IStoredWorld {
  readonly format: string;
  readonly dimension: string;
  readonly updatedAt: string;
  readonly modifiedBlockCount: number;
  readonly blocks: readonly ISerializedBlock[];
}

function warn(message: string): void {
  console.error(`[lzimul-minecraft-mcp] ${message}`);
}

export class FileWorldStore implements IWorldStore {
  private readonly directory: string;
  private directoryReady = false;

  constructor(directory: string) {
    this.directory = directory;
  }

  private async ensureDirectory(): Promise<void> {
    if (!this.directoryReady) {
      await mkdir(this.directory, { recursive: true });
      this.directoryReady = true;
    }
  }

  private fileFor(type: EDimensionType): string {
    return path.join(this.directory, `${type}.json`);
  }

  async load(type: EDimensionType): Promise<readonly IPlacedBlock[]> {
    const file = this.fileFor(type);

    let raw: string;
    try {
      const info = await stat(file);
      if (info.size > MAX_SNAPSHOT_BYTES) {
        await this.quarantine(
          file,
          `snapshot is larger than ${MAX_SNAPSHOT_BYTES} bytes`
        );
        return [];
      }
      raw = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw new Error(
        `Cannot read world snapshot ${file}: ${toErrorMessage(error)}`,
        { cause: error }
      );
    }

    let parsed: IStoredWorld;
    try {
      parsed = JSON.parse(raw) as IStoredWorld;
    } catch {
      await this.quarantine(file, 'invalid JSON');
      return [];
    }

    if (!parsed || !Array.isArray(parsed.blocks)) {
      await this.quarantine(file, 'missing blocks array');
      return [];
    }

    if (parsed.blocks.length > WORLD_LIMITS.maxModifiedBlocks) {
      await this.quarantine(
        file,
        `${parsed.blocks.length} blocks exceed the limit of ${WORLD_LIMITS.maxModifiedBlocks}`
      );
      return [];
    }

    return parsed.blocks.flatMap(entry => {
      const block = fromSerialized(entry);
      if (block) {
        return [block];
      }
      warn(`Skipped malformed block entry in ${file}`);
      return [];
    });
  }

  async save(
    type: EDimensionType,
    blocks: readonly IPlacedBlock[]
  ): Promise<void> {
    if (blocks.length > WORLD_LIMITS.maxModifiedBlocks) {
      throw new RangeError(
        `World snapshot has ${blocks.length} blocks, above the limit of ${WORLD_LIMITS.maxModifiedBlocks}`
      );
    }

    const file = this.fileFor(type);
    try {
      await this.ensureDirectory();

      const sorted = blocks.toSorted(
        (a, b) => a.x - b.x || a.y - b.y || a.z - b.z
      );
      const payload: IStoredWorld = {
        format: FILE_FORMAT,
        dimension: `minecraft:${type}`,
        updatedAt: new Date().toISOString(),
        modifiedBlockCount: sorted.length,
        blocks: sorted.map(toSerialized)
      };

      // Write to a temporary file first so a crash mid-write cannot truncate the
      // previous snapshot, then rename atomically over the live file. Compact
      // JSON halves the bytes compared to pretty-printing.
      const temporary = `${file}.tmp`;
      await writeFile(temporary, `${JSON.stringify(payload)}\n`, 'utf8');
      await rename(temporary, file);
    } catch (error) {
      // The directory may have been removed after the first successful save.
      this.directoryReady = false;
      throw new Error(
        `Failed to write world snapshot ${file}: ${toErrorMessage(error)}`,
        { cause: error }
      );
    }
  }

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
