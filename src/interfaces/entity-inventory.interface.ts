/** A single non-empty item stack. */
export interface IItemStack {
  readonly item: string;
  readonly count: number;
}

/** The 9-slot hotbar plus the 27-slot backpack. */
export interface IEntityInventory {
  readonly hotbar: readonly (IItemStack | null)[];
  readonly inventory: readonly (IItemStack | null)[];
}
