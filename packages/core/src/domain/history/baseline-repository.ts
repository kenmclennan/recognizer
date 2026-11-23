export interface Identity {
  from: string;
  to: string;
  kind: string;
}

export interface IdEntry {
  id: string;
}

export type BaselineEntry = Identity | IdEntry;

export interface BaselineRepository {
  exists(path: string): boolean;
  read(path: string): BaselineEntry[];
  write(path: string, entries: BaselineEntry[]): void;
}
