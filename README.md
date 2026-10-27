# lZiMUl Minecraft MCP

Minecraft Model Context Protocol (MCP) server. It exposes the complete Minecraft registry (Java Edition data) as MCP resources and provides tools to read and write blocks in persisted, per-dimension worlds. Requires Node.js 22 or newer.

## Features

- All Minecraft blocks and items exposed as MCP resources with full properties (name, hardness, blast resistance, durability, enchantment categories, light level, collision box, and more)
- Block lookup and placement tools backed by simulated dimensions (Overworld, The Nether, The End), each with its own isolated world state and height range
- Block states are supported everywhere: `minecraft:oak_stairs[facing=south,half=bottom]`
- World state is persisted per dimension as JSON and survives restarts
- Structured tool output (`outputSchema` / `structuredContent`) plus human readable text
- Every failure path returns a readable message instead of an unhandled exception
- Tool annotations for safe client automation

## Protocol

This server implements **MCP 2026-07-28 only**. The legacy 2025-era `initialize` handshake is rejected, so clients must use the modern protocol:

- Start a session with `server/discover`, or send any request carrying the per-request envelope.
- Every request must include the envelope in `params._meta`:
  - `io.modelcontextprotocol/protocolVersion`: `"2026-07-28"`
  - `io.modelcontextprotocol/clientCapabilities`
  - `io.modelcontextprotocol/clientInfo` (optional)
- Responses use the modern result shape (`resultType`, server identity under `_meta['io.modelcontextprotocol/serverInfo']`).
- A legacy `initialize` is answered with `UnsupportedProtocolVersionError` naming the supported modern revision.

When testing with MCP Inspector 2.12 or newer, set **Protocol Era** to `modern` (or `auto`) for this server. The Inspector's default `legacy` mode sends `initialize`, which this server intentionally rejects.

### supergateway

This package stays stdio-only. A separate gateway such as [supergateway](https://github.com/supercorp-ai/supergateway) can expose it over HTTP. Modern traffic needs **supergateway 4.0.0 or newer** (verified with 4.2.1) and the Streamable HTTP output transport:

```bash
npx -y supergateway@4.2.1 \
  --stdio "node ./build/index.js" \
  --outputTransport streamableHttp \
  --host 127.0.0.1 \
  --port 8001 \
  --streamableHttpPath /minecraft-mcp
```

Older 3.x releases bundle the legacy MCP SDK and answer modern clients with `Bad Request: Unsupported protocol version (supported versions: 2025-06-18, ...)`. The `sse` output transport also does not carry 2026-07-28; use `streamableHttp`.

The `protocolVersion: 2024-11-05` line in supergateway's startup log is only the fallback used when a request has no `MCP-Protocol-Version`; clients that negotiate 2026-07-28 still get the modern flow.

On Windows, if the project path contains spaces, point `--stdio` at a small wrapper so the command is not split:

```bat
@echo off
"C:\Program Files\nodejs\node.exe" "C:\path\to\build\index.js" %*
```

Then verify the full chain:

```bash
npx @modelcontextprotocol/inspector --cli \
  --server-url http://127.0.0.1:8001/minecraft-mcp \
  --transport http \
  --protocol-era modern \
  --method tools/list
```

## Tools

| Tool       | Description                                                                            |
| ---------- | -------------------------------------------------------------------------------------- |
| `getBlock` | Get the block (and its states) at coordinates in a dimension (defaults to `overworld`) |
| `setBlock` | Place a block with optional states in a dimension and return the replaced block        |
| `getItem`  | Look up item properties by id (`minecraft:diamond_sword` or `diamond_sword`)           |

`setBlock` accepts both the full form (`minecraft:oak_stairs[facing=south,half=bottom]`) and the short form (`oak_stairs[facing=south]`). Setting `minecraft:air` removes the block; air cannot carry states.

## Persistence

World snapshots are stored as one JSON document per dimension, so the dimensions never share a file:

```text
world-data/
  overworld.json
  the_nether.json
  the_end.json
```

Each snapshot looks like this:

```json
{
  "format": "lzimul-world/2",
  "dimension": "minecraft:overworld",
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "modifiedBlockCount": 1,
  "blocks": [
    {
      "x": 0,
      "y": 64,
      "z": 0,
      "block": "minecraft:oak_stairs",
      "states": { "facing": "south", "half": "bottom" }
    }
  ]
}
```

- The whole dimension is loaded once at startup and kept in memory; mutations are written back debounced and atomically (temporary file + rename).
- `setBlock` awaits the write, so a successful response means the block is durably stored. If persisting fails the tool returns an error instead of pretending success.
- Parallel tool calls share a single in-flight snapshot write instead of writing one full file per call, so building with many simultaneous `setBlock` calls stays fast.
- Unmodified coordinates are air; only placed blocks are stored. Placing air removes the coordinate from the snapshot.
- Empty state maps are omitted from the file to keep snapshots small.
- Snapshots are written as compact JSON (about half the bytes of pretty-printed JSON) with a trailing newline.
- Files written by format v1 (`lzimul-world/1`, no states) still load; new files use `lzimul-world/2`.
- A dimension file is created on its first write; untouched dimensions stay empty.

### Configuration

| Variable            | Default        | Description                                            |
| ------------------- | -------------- | ------------------------------------------------------ |
| `MCP_WORLD_STORAGE` | `file`         | `file` for JSON snapshots, `memory` for volatile state |
| `MCP_WORLD_DIR`     | `./world-data` | Directory that holds the per-dimension snapshots       |

A corrupt or oversized snapshot is moved aside as `<dimension>.json.corrupt-<uuid>` and the dimension starts empty, so a bad file never blocks startup.

### Storage backends

State is accessed through `IWorldStore` (`src/interfaces/world-store.interface.ts`):

| Backend            | Used by             | Notes                                                 |
| ------------------ | ------------------- | ----------------------------------------------------- |
| `FileWorldStore`   | stdio (`npm start`) | Atomic per-dimension JSON files under `MCP_WORLD_DIR` |
| `MemoryWorldStore` | tests, `memory`     | Volatile; useful for throwaway sessions               |

## Resources

| URI                                    | Description                                    |
| -------------------------------------- | ---------------------------------------------- |
| `lzimul://minecraft/blocks`            | Block index                                    |
| `lzimul://minecraft/blocks/{name}`     | Single block properties                        |
| `lzimul://minecraft/items`             | Item index                                     |
| `lzimul://minecraft/items/{name}`      | Single item properties                         |
| `lzimul://minecraft/dimensions`        | Persisted dimension index with world state     |
| `lzimul://minecraft/dimensions/{type}` | Single dimension state including placed blocks |

Placed blocks in the dimension resources include a `states` object. If a resource read fails, the server returns a JSON document with an `error` field instead of dropping the request.

## Security

- Tool input is validated with Zod: coordinates are bounded, dimensions come from an enum, and ids are limited in length.
- Block ids are resolved against the generated registry; unknown blocks and namespaces are rejected.
- State names and values are restricted to `[a-z0-9_]` / `[a-z0-9_.-]`, 64 characters each, and reserved keys (`__proto__`, `constructor`, `prototype`) are rejected to rule out prototype pollution.
- Each dimension holds at most 250,000 modified blocks, and the file store refuses snapshots over 128 MiB.
- Snapshot writes are atomic, corrupt files are quarantined with a UUID suffix, and malformed blocks are skipped while the rest of the world loads.
- Run `npm audit` after dependency changes. The dependency tree currently reports no vulnerabilities; the `katex` override keeps the markdown lint toolchain patched.

## Performance

Measured on Node.js 26 (results vary by hardware):

- Startup, including registry import and 2,686 resource registrations: about 0.4 s.
- 300 concurrent `setBlock` tool calls: about 70 ms end-to-end, because parallel flushes share in-flight snapshot writes instead of writing the file 300 times.
- 20,000 persisted blocks: about 1.1 MiB of compact JSON, ~25 ms to save and ~24 ms to load.
- In-memory reads and writes are O(1) map operations; only the debounced snapshot write is proportional to the number of modified blocks.

## Project Structure

```text
src/
  index.ts        Entry point
  app/            Server assembly
  config/         Server metadata, dimensions, storage, world limits
  data/           Generated registry data (blocks, items, version)
  enums/          Enumerations (EBoundingBox, EIconTheme, EDimensionType)
  interfaces/     Interfaces (IBlock, IItem, IDimension, IPlacedBlock, IDataEntry, IWorldStore)
  resources/      Resource registration and error fallbacks
  schemas/        Zod schemas and converters
  tools/          Tool registration and error handling
  utils/          Shared helpers (error messages)
  world/          Simulated dimension world state
    stores/       IWorldStore implementations (file, memory)
scripts/
  generate-data.mjs        Regenerates src/data from minecraft-data
  smoke-test.mjs           End-to-end smoke test (including states)
  protocol-test.mjs        Modern-only protocol era and envelope enforcement
  persistence-test.mjs     Restart test for the world snapshots
  error-test.mjs           Error fallbacks, sanitizing and storage limit tests
  stress-test.mjs          Parallel write, coalescing and restart stress test
  clean.mjs                Removes build output
```

## Scripts

| Command                 | Description                                                     |
| ----------------------- | --------------------------------------------------------------- |
| `npm run build`         | Lint, compile and generate docs                                 |
| `npm run dev`           | Build then start the server                                     |
| `npm start`             | Start the server (stdio)                                        |
| `npm test`              | Run the smoke, protocol, persistence, security and stress tests |
| `npm run test:stress`   | Run only the parallel write stress test                         |
| `npm run generate-data` | Regenerate registry data (see below)                            |
| `npm run clean`         | Remove build output                                             |
| `npm run lint`          | Lint and auto-fix                                               |

## Data

Registry data is generated from [PrismarineJS/minecraft-data](https://github.com/PrismarineJS/minecraft-data). To regenerate for a specific version:

```bash
node scripts/generate-data.mjs <version> [blocks.json] [items.json]
```

When local JSON files are provided they are used directly, otherwise the data is fetched from GitHub. The data version is exported as `MINECRAFT_DATA_VERSION` and used in all descriptions.

## License

MIT
