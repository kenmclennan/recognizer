import { createHash } from "node:crypto";
import type { FakeFiles } from "./io/files.js";
import type { Program } from "./io/processes.js";

const IGNORED = [".recognizer/cache/", "node_modules/", ".git/"];

function ignored(path: string): boolean {
  return IGNORED.some((prefix) => path.startsWith(prefix));
}

function listed(files: FakeFiles, root: string): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (directory: string, prefix: string) => {
    for (const entry of files.readDir(directory)) {
      const relative = `${prefix}${entry.name}`;

      if (entry.kind === "directory") {
        if (!ignored(`${relative}/`)) {
          walk(`${directory}/${entry.name}`, `${relative}/`);
        }
      } else if (!ignored(relative)) {
        found.set(relative, files.hashFile(`${directory}/${entry.name}`) ?? "");
      }
    }
  };

  walk(root, "");

  return found;
}

export class FakeRepositories {
  private readonly commits = new Map<
    string,
    { head: string; tree: Map<string, string> }
  >();

  constructor(private readonly files: FakeFiles) {}

  commitAll(root: string, message = "commit"): string {
    const tree = listed(this.files, root);
    const head = createHash("sha1")
      .update(`${root}:${message}:${this.commits.size}`)
      .digest("hex");

    this.commits.set(root, { head, tree });

    return head;
  }

  private status(root: string): string[] {
    const known = this.commits.get(root)?.tree ?? new Map<string, string>();
    const now = listed(this.files, root);
    const lines: string[] = [];

    for (const [path, hash] of now) {
      if (!known.has(path)) {
        lines.push(`?? ${path}`);
      } else if (known.get(path) !== hash) {
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

      if (dash !== "-C" || root === undefined) {
        return failed;
      }

      const repository = this.commits.get(root);

      if (repository === undefined) {
        return { ...failed, status: 128 };
      }

      const [verb, ...more] = rest;

      if (verb === "rev-parse" && more[0] === "--is-inside-work-tree") {
        return out("true\n");
      }

      if (verb === "rev-parse" && more[0] === "HEAD") {
        return out(`${repository.head}\n`);
      }

      if (verb === "symbolic-ref" && more.includes("HEAD")) {
        return out("main\n");
      }

      if (verb === "status") {
        const lines = this.status(root);

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
        return out("test\n");
      }

      return failed;
    };
  }
}
