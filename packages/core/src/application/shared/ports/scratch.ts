export interface Scratch {
  create(): string | null;
  remove(folder: string): void;
  sweepStale(maxAgeMs: number): void;
}
