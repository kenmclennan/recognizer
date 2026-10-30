import { execFileSync } from "node:child_process";
import { statSync, writeFileSync } from "node:fs";
import { ScanError } from "./errors.js";
import { scan } from "./scan.js";
import { render } from "./serialise.js";

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  writeFile: (path: string, text: string) => void;
}

export function nodeIo(): Io {
  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    writeFile: (path, text) => writeFileSync(path, text, "utf8"),
  };
}

interface Args {
  root: string;
  commit: string | null;
  modified: boolean | null;
  output: string | null;
}

const USAGE =
  "usage: recognizer-scan-typescript ROOT [--commit SHA] [--modified true|false] [--output FILE]";

function parseArgs(argv: string[]): Args | string {
  let root: string | null = null;
  let commit: string | null = null;
  let modified: boolean | null = null;
  let output: string | null = null;

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index] as string;

    if (
      argument === "--commit" ||
      argument === "--modified" ||
      argument === "--output"
    ) {
      const value = argv[++index];

      if (value === undefined) {
        return `${argument} needs a value`;
      }

      if (argument === "--commit") {
        commit = value;
      } else if (argument === "--modified") {
        if (value !== "true" && value !== "false") {
          return "--modified must be true or false";
        }

        modified = value === "true";
      } else {
        output = value;
      }
    } else if (argument.startsWith("--")) {
      return `unknown option: ${argument}`;
    } else if (root === null) {
      root = argument;
    } else {
      return `unexpected argument: ${argument}`;
    }
  }

  return root === null
    ? "ROOT is required"
    : { root, commit, modified, output };
}

export function resolveCommit(root: string): string | null {
  try {
    const sha = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    return sha === "" ? null : sha;
  } catch {
    return null;
  }
}

export function resolveModified(root: string): boolean | null {
  try {
    const status = execFileSync(
      "git",
      ["-C", root, "status", "--porcelain", "--", ".", ":!.recognizer"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );

    return status.trim() !== "";
  } catch {
    return null;
  }
}

export function run(argv: string[], io: Io = nodeIo()): number {
  const args = parseArgs(argv);

  if (typeof args === "string") {
    io.stderr(`${args}\n${USAGE}\n`);

    return 2;
  }

  if (!statSync(args.root, { throwIfNoEntry: false })?.isDirectory()) {
    io.stderr(`ROOT is not a directory: ${args.root}\n`);

    return 2;
  }

  try {
    const document = scan(
      args.root,
      args.commit ? args.commit : resolveCommit(args.root),
      args.modified ?? resolveModified(args.root),
    );
    const text = render(document);

    if (args.output) {
      io.writeFile(args.output, text);
    } else {
      io.stdout(text);
    }

    return 0;
  } catch (error) {
    if (error instanceof ScanError) {
      io.stderr(`could not scan:\n${error.problems.join("\n")}\n`);

      return 2;
    }

    throw error;
  }
}
