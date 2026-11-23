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

export const NO_COMMIT_FIX =
  "make the first commit (git add the files, then git commit)";

export function outside(text: string, cwd = ""): Fix {
  return { text, command: null, cwd, env: {}, kind: "outside" };
}

export function installFix(
  install: Record<string, string> | undefined,
  program: string,
): Fix {
  return outside(install?.[program] ?? `install ${program}`);
}
