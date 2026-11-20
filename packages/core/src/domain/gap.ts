export interface Fix {
  text: string;
  command: string[] | null;
  cwd: string;
  env: Record<string, string>;
  kind: "repository" | "outside";
}

export interface Gap {
  id: string;
  line: string;
  needs: string[];
  fix: Fix;
}

export interface GapRecord {
  id: string;
  line: string;
  needs: string[];
}
