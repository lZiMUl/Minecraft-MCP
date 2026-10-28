import type { McpServer } from '@modelcontextprotocol/server';

import { errorResource } from './error-content.js';

import type { IDataEntry } from '../interfaces/data-entry.interface.js';

/**
 * Serialize a registry entry once and reuse the string for every read. The
 * generated registry is immutable, so caching is safe and keeps resource reads
 * cheap even for large indexes.
 */
function lazyJsonText(build: () => unknown): () => string {
  let cached = '';
  return () => {
    if (!cached) {
      cached = JSON.stringify(build(), null, 2);
    }
    return cached;
  };
}

/** Register a compact index resource for a generated registry. */
export function registerDataIndexResource<T extends IDataEntry>(
  server: McpServer,
  config: {
    name: string;
    uri: string;
    title: string;
    description: string;
    entries: readonly T[];
  }
): void {
  const getText = lazyJsonText(() =>
    config.entries.map(entry => ({
      id: entry.id,
      key: entry.key,
      name: entry.name,
      displayName: entry.displayName
    }))
  );
  server.registerResource(
    config.name,
    config.uri,
    {
      title: config.title,
      description: config.description,
      mimeType: 'application/json'
    },
    async uri => {
      try {
        return {
          contents: [
            { uri: uri.href, mimeType: 'application/json', text: getText() }
          ]
        };
      } catch (error) {
        return errorResource(uri.href, error);
      }
    }
  );
}

/** Register one `lzimul://minecraft/<prefix>/<name>` resource per entry. */
export function registerDataEntryResources<T extends IDataEntry>(
  server: McpServer,
  config: {
    pathPrefix: string;
    category: string;
    entries: readonly T[];
  }
): void {
  for (const entry of config.entries) {
    const getText = lazyJsonText(() => entry);
    server.registerResource(
      `minecraft/${config.pathPrefix}/${entry.name}`,
      `lzimul://minecraft/${config.pathPrefix}/${entry.name}`,
      {
        title: `${entry.displayName} (${entry.key})`,
        description: `Properties of the Minecraft ${config.category} ${entry.key}`,
        mimeType: 'application/json'
      },
      async uri => {
        try {
          return {
            contents: [
              { uri: uri.href, mimeType: 'application/json', text: getText() }
            ]
          };
        } catch (error) {
          return errorResource(uri.href, error);
        }
      }
    );
  }
}
