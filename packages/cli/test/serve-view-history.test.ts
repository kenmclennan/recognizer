import { describe, expect, it } from "vitest";
import { type Line, typescriptScenario } from "./support/index.js";

function historyRepository() {
  const { root, repository } = typescriptScenario({
    scanner: { fromTree: true },
  });
  const first = root.io
    .run("git", ["-C", repository, "rev-parse", "HEAD"])
    .stdout.trim();

  root.io.files.writeFile(
    `${repository}/web/src/extra-module.ts`,
    "export const extra = 1;\n",
  );
  root.io.files.writeFile(
    `${repository}/web/src/orders.ts`,
    'import { Customer, Order } from "@sample/api";\n\nconsole.log(Customer, Order, "edited");\n',
  );

  const second = root.repositories.commitAll(repository, "second");

  return { root, repository, first, second };
}

function scanText(reply: Line): string {
  return JSON.stringify(
    (reply.ok as { scans: { document: unknown }[] }).scans.map(
      (scan) => scan.document,
    ),
  );
}

describe("recognizer serve: history operations", () => {
  it("view.scans reads the modules of each commit", async () => {
    const { root, repository, first, second } = historyRepository();
    const before = await root.call("view.scans", {
      repository,
      commit: first,
    });
    const after = await root.call("view.scans", {
      repository,
      commit: second,
    });

    expect(before.ok).toMatchObject({ ok: true });
    expect(after.ok).toMatchObject({ ok: true });
    expect(scanText(before)).not.toContain("extra-module");
    expect(scanText(after)).toContain("extra-module");

    await root.close();
  });

  it("view.members scans only the modified files and returns both texts", async () => {
    const { root, repository, first, second } = historyRepository();
    const reply = await root.call("view.members", {
      repository,
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

    await root.close();
  });

  it("view.members reads a renamed and edited file", async () => {
    const { root, repository } = historyRepository();
    const lines = Array.from(
      { length: 20 },
      (_, index) => `console.log("line ${index} edited");\n`,
    );

    root.io.files.writeFile(
      `${repository}/web/src/orders.ts`,
      `import { Customer, Order } from "@sample/api";\n${lines.join("")}console.log(Customer, Order);\n`,
    );

    const padded = root.repositories.commitAll(repository, "padded");

    root.io.files.remove(`${repository}/web/src/orders.ts`);
    root.io.files.writeFile(
      `${repository}/web/src/purchases.ts`,
      `import { Customer, Order } from "@sample/api";\n${lines.join("")}console.log(Customer, Order, "renamed");\n`,
    );

    const third = root.repositories.commitAll(repository, "third");
    const reply = await root.call("view.members", {
      repository,
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

    await root.close();
  });

  it("view.members scans the modified files at the head commit with another branch checked out", async () => {
    const { root, repository, first, second } = historyRepository();

    root.repositories.checkout(repository, "other", first);

    const reply = await root.call("view.members", {
      repository,
      base: first,
      head: second,
    });
    const found = reply.ok as {
      ok: boolean;
      files: { headText: string }[];
    };

    expect(found.ok).toBe(true);
    expect(found.files[0]?.headText).toContain("edited");

    await root.close();
  });

  it("view.range, view.renames and view.author answer over the wire", async () => {
    const { root, repository, first, second } = historyRepository();
    const range = await root.call("view.range", {
      repository,
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
    expect((await root.call("view.author", { repository })).ok).toBe("t");
    expect(
      (await root.call("view.renames", { repository, commit: first })).ok,
    ).toEqual([]);

    await root.close();
  });
});
