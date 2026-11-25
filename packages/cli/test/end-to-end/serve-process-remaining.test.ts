import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import {
  type Line,
  Serve,
  typescriptLaunchers,
  typescriptRepository,
} from "../serve-harness.js";

const TIMEOUT = scaledTimeout(60_000);

function gitIn(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
  }).trim();
}

function historyRepository(): {
  root: string;
  first: string;
  second: string;
} {
  const root = typescriptRepository();

  gitIn(root, "init", "-q", "-b", "main");
  gitIn(root, "config", "user.email", "t@example.com");
  gitIn(root, "config", "user.name", "t");
  gitIn(root, "config", "commit.gpgsign", "false");
  gitIn(root, "add", ".");
  gitIn(root, "commit", "-q", "-m", "first");

  const first = gitIn(root, "rev-parse", "HEAD");

  writeFileSync(
    join(root, "web/src/extra-module.ts"),
    "export const extra = 1;\n",
  );
  writeFileSync(
    join(root, "web/src/orders.ts"),
    'import { Customer, Order } from "@sample/api";\n\nconsole.log(Customer, Order, "edited");\n',
  );
  gitIn(root, "add", ".");
  gitIn(root, "commit", "-q", "-m", "second");

  return { root, first, second: gitIn(root, "rev-parse", "HEAD") };
}

function scanText(reply: Line): string {
  return JSON.stringify(
    (reply.ok as { scans: { document: unknown }[] }).scans.map(
      (scan) => scan.document,
    ),
  );
}

describe("recognizer serve: history operations", () => {
  it(
    "view.scans reads the modules of each commit",
    async () => {
      const { root, first, second } = historyRepository();
      const serve = new Serve(typescriptLaunchers());
      const before = await serve.call("view.scans", {
        repository: root,
        commit: first,
      });
      const after = await serve.call("view.scans", {
        repository: root,
        commit: second,
      });

      expect(before.ok).toMatchObject({ ok: true });
      expect(after.ok).toMatchObject({ ok: true });
      expect(scanText(before)).not.toContain("extra-module");
      expect(scanText(after)).toContain("extra-module");

      await serve.close();
    },
    TIMEOUT,
  );

  it(
    "view.members scans only the modified files and returns both texts",
    async () => {
      const { root, first, second } = historyRepository();
      const serve = new Serve(typescriptLaunchers());
      const reply = await serve.call("view.members", {
        repository: root,
        base: first,
        head: second,
      });
      const found = reply.ok as {
        ok: boolean;
        baseScans: { text: string }[];
        headScans: { text: string }[];
        files: { path: string; baseText: string; headText: string }[];
      };

      expect(found.ok).toBe(true);
      expect(found.files).toHaveLength(1);
      expect(found.files[0]?.path).toBe("web/src/orders.ts");
      expect(found.files[0]?.baseText).not.toContain("edited");
      expect(found.files[0]?.headText).toContain("edited");
      expect(JSON.stringify(found.headScans)).not.toContain("memory-store");

      await serve.close();
    },
    TIMEOUT,
  );

  it(
    "view.members reads a renamed and edited file",
    async () => {
      const { root } = historyRepository();
      const lines = Array.from(
        { length: 20 },
        (_, index) => `console.log("line ${index} edited");\n`,
      );

      writeFileSync(
        join(root, "web/src/orders.ts"),
        `import { Customer, Order } from "@sample/api";\n${lines.join("")}console.log(Customer, Order);\n`,
      );
      gitIn(root, "add", ".");
      gitIn(root, "commit", "-q", "-m", "padded");

      const padded = gitIn(root, "rev-parse", "HEAD");

      gitIn(root, "mv", "web/src/orders.ts", "web/src/purchases.ts");
      writeFileSync(
        join(root, "web/src/purchases.ts"),
        `import { Customer, Order } from "@sample/api";\n${lines.join("")}console.log(Customer, Order, "renamed");\n`,
      );
      gitIn(root, "add", ".");
      gitIn(root, "commit", "-q", "-m", "third");

      const third = gitIn(root, "rev-parse", "HEAD");
      const serve = new Serve(typescriptLaunchers());
      const reply = await serve.call("view.members", {
        repository: root,
        base: padded,
        head: third,
      });
      const found = reply.ok as {
        ok: boolean;
        files: {
          path: string;
          basePath: string;
          baseText: string | null;
          headText: string | null;
        }[];
      };

      expect(found.ok).toBe(true);
      expect(found.files).toEqual([
        {
          path: "web/src/purchases.ts",
          basePath: "web/src/orders.ts",
          baseText: expect.stringContaining("edited"),
          headText: expect.stringContaining("renamed"),
        },
      ]);

      await serve.close();
    },
    TIMEOUT,
  );

  it(
    "view.members scans the modified files at the head commit with another branch checked out",
    async () => {
      const { root, first, second } = historyRepository();

      gitIn(root, "checkout", "-q", "-b", "other", first);

      const serve = new Serve(typescriptLaunchers());
      const reply = await serve.call("view.members", {
        repository: root,
        base: first,
        head: second,
      });
      const found = reply.ok as {
        ok: boolean;
        files: { headText: string }[];
      };

      expect(found.ok).toBe(true);
      expect(found.files[0]?.headText).toContain("edited");

      await serve.close();
    },
    TIMEOUT,
  );

  it(
    "view.range, view.renames and view.author answer over the wire",
    async () => {
      const { root, first, second } = historyRepository();
      const serve = new Serve(typescriptLaunchers());
      const range = await serve.call("view.range", {
        repository: root,
        base: first,
        head: second,
      });

      expect(range.ok).toEqual({
        baseCommit: first,
        headCommit: second,
        merged: false,
        changes: [
          { status: "A", path: "web/src/extra-module.ts" },
          { status: "M", path: "web/src/orders.ts" },
        ],
      });
      expect((await serve.call("view.author", { repository: root })).ok).toBe(
        "t",
      );
      expect(
        (await serve.call("view.renames", { repository: root, commit: first }))
          .ok,
      ).toEqual([]);

      await serve.close();
    },
    TIMEOUT,
  );
});
