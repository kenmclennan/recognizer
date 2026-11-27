import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { signalGroup } from "./signal-group.js";

const REPO = join(__dirname, "../../..");
const HELPER = "packages/cli/test/signal-group.ts";
const GROUP_SEND = /process\.kill\(\s*-/;
const ROOTS = ["packages", "tools/scripts"];
const SKIPPED = new Set(["node_modules", "dist", "target", ".venv"]);

function testFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return SKIPPED.has(entry.name) ? [] : testFiles(path);
    }

    return /\.(test\.)?(ts|mjs)$/.test(entry.name) &&
      (path.includes("/test/") || /\.test\.mjs$/.test(entry.name))
      ? [relative(REPO, path)]
      : [];
  });
}

function unguardedGroupSends(files: Record<string, string>): string[] {
  return Object.entries(files)
    .filter(([path, text]) => path !== HELPER && GROUP_SEND.test(text))
    .map(([path]) => path);
}

describe("signalling a process group from test code", () => {
  it("flags a group send that does not go through the guarded helper", () => {
    expect(
      unguardedGroupSends({
        "a.test.ts": [
          "process",
          ".kill(-(child.pid as number), 'SIGTERM');",
        ].join(""),
        "b.test.ts": "signalGroup(child, 'SIGTERM');",
        [HELPER]: ["process", ".kill(-child.pid, signal);"].join(""),
      }),
    ).toEqual(["a.test.ts"]);
  });

  it("is made only through signalGroup in every test file", () => {
    const files = Object.fromEntries(
      ROOTS.flatMap((root) => testFiles(join(REPO, root))).map((path) => [
        path,
        readFileSync(join(REPO, path), "utf8"),
      ]),
    );

    expect(unguardedGroupSends(files)).toEqual([]);
  });

  it("does not signal a child whose exit was already observed", () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const exited = { pid: 4242, exitCode: 0, signalCode: null };
    const killed = { pid: 4243, exitCode: null, signalCode: "SIGKILL" };

    expect(signalGroup(exited as never, "SIGTERM")).toBe(false);
    expect(signalGroup(killed as never, "SIGTERM")).toBe(false);
    expect(kill).not.toHaveBeenCalled();

    expect(
      signalGroup(
        { pid: 4244, exitCode: null, signalCode: null } as never,
        "SIGTERM",
      ),
    ).toBe(true);
    expect(kill).toHaveBeenCalledWith(-4244, "SIGTERM");

    kill.mockRestore();
  });
});
