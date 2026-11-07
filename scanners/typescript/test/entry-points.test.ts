import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scan } from "../src/index.js";
import { FIXTURE, scanTree } from "./helpers.js";

const body = "export const x = 1;\n";

function marked(files: Record<string, string>): string[] {
  return scanTree(files)
    .modules.filter((module) => module.entry_point)
    .map((module) => module.id);
}

describe("entry point fixture", () => {
  const root = join(FIXTURE, "entry-points");
  const expected: Record<string, string> = JSON.parse(
    readFileSync(join(root, "expected.json"), "utf8"),
  );
  const doc = scan(root, null);

  it("scans exactly the modules expected.json lists", () => {
    expect(doc.modules.map((module) => module.id)).toEqual(
      Object.keys(expected).sort(),
    );
  });

  it("marks exactly the modules with a rule", () => {
    const want = Object.entries(expected)
      .filter(([, rule]) => rule !== "none")
      .map(([id]) => id);

    expect(doc.modules.filter((m) => m.entry_point).map((m) => m.id)).toEqual(
      want,
    );
  });

  it("writes entry_point only as true", () => {
    for (const module of doc.modules) {
      expect([undefined, true]).toContain(module.entry_point);
    }
  });
});

describe("entry point dist fixture", () => {
  const root = join(FIXTURE, "entry-points-dist");
  const expected: Record<string, string> = JSON.parse(
    readFileSync(join(root, "expected.json"), "utf8"),
  );
  const doc = scan(root, null);

  it("scans exactly the modules expected.json lists", () => {
    expect(doc.modules.map((module) => module.id)).toEqual(
      Object.keys(expected).sort(),
    );
  });

  it("marks exactly the modules with a rule", () => {
    const want = Object.entries(expected)
      .filter(([, rule]) => rule !== "none")
      .map(([id]) => id);

    expect(doc.modules.filter((m) => m.entry_point).map((m) => m.id)).toEqual(
      want,
    );
  });
});

function built(
  value: string,
  source: string,
  config = '{"compilerOptions":{"outDir":"dist","rootDir":"src"}}',
): string[] {
  return marked({
    "package.json": JSON.stringify({ main: value }),
    "tsconfig.json": config,
    [source]: body,
  });
}

describe("entry point build output mapping", () => {
  it.each([
    ["./dist/a.d.ts", "src/a.tsx"],
    ["./dist/a.js", "src/a.tsx"],
    ["./dist/a.mjs", "src/a.mts"],
    ["./dist/a.cjs", "src/a.cts"],
    ["./dist/a.jsx", "src/a.tsx"],
  ])("maps %s to %s", (value, source) => {
    expect(built(value, source)).toEqual([source]);
  });

  it("marks nothing extra for a tsconfig with no outDir", () => {
    expect(built("./dist/a.js", "src/a.ts", "{}")).toEqual([]);
  });

  it("ignores an unparseable tsconfig", () => {
    expect(built("./dist/a.js", "src/a.ts", "{not json")).toEqual([]);
  });

  it("skips a value whose source is not scanned", () => {
    expect(built("./dist/missing.js", "src/a.ts")).toEqual([]);
  });

  it("marks exactly the outputs that map to scanned sources", () => {
    expect(
      marked({
        "package.json": JSON.stringify({
          main: "./dist/a.js",
          bin: { x: "./dist/b.mjs", y: "./dist/gone.js" },
          exports: { ".": "./out/c.js", "./d": "./dist/d.json" },
        }),
        "tsconfig.json":
          '{"compilerOptions":{"outDir":"dist","rootDir":"src"}}',
        "src/a.ts": body,
        "src/b.mts": body,
        "src/c.ts": body,
        "src/d.ts": body,
      }),
    ).toEqual(["src/a.ts", "src/b.mts"]);
  });

  it("maps an outDir equal to the package directory", () => {
    expect(
      built(
        "./index.js",
        "src/index.ts",
        '{"compilerOptions":{"outDir":".","rootDir":"src"}}',
      ),
    ).toEqual(["src/index.ts"]);
  });

  it("maps nothing for a value equal to the outDir directory", () => {
    expect(built("./dist", "src/index.ts")).toEqual([]);
  });

  it("does not consult an ancestor tsconfig", () => {
    expect(
      marked({
        "tsconfig.json":
          '{"compilerOptions":{"outDir":"pkg/dist","rootDir":"pkg/src"}}',
        "pkg/package.json": '{"main":"dist/a.js"}',
        "pkg/src/a.ts": body,
      }),
    ).toEqual([]);
  });
});

describe("entry point wildcard exports", () => {
  const config = '{"compilerOptions":{"outDir":"dist","rootDir":"src"}}';

  it("marks every module a pattern matches through the outDir mapping", () => {
    expect(
      marked({
        "package.json": JSON.stringify({
          exports: { "./utils/*": "./dist/utils/*.js" },
        }),
        "tsconfig.json": config,
        "src/utils/a.ts": body,
        "src/utils/b/c.ts": body,
        "src/other.ts": body,
      }),
    ).toEqual(["src/utils/a.ts", "src/utils/b/c.ts"]);
  });

  it("matches scanned ids directly when there is no outDir", () => {
    expect(
      marked({
        "package.json": JSON.stringify({
          exports: { "./utils/*": "./src/utils/*.ts" },
        }),
        "src/utils/a.ts": body,
        "src/other.ts": body,
      }),
    ).toEqual(["src/utils/a.ts"]);
  });

  it("marks nothing for a private package's pattern", () => {
    expect(
      marked({
        "package.json": JSON.stringify({
          private: true,
          exports: { "./utils/*": "./dist/utils/*.js" },
        }),
        "tsconfig.json": config,
        "src/utils/a.ts": body,
      }),
    ).toEqual([]);
  });

  it("marks nothing and does not fail for a pattern matching no module", () => {
    expect(
      marked({
        "package.json": JSON.stringify({
          exports: { "./gone/*": "./dist/gone/*.js" },
        }),
        "tsconfig.json": config,
        "src/utils/a.ts": body,
      }),
    ).toEqual([]);
  });

  it("marks exactly the module a resolving pattern matches among several", () => {
    expect(
      marked({
        "package.json": JSON.stringify({
          exports: {
            "./utils/*": "./dist/utils/*.js",
            "./gone/*": "./dist/gone/*.js",
            "./two/*/*": "./dist/two/*/*.js",
          },
        }),
        "tsconfig.json": config,
        "src/utils/a.ts": body,
        "src/two/x/y.ts": body,
        "src/other.ts": body,
      }),
    ).toEqual(["src/utils/a.ts"]);
  });
});

describe("entry point manifests", () => {
  it("skips package.json files in skipped directories", () => {
    expect(
      marked({
        "node_modules/p/package.json": '{"main":"a.ts"}',
        "node_modules/p/a.ts": body,
        "dist/package.json": '{"main":"b.ts"}',
        "dist/b.ts": body,
      }),
    ).toEqual([]);
  });

  it("ignores an unparseable package.json", () => {
    expect(marked({ "package.json": "{not json", "a.ts": body })).toEqual([]);
  });

  it("marks nothing for a path escaping the root", () => {
    expect(
      marked({
        "pkg/package.json": '{"main":"../../x.js","bin":"../../a.ts"}',
        "a.ts": body,
      }),
    ).toEqual([]);
  });

  it("marks only the scanned files among those a manifest names", () => {
    expect(
      marked({
        "package.json": JSON.stringify({
          main: "./a.ts",
          bin: { one: "./missing.js", two: "b.ts" },
          exports: { ".": "./dist/c.js" },
          scripts: { go: "node missing.mjs && node a.ts" },
        }),
        "a.ts": body,
        "b.ts": body,
        "c.ts": body,
      }),
    ).toEqual(["a.ts", "b.ts"]);
  });

  it("resolves a workspace manifest from its own directory", () => {
    expect(
      marked({
        "pkg/package.json": '{"main":"index.ts"}',
        "pkg/index.ts": body,
        "index.ts": body,
      }),
    ).toEqual(["pkg/index.ts"]);
  });
});

describe("entry point HTML", () => {
  it("resolves a leading slash against the page directory first", () => {
    expect(
      marked({
        "app/index.html": '<script src="/src/main.ts"></script>',
        "app/src/main.ts": body,
        "src/main.ts": body,
      }),
    ).toEqual(["app/src/main.ts"]);
  });

  it("falls back to an ancestor directory", () => {
    expect(
      marked({
        "app/web/index.html": '<script src="/src/main.ts"></script>',
        "src/main.ts": body,
      }),
    ).toEqual(["src/main.ts"]);
  });

  it("resolves at the repository root itself", () => {
    expect(
      marked({
        "index.html": '<script src="/main.ts?v=1#x"></script>',
        "main.ts": body,
      }),
    ).toEqual(["main.ts"]);
  });

  it("skips scheme and protocol-relative sources", () => {
    expect(
      marked({
        "index.html":
          '<script src="https://x/main.ts"></script><script src="//x/a.ts"></script>',
        "main.ts": body,
        "a.ts": body,
      }),
    ).toEqual([]);
  });
});
