import { InputError } from "./errors.js";
import type { ViewNote } from "./views.js";

export class NoteOrderError extends InputError {
  constructor(faults: string[]) {
    super(faults);
    this.name = "NoteOrderError";
  }
}

export type NotePlace = { after: string } | "first" | "last";

export function appendNote(notes: ViewNote[], entry: ViewNote): ViewNote[] {
  if (notes.some((note) => note.module === entry.module)) {
    return notes.map((note) => (note.module === entry.module ? entry : note));
  }

  return [...notes, entry];
}

export function placeNote(
  notes: ViewNote[],
  entry: ViewNote,
  where: NotePlace,
): ViewNote[] {
  const rest = notes.filter((note) => note.module !== entry.module);

  if (where === "first") {
    return [entry, ...rest];
  }

  if (where === "last") {
    return [...rest, entry];
  }

  const at = rest.findIndex((note) => note.module === where.after);

  if (at === -1) {
    throw new NoteOrderError([`no note on ${where.after} to place after`]);
  }

  return [...rest.slice(0, at + 1), entry, ...rest.slice(at + 1)];
}

export function moveNote(
  notes: ViewNote[],
  path: string,
  toIndex: number,
): ViewNote[] {
  const moving = notes.find((note) => note.module === path);

  if (moving === undefined) {
    return notes;
  }

  const rest = notes.filter((note) => note.module !== path);
  const index = Math.max(0, Math.min(toIndex, rest.length));

  return [...rest.slice(0, index), moving, ...rest.slice(index)];
}

export function reorderNotes(notes: ViewNote[], paths: string[]): ViewNote[] {
  const held = new Set(notes.map((note) => note.module));
  const seen = new Set<string>();
  const repeated: string[] = [];
  const unheld: string[] = [];

  for (const path of paths) {
    if (seen.has(path)) {
      if (!repeated.includes(path)) {
        repeated.push(path);
      }
    } else if (!held.has(path)) {
      unheld.push(path);
    }

    seen.add(path);
  }

  const missing = notes
    .map((note) => note.module)
    .filter((path) => !seen.has(path));
  const faults = [
    ...missing.map((path) => `${path} is missing from the order`),
    ...unheld.map((path) => `no note on ${path}`),
    ...repeated.map((path) => `${path} is repeated`),
  ];

  if (faults.length > 0) {
    throw new NoteOrderError(faults);
  }

  return paths.map(
    (path) => notes.find((note) => note.module === path) as ViewNote,
  );
}

export function numberOf(notes: ViewNote[], path: string): number | null {
  const at = notes.findIndex((note) => note.module === path);

  return at === -1 ? null : at + 1;
}

export function dropIndex(midpoints: readonly number[], y: number): number {
  const at = midpoints.findIndex((midpoint) => midpoint >= y);

  return at === -1 ? midpoints.length : at;
}
