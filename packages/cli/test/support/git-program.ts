import { createHash } from "node:crypto";
import type { FakeFiles } from "./io/files.js";
import type { Program } from "./io/processes.js";

const IGNORED = [".recognizer/cache/", "node_modules/", ".git/"];
const RENAME_THRESHOLD = 0.5;

type Tree = Map<string, Buffer>;

interface Commit {
  sha: string;
  parents: string[];
  tree: Tree;
}

interface Repository {
  commits: Map<string, Commit>;
  branches: Map<string, string>;
  current: string;
}

interface Change {
  status: "A" | "M" | "D" | "R";
  path: string;
  from?: string;
}

function ignored(path: string): boolean {
  return IGNORED.some((prefix) => path.startsWith(prefix));
}

function listed(files: FakeFiles, root: string): Tree {
  const found: Tree = new Map();
  const walk = (directory: string, prefix: string) => {
    for (const entry of files.readDir(directory)) {
      const relative = `${prefix}${entry.name}`;

      if (entry.kind === "directory") {
        if (!ignored(`${relative}/`)) {
          walk(`${directory}/${entry.name}`, `${relative}/`);
        }
      } else if (!ignored(relative)) {
        found.set(relative, files.readBytes(`${directory}/${entry.name}`));
      }
    }
  };

  walk(root, "");

  return found;
}

function lineSizes(bytes: Buffer): Map<string, number> {
  const sizes = new Map<string, number>();

  for (const line of bytes.toString("latin1").split(/(?<=\n)/)) {
    sizes.set(line, (sizes.get(line) ?? 0) + line.length);
  }

  return sizes;
}

function similarity(before: Buffer, after: Buffer): number {
  const largest = Math.max(before.length, after.length);

  if (largest === 0) {
    return 1;
  }

  if (before.equals(after)) {
    return 1;
  }

  const left = lineSizes(before);
  let shared = 0;

  for (const [line, size] of lineSizes(after)) {
    shared += Math.min(size, left.get(line) ?? 0);
  }

  return shared / largest;
}

function changesBetween(before: Tree, after: Tree): Change[] {
  const changes: Change[] = [];
  const added: string[] = [];
  const deleted: string[] = [];

  for (const [path, bytes] of after) {
    const old = before.get(path);

    if (old === undefined) {
      added.push(path);
    } else if (!old.equals(bytes)) {
      changes.push({ status: "M", path });
    }
  }

  for (const path of before.keys()) {
    if (!after.has(path)) {
      deleted.push(path);
    }
  }

  const pairs = deleted
    .flatMap((from) =>
      added.map((path) => ({
        from,
        path,
        score: similarity(
          before.get(from) as Buffer,
          after.get(path) as Buffer,
        ),
      })),
    )
    .filter((pair) => pair.score >= RENAME_THRESHOLD)
    .sort((a, b) => b.score - a.score);
  const moved = new Set<string>();
  const taken = new Set<string>();

  for (const pair of pairs) {
    if (!moved.has(pair.from) && !taken.has(pair.path)) {
      moved.add(pair.from);
      taken.add(pair.path);
      changes.push({ status: "R", path: pair.path, from: pair.from });
    }
  }

  for (const path of added) {
    if (!taken.has(path)) {
      changes.push({ status: "A", path });
    }
  }

  for (const path of deleted) {
    if (!moved.has(path)) {
      changes.push({ status: "D", path });
    }
  }

  return changes.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
}

function nameStatusText(changes: Change[]): string {
  return changes
    .map((change) =>
      change.status === "R"
        ? `R100\0${change.from}\0${change.path}\0`
        : `${change.status}\0${change.path}\0`,
    )
    .join("");
}

function ancestors(repository: Repository, sha: string): Set<string> {
  const seen = new Set<string>();
  const pending = [sha];

  while (pending.length > 0) {
    const next = pending.pop() as string;

    if (!seen.has(next)) {
      seen.add(next);
      pending.push(...(repository.commits.get(next)?.parents ?? []));
    }
  }

  return seen;
}

function mergeBaseOf(repository: Repository, a: string, b: string) {
  const left = ancestors(repository, a);
  const right = ancestors(repository, b);
  const common = [...left].filter((sha) => right.has(sha));
  const best = common.find(
    (sha) =>
      !common.some(
        (other) => other !== sha && ancestors(repository, other).has(sha),
      ),
  );

  return best ?? null;
}

export const archiveTarProgram: Program = (call) => {
  const target = call.args[call.args.indexOf("-C") + 1];
  const tarball = call.args[call.args.indexOf("-f") + 1];

  if (target === undefined || tarball === undefined) {
    return { started: true, status: 2, stdout: "", stderr: "" };
  }

  const entries = JSON.parse(call.files.readFile(tarball)) as Record<
    string,
    string
  >;

  for (const [path, encoded] of Object.entries(entries)) {
    call.files.writeBytes(`${target}/${path}`, Buffer.from(encoded, "base64"));
  }

  return { started: true, status: 0, stdout: "", stderr: "" };
};

export class FakeRepositories {
  private readonly repositories = new Map<string, Repository>();

  constructor(private readonly files: FakeFiles) {}

  commitAll(root: string, message = "commit"): string {
    const repository = this.repositories.get(root) ?? {
      commits: new Map<string, Commit>(),
      branches: new Map<string, string>(),
      current: "main",
    };
    const parent = repository.branches.get(repository.current);
    const sha = createHash("sha1")
      .update(`${root}:${message}:${repository.commits.size}`)
      .digest("hex");

    repository.commits.set(sha, {
      sha,
      parents: parent === undefined ? [] : [parent],
      tree: listed(this.files, root),
    });
    repository.branches.set(repository.current, sha);
    this.repositories.set(root, repository);

    return sha;
  }

  checkout(root: string, branch: string, at?: string): void {
    const repository = this.repositories.get(root);

    if (repository === undefined) {
      throw new Error(`no repository at ${root}`);
    }

    const target = at ?? repository.branches.get(branch);

    if (target === undefined) {
      throw new Error(`no branch ${branch}`);
    }

    const resolved = this.resolve(repository, target);

    if (resolved === null) {
      throw new Error(`no commit ${target}`);
    }

    repository.branches.set(branch, resolved);
    repository.current = branch;

    const tree = (repository.commits.get(resolved) as Commit).tree;

    for (const path of listed(this.files, root).keys()) {
      if (!tree.has(path)) {
        this.files.remove(`${root}/${path}`);
      }
    }

    for (const [path, bytes] of tree) {
      this.files.writeBytes(`${root}/${path}`, bytes);
    }
  }

  private head(repository: Repository): Commit | undefined {
    const sha = repository.branches.get(repository.current);

    return sha === undefined ? undefined : repository.commits.get(sha);
  }

  private resolve(repository: Repository, ref: string): string | null {
    if (ref === "HEAD") {
      return this.head(repository)?.sha ?? null;
    }

    const branch = repository.branches.get(ref);

    if (branch !== undefined) {
      return branch;
    }

    if (/^[0-9a-f]{7,40}$/.test(ref)) {
      const matches = [...repository.commits.keys()].filter((sha) =>
        sha.startsWith(ref),
      );

      return matches.length === 1 ? (matches[0] as string) : null;
    }

    return null;
  }

  private status(root: string, repository: Repository): string[] {
    const known = this.head(repository)?.tree ?? new Map<string, Buffer>();
    const now = listed(this.files, root);
    const lines: string[] = [];

    for (const [path, bytes] of now) {
      const old = known.get(path);

      if (old === undefined) {
        lines.push(`?? ${path}`);
      } else if (!old.equals(bytes)) {
        lines.push(` M ${path}`);
      }
    }

    for (const path of known.keys()) {
      if (!now.has(path)) {
        lines.push(` D ${path}`);
      }
    }

    return lines.filter((line) => !line.slice(3).startsWith(".recognizer/"));
  }

  program(): Program {
    return (call) => {
      const [dash, root, ...rest] = call.args;
      const out = (stdout: string) => ({
        started: true,
        status: 0,
        stdout,
        stderr: "",
      });
      const failed = { started: true, status: 1, stdout: "", stderr: "" };
      const fatal = { ...failed, status: 128 };

      if (dash !== "-C" || root === undefined) {
        return failed;
      }

      const repository = this.repositories.get(root);

      if (repository === undefined) {
        return fatal;
      }

      const head = this.head(repository);
      const [first, ...following] = rest;
      const literal = first === "--literal-pathspecs";
      const [verb, ...more] = literal ? following : rest;
      const commitOf = (ref: string | undefined): Commit | null => {
        const sha = ref === undefined ? null : this.resolve(repository, ref);

        return sha === null ? null : (repository.commits.get(sha) ?? null);
      };

      if (verb === "rev-parse" && more[0] === "--is-inside-work-tree") {
        return out("true\n");
      }

      if (verb === "rev-parse" && more[0] === "HEAD") {
        return head === undefined ? fatal : out(`${head.sha}\n`);
      }

      if (verb === "rev-parse" && more[0] === "--verify") {
        const ref = more[more.length - 1] as string;
        const found = commitOf(ref.replace(/\^\{commit\}$/, ""));

        return found === null ? failed : out(`${found.sha}\n`);
      }

      if (verb === "symbolic-ref" && more.includes("HEAD")) {
        return out(`${repository.current}\n`);
      }

      if (verb === "merge-base" && more[0] === "--is-ancestor") {
        const ancestor = commitOf(more[1]);
        const descendant = commitOf(more[2]);

        return ancestor !== null &&
          descendant !== null &&
          ancestors(repository, descendant.sha).has(ancestor.sha)
          ? out("")
          : failed;
      }

      if (verb === "merge-base") {
        const a = commitOf(more[0]);
        const b = commitOf(more[1]);
        const base =
          a === null || b === null
            ? null
            : mergeBaseOf(repository, a.sha, b.sha);

        return base === null ? failed : out(`${base}\n`);
      }

      if (verb === "rev-list" && more.includes("--left-right")) {
        const [leftRef, rightRef] = (more[more.length - 1] as string).split(
          "...",
        );
        const a = commitOf(leftRef);
        const b = commitOf(rightRef);

        if (a === null || b === null) {
          return fatal;
        }

        const left = ancestors(repository, a.sha);
        const right = ancestors(repository, b.sha);
        const behind = [...left].filter((sha) => !right.has(sha)).length;
        const ahead = [...right].filter((sha) => !left.has(sha)).length;

        return out(`${behind}\t${ahead}\n`);
      }

      if (verb === "diff" && more.includes("--name-status")) {
        const target = more[more.length - 1] as string;
        const renamesOnly = more.includes("--diff-filter=R");

        if (target.includes("...")) {
          const [leftRef, rightRef] = target.split("...");
          const a = commitOf(leftRef);
          const b = commitOf(rightRef);
          const base =
            a === null || b === null
              ? null
              : mergeBaseOf(repository, a.sha, b.sha);

          return a === null || b === null || base === null
            ? fatal
            : out(
                nameStatusText(
                  changesBetween(
                    (repository.commits.get(base) as Commit).tree,
                    b.tree,
                  ),
                ),
              );
        }

        const since = commitOf(target);

        if (since === null || head === undefined) {
          return fatal;
        }

        const working: Tree = new Map();

        for (const [path, bytes] of listed(this.files, root)) {
          if (head.tree.has(path)) {
            working.set(path, bytes);
          }
        }

        const changes = changesBetween(since.tree, working);

        return out(
          nameStatusText(
            renamesOnly
              ? changes.filter((change) => change.status === "R")
              : changes,
          ),
        );
      }

      if (verb === "show" && more[0] !== undefined && more[0].includes(":")) {
        const [ref, ...pathParts] = more[0].split(":");
        const found = commitOf(ref);
        const bytes = found?.tree.get(pathParts.join(":"));

        return bytes === undefined ? fatal : out(bytes.toString("utf8"));
      }

      if (verb === "archive") {
        const output = more
          .find((argument) => argument.startsWith("--output="))
          ?.slice("--output=".length);
        const separator = more.indexOf("--");
        const positional = more
          .slice(0, separator < 0 ? more.length : separator)
          .filter((argument) => !argument.startsWith("-"));
        const paths = separator < 0 ? [] : more.slice(separator + 1);
        const found = commitOf(positional[positional.length - 1]);

        if (found === null || output === undefined) {
          return fatal;
        }

        const chosen = [...found.tree].filter(
          ([path]) =>
            paths.length === 0 ||
            paths.some(
              (wanted) => path === wanted || path.startsWith(`${wanted}/`),
            ),
        );

        if (paths.length > 0 && chosen.length === 0) {
          return fatal;
        }

        this.files.writeFile(
          output,
          JSON.stringify(
            Object.fromEntries(
              chosen.map(([path, bytes]) => [path, bytes.toString("base64")]),
            ),
          ),
        );

        return out("");
      }

      if (verb === "status") {
        const lines = this.status(root, repository);

        return call.args.includes("-z")
          ? out(lines.map((line) => `${line}\0`).join(""))
          : out(lines.length === 0 ? "" : `${lines.join("\n")}\n`);
      }

      if (verb === "ls-files") {
        return out(
          [...listed(this.files, root).keys()]
            .sort()
            .map((path) => `${path}\0`)
            .join(""),
        );
      }

      if (verb === "config") {
        return out("t\n");
      }

      return failed;
    };
  }
}
