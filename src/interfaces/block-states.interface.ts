/**
 * A block state is a set of Mojang block properties, for example
 * `{ facing: 'south', half: 'bottom' }` for `minecraft:oak_stairs`.
 */
export type BlockStates = Readonly<Record<string, string>>;
