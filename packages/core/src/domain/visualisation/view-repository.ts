import type { View } from "./view.js";

export type ViewRead =
  | { ok: true; view: View }
  | { ok: false; messages: string[] };

export interface ViewRepository {
  names(root: string): string[];
  exists(root: string, name: string): boolean;
  read(root: string, name: string): ViewRead;
  write(root: string, name: string, view: View): void;
  remove(root: string, name: string): void;
}
