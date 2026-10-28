# lZiMUl Minecraft MCP

Minecraft Model Context Protocol (MCP) server. It exposes the complete Minecraft registry (Java Edition data) as MCP resources and provides tools to read, write, query and fill blocks, inspect dimensions, create, move and delete entities and players, set their positions, and manage inventories in persisted, per-dimension worlds. Requires Node.js 22 or newer.

## Features

- All Minecraft blocks, items and entity types exposed as MCP resources with full properties (name, hardness, blast resistance, durability, enchantment categories, light level, collision box, entity dimensions, category, and more)
- Block lookup, placement, area queries and bounded fill tools backed by simulated dimensions (Overworld, The Nether, The End), each with its own isolated world state and height range
- Block states are supported everywhere: `minecraft:oak_stairs[facing=south,half=bottom]`
- Dimension tools for metadata, paginated block access, entity listings and raw JSON snapshots
- Entity and player tools with deletion, movement, exact position control, and a 9-slot hotbar plus 27-slot backpack per entity, managed through `getInventory`, `setInventory`, `clearInventory` and `swapInventorySlots`
- World state (blocks, entities, players and inventories) is persisted per dimension as JSON and survives restarts
- log4js logging to stderr with chalk colours (error red, warn yellow, info green); stdout stays clean for the MCP transport
- Structured tool output (`outputSchema` / `structuredContent`) plus human readable text
- Every failure path returns a readable message instead of an unhandled exception
- Tool annotations for safe client automation

## Protocol

The server implements the MCP `2026-07-28` revision. Modern clients open a session with `server/discover` and carry the per-request envelope in every request's `params._meta` (`io.modelcontextprotocol/protocolVersion`, `io.modelcontextprotocol/clientCapabilities`, and optionally `io.modelcontextprotocol/clientInfo`). Responses use the modern result shape (`resultType`, server identity under `_meta['io.modelcontextprotocol/serverInfo']`). The legacy `initialize` handshake is rejected with error `-32022`; clients must use `server/discover` or send the per-request envelope.

## Tools

| Tool                   | Description                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| `getBlock`             | Get the block (and its states) at coordinates in a dimension (defaults to `overworld`)    |
| `setBlock`             | Place a block with optional states in a dimension and return the replaced block           |
| `getDimension`         | Get dimension metadata, block count, entity count and player count                        |
| `getDimensionBlocks`   | Page through every placed (non-air) block in a dimension, sorted by coordinates           |
| `getBlocksInArea`      | Page through placed blocks inside a box, with an optional block and states filter         |
| `fillBlocks`           | Fill a box with one block, optionally replacing existing blocks; air clears the box       |
| `getDimensionEntities` | List every entity and player in a dimension with type, name and position                  |
| `getDimensionRawFile`  | Return the raw dimension JSON snapshot, including `blocks` and `entities`                 |
| `getItem`              | Look up item properties by id (`minecraft:diamond_sword` or `diamond_sword`)              |
| `createEntity`         | Create a non-player entity with an empty hotbar and backpack                              |
| `getEntity`            | Get an entity by UUID, including position, dimension and full inventory                   |
| `deleteEntity`         | Delete an entity or player by UUID or player name and discard its inventory               |
| `moveEntity`           | Move an entity one block forward, back, left, right, up or down                           |
| `getEntityPosition`    | Get an entity UUID, type, name and exact `x`/`y`/`z` position                             |
| `setEntityPosition`    | Set an entity UUID to an exact `x`/`y`/`z` position                                       |
| `createPlayer`         | Create a uniquely named player with an empty hotbar and backpack                          |
| `getPlayer`            | Get a player by name (case-insensitive), including position, dimension and full inventory |
| `getInventory`         | Read the 9 hotbar slots and 27 backpack slots of an entity or player                      |
| `clearInventory`       | Remove every item from an entity or player inventory                                      |
| `swapInventorySlots`   | Swap any two hotbar or backpack slots of an entity or player                              |
| `setInventory`         | Set or clear one hotbar/backpack slot of an entity or player                              |

`setBlock` accepts both the full form (`minecraft:oak_stairs[facing=south,half=bottom]`) and the short form (`oak_stairs[facing=south]`). Setting `minecraft:air` removes the block; air cannot carry states.

`getDimensionBlocks` is paginated because a dimension can hold up to 250,000 placed blocks. `limit` defaults to 1,000 and is capped at 10,000; `offset` skips rows. Rows are sorted by `x`, `y`, `z` and include the block id, display name and states.

`getBlocksInArea` reads an inclusive box in one dimension. Its corners may be supplied in any order, and the optional `blockType` filter matches the block id; when states are included, the stored state map must match exactly. The same `limit`/`offset` pagination applies.

`fillBlocks` writes one block type into an inclusive box. By default it fills only air; set `overwrite` to `true` to replace existing blocks. Use `minecraft:air` with `overwrite` to clear a region. A single request is limited to 16,384 coordinates, and the result reports changed, placed, removed and skipped counts.

`getDimensionEntities` lists entity and player summaries, sorted by UUID; use `getEntity` or `getInventory` when you need the full inventory of one record. The former `getDimensionEntitys` spelling is no longer registered. `getDimensionRawFile` returns the same raw JSON format that is written to disk, so the result can be loaded directly by `app/minecraft_world_viewer.html`.

### Entities, players and inventories

- Entity type ids come from the generated registry (`lzimul://minecraft/entities`), for example `minecraft:zombie` or `zombie`. `createEntity` rejects `minecraft:player`; use `createPlayer` for players.
- Players are addressed by name, case-insensitively, and names are unique across all dimensions. Entity and player UUIDs come from the creation response.
- Every entity and player has a 9-slot hotbar plus a 27-slot backpack (36 slots total). Slots are zero-based within their section.
- `getInventory`, `setInventory`, `clearInventory`, `swapInventorySlots` and `deleteEntity` accept either an entity UUID or a player name. `setInventory` requires `section` (`hotbar` or `inventory`, default `inventory`), `slot`, `item` and `count`; `swapInventorySlots` requires two section/slot pairs.
- `count` must not exceed the item's stack size. Set the item to `minecraft:air` or the count to `0` to clear a slot. Empty slots are returned as `null`. `clearInventory` removes all 36 slots at once.
- `deleteEntity` removes the entity or player and its inventory from its dimension. Deleting a player frees the name for reuse.
- `moveEntity` moves exactly one block and takes only an entity UUID and a direction: `forward` (`+Z`, south), `back` (`-Z`, north), `left` (`-X`, west), `right` (`+X`, east), `up` (`+Y`) or `down` (`-Y`). The destination must remain inside the entity's dimension.
- `getEntityPosition` returns the entity UUID, type, name and `x`/`y`/`z`; `setEntityPosition` takes an entity UUID plus a nested `{ "x": ..., "y": ..., "z": ... }` position.
- A dimension holds at most 10,000 entities and players combined. Entity names are limited to 64 characters and player names to 32 characters (`A-Z`, `a-z`, `0-9`, `_`).

## Persistence

World snapshots are stored as one JSON document per dimension, so the dimensions never share a file:

```text
app/dimensions/
  overworld.json
  the_nether.json
  the_end.json
```

Each snapshot looks like this:

```json
{
  "format": "lzimul:minecraft/dimension",
  "dimension": "minecraft:overworld",
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "modifiedBlockCount": 1,
  "entityCount": 1,
  "blocks": [
    {
      "x": 0,
      "y": 64,
      "z": 0,
      "block": "minecraft:oak_stairs",
      "states": { "facing": "south", "half": "bottom" }
    }
  ],
  "entities": [
    {
      "id": "0f0f2f4e-7d5a-4d8e-9a3b-2f6c1d8e4a10",
      "kind": "player",
      "type": "minecraft:player",
      "name": "Steve",
      "x": 1,
      "y": 64,
      "z": 0,
      "createdAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

- The whole dimension (blocks, entities and players) is loaded once at startup and kept in memory; mutations are written back debounced and atomically (temporary file + rename).
- `setBlock`, `fillBlocks`, `createEntity`, `deleteEntity`, `createPlayer`, `setInventory`, `clearInventory`, `swapInventorySlots`, `moveEntity` and `setEntityPosition` await the write, so a successful response means the change is durably stored. If persisting fails the tool returns an error instead of pretending success.
- Parallel tool calls share a single in-flight snapshot write instead of writing one full file per call, so building with many simultaneous `setBlock` calls stays fast.
- Unmodified coordinates are air; only placed blocks are stored. Placing air removes the coordinate from the snapshot.
- Empty state maps are omitted from the file to keep snapshots small.
- Entity and player inventories are omitted when they are completely empty. When present, `inventory.hotbar` has 9 entries and `inventory.inventory` has 27 entries; each entry is `{ "item": "minecraft:diamond_sword", "count": 1 }` or `null`.
- Player names are not stored in a separate index: the player name index is rebuilt from the snapshots when the world loads. If two dimension files contain the same case-insensitive name, the first dimension wins and the duplicate player is dropped with a warning.
- Snapshots are written as compact JSON (about half the bytes of pretty-printed JSON) with a trailing newline.
- Files written by format v1 (`lzimul-world/1`, no states) and v2 (`lzimul-world/2`, no entities) still load; new files use `lzimul:minecraft/dimension` and include an `entities` array. A missing `entities` array simply means the dimension has no entities.
- Malformed block or entity entries are skipped without discarding the rest of the dimension. An entity's dimension always comes from the file it was loaded from, so an entry cannot claim to live in another dimension.
- A dimension file is created on its first write; untouched dimensions stay empty.

### Configuration

| Variable            | Default        | Description                                             |
| ------------------- | -------------- | ------------------------------------------------------- |
| `MCP_WORLD_STORAGE` | `file`         | `file` for JSON snapshots, `memory` for volatile state  |
| `MCP_WORLD_DIR`     | `./app/dimensions` | Directory that holds the per-dimension snapshots    |
| `MCP_LOG_LEVEL`     | `info`         | log4js level: `trace`, `debug`, `info`, `warn`, `error` |

A corrupt or oversized snapshot is moved aside as `<dimension>.json.corrupt-<uuid>` and the dimension starts empty, so a bad file never blocks startup.

### Logging

Server logs use [log4js](https://log4js-node.github.io/log4js-node/) with a chalk-based layout. `error`/`fatal` are red, `warn` yellow, `info` green, `debug` cyan and `trace` blue. Chalk disables ANSI colours automatically when the output is redirected to a non-colour terminal.

Logs are written to **stderr**, never stdout: stdout is the MCP JSON-RPC transport, so mixing log lines into it would corrupt the protocol stream. `MCP_LOG_LEVEL` controls the verbosity (default `info`). Developer scripts use a small stdout logger (`scripts/logger.mjs`) with the same colours, so test output stays readable.

### Storage backends

State is accessed through `IWorldStore` (`src/interfaces/world-store.interface.ts`):

| Backend            | Used by             | Notes                                                 |
| ------------------ | ------------------- | ----------------------------------------------------- |
| `FileWorldStore`   | stdio (`npm start`) | Atomic per-dimension JSON files under `MCP_WORLD_DIR` |
| `MemoryWorldStore` | tests, `memory`     | Volatile; useful for throwaway sessions               |

## Resources

| URI                                    | Description                                          |
| -------------------------------------- | ---------------------------------------------------- |
| `lzimul://minecraft/blocks`            | Block index                                          |
| `lzimul://minecraft/blocks/{name}`     | Single block properties                              |
| `lzimul://minecraft/items`             | Item index                                           |
| `lzimul://minecraft/items/{name}`      | Single item properties                               |
| `lzimul://minecraft/entities`          | Entity type index (157 types, including `player`)    |
| `lzimul://minecraft/entities/{name}`   | Single entity type properties                        |
| `lzimul://minecraft/dimensions`        | Dimension index with block, entity and player counts |
| `lzimul://minecraft/dimensions/{type}` | Single dimension state including blocks and entities |

Placed blocks in the dimension resources include a `states` object. If a resource read fails, the server returns a JSON document with an `error` field instead of dropping the request. The dimensions index stays small on purpose: it reports per-dimension metadata, `modifiedBlockCount`, `entityCount` and `playerCount`, while `lzimul://minecraft/dimensions/{type}` returns the placed blocks plus the full entity/player list. In total the server registers 2,838 resources: every block, item and entity type, the indexes, and the seven dimension-related resources.

## Security

- Tool input is validated with Zod: coordinates are bounded, dimensions come from an enum, and ids are limited in length.
- Block and item ids are resolved against the generated registries; unknown blocks, items and entity types and unknown namespaces are rejected.
- State names and values are restricted to `[a-z0-9_]` / `[a-z0-9_.-]`, 64 characters each, and reserved keys (`__proto__`, `constructor`, `prototype`) are rejected to rule out prototype pollution.
- Inventory input is validated too: the section and slot must be in range, the item must exist, and the count must fit the item's stack size. `minecraft:air` or count `0` clears a slot.
- Each dimension holds at most 250,000 modified blocks and 10,000 entities/players. Entity names are capped at 64 characters, player names at 32 characters, and player names are case-insensitively unique across all dimensions. The file store refuses to load or write a snapshot over 128 MiB, so an oversized world fails the tool call instead of producing a file that would be quarantined on restart.
- Snapshot writes are atomic, corrupt files are quarantined with a UUID suffix, and malformed block or entity entries are skipped while the rest of the world loads. Entity dimensions are taken from the snapshot file rather than trusted from the entry.
- Run `npm audit` after dependency changes. The dependency tree currently reports no vulnerabilities; the `katex` override keeps the markdown lint toolchain patched.

## Performance

Measured on Node.js 26 (results vary by hardware):

- Startup, including registry import and 2,838 resource registrations: about 0.4 s.
- 300 concurrent `setBlock` tool calls: about 70 ms end-to-end, because parallel flushes share in-flight snapshot writes instead of writing the file 300 times.
- 20,000 persisted blocks: about 1.1 MiB of compact JSON, ~25 ms to save and ~24 ms to load.
- In-memory block, entity and inventory reads/writes are O(1) map operations; only the debounced snapshot write is proportional to the number of modified blocks and entities.
- `getDimensionBlocks` pages a cached, coordinate-sorted block array instead of re-sorting the world on every call.

## Project Structure

```text
src/
  index.ts        Entry point
  app/            Server assembly
  config/         Server metadata, dimensions, storage, world limits
  data/           Generated registry data (blocks, items, entities, version)
  enums/          Enumerations (EBoundingBox, EIconTheme, EDimensionType, EEntityKind, EInventorySection, EMoveDirection)
  interfaces/     Interfaces (IBlock, IItem, IEntityType, IEntity, IEntityInventory, IDimension, IPlacedBlock, IWorldSnapshot, IWorldStore)
  resources/      Block, item, entity and dimension resource registration
  schemas/        Zod schemas and converters (blocks, entities, inventories)
  tools/          Block, dimension, entity, player and inventory tools
  utils/          Shared helpers (error messages, log4js + chalk logger)
  world/          Simulated dimension state, entity inventory and item specs
    stores/       IWorldStore implementations (file, memory) and serializers
scripts/
  logger.mjs               Coloured stdout logger for developer scripts
  generate-data.mjs        Regenerates src/data from minecraft-data
  smoke-test.mjs           End-to-end smoke test (blocks, dimensions, entities, inventories)
  persistence-test.mjs     Restart test for blocks, entities and inventories
  error-test.mjs           Error fallbacks, sanitizing and storage limit tests
  stress-test.mjs          Parallel write, coalescing and restart stress test
  clean.mjs                Removes build output
```

## Scripts

| Command                 | Description                                           |
| ----------------------- | ----------------------------------------------------- |
| `npm run build`         | Lint, compile and generate docs                       |
| `npm run dev`           | Build then start the server                           |
| `npm start`             | Start the server (stdio)                              |
| `npm test`              | Run the smoke, persistence, security and stress tests |
| `npm run test:stress`   | Run only the parallel write stress test               |
| `npm run generate-data` | Regenerate registry data (see below)                  |
| `npm run clean`         | Remove build output                                   |
| `npm run lint`          | Lint without modifying files                          |
| `npm run lint:fix`      | Lint and auto-fix                                     |

## Data

Registry data is generated from [PrismarineJS/minecraft-data](https://github.com/PrismarineJS/minecraft-data). To regenerate for a specific version:

```bash
node scripts/generate-data.mjs <version> [blocks.json] [items.json] [entities.json]
```

When local JSON files are provided they are used directly, otherwise the data is fetched from GitHub. The fourth argument is optional and only needed for a custom entity registry; without it the entity list is fetched from the same minecraft-data release. The data version is exported as `MINECRAFT_DATA_VERSION` and used in all descriptions.

## License

MIT
