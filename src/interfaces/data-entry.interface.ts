/** Common identity fields for every generated registry entry. */
export interface IDataEntry {
  readonly id: number;
  readonly key: string;
  readonly name: string;
  readonly displayName: string;
}
