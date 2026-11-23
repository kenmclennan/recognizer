export type SelectionFileRead =
  | { ok: true; text: string }
  | { ok: false; reason: string };

export interface SelectionFiles {
  read(file: string): SelectionFileRead;
  absolute(file: string): string;
}
