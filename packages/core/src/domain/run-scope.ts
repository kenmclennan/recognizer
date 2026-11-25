export type RunScope =
  | { kind: "working-tree" }
  | { kind: "commit"; commit: string };
