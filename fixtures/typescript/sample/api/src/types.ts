export interface Store {
  save(id: Id): void;
}

export type Id = string;
