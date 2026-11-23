export interface DuplicationSettings {
  threshold: number;
  min_lines: number;
  pair_min_lines: number;
  min_nodes: number;
}

export const DEFAULT_DUPLICATION_SETTINGS: DuplicationSettings = {
  threshold: 0.82,
  min_lines: 4,
  pair_min_lines: 6,
  min_nodes: 20,
};
