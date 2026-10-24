import { describe, expect, it } from "vitest";
import { depends, scanTree } from "./helpers.js";

const edges = (files: Record<string, string>, from = "m.ts") =>
  depends(scanTree(files), from).map(({ to, line, names, via }) => ({
    to,
    line,
    names,
    via,
  }));

describe("names", () => {
  it("records named, aliased, default and mixed imports", () => {
    const files = {
      "a.ts": "export const f = 1;\nexport default 2;\n",
      "m.ts": 'import { f as g } from "./a";\n',
      "n.ts": 'import d from "./a";\n',
      "o.ts": 'import d, { f } from "./a";\n',
    };

    expect(edges(files, "m.ts")).toEqual([
      { to: "a.ts", line: 1, names: ["f"], via: undefined },
    ]);
    expect(edges(files, "n.ts")[0]?.names).toEqual(["default"]);
    expect(edges(files, "o.ts")[0]?.names).toEqual(["default", "f"]);
  });

  it("leaves whole-module forms without names", () => {
    const files = {
      "a.ts": "export const f = 1;\n",
      "m.ts":
        'import * as ns from "./a";\nimport "./a";\nexport * from "./a";\nconst r = require("./a");\nconst d = import("./a");\n',
    };

    expect(edges(files).every((edge) => edge.names === undefined)).toBe(true);
    expect(edges(files)).toHaveLength(5);
  });

  it("gives a foreign edge no names", () => {
    expect(edges({ "m.ts": 'import { x } from "left-pad";\n' })).toEqual([
      { to: "foreign:left-pad", line: 1, names: undefined, via: undefined },
    ]);
  });

  it("records export-from names as the original name", () => {
    const files = {
      "a.ts": "export const f = 1;\n",
      "m.ts": 'export { f as g } from "./a";\n',
    };

    expect(edges(files)[0]?.names).toEqual(["f"]);
  });
});

describe("following", () => {
  const barrel = {
    "p/index.ts": 'export { X } from "./impl";\nexport const COUNT = 1;\n',
    "p/impl.ts": "export class X {}\n",
  };

  it("follows a one-hop re-export to the definer", () => {
    expect(edges({ ...barrel, "m.ts": 'import { X } from "./p";\n' })).toEqual([
      { to: "p/impl.ts", line: 1, names: ["X"], via: ["p/index.ts"] },
    ]);
  });

  it("follows a two-hop route in order", () => {
    const files = {
      "p/index.ts": 'export * from "./mid";\n',
      "p/mid.ts": 'export { X } from "./impl";\n',
      "p/impl.ts": "export class X {}\n",
      "m.ts": 'import { X } from "./p";\n',
    };

    expect(edges(files)[0]).toMatchObject({
      to: "p/impl.ts",
      via: ["p/index.ts", "p/mid.ts"],
    });
  });

  it("stops at a name the barrel defines itself", () => {
    expect(
      edges({ ...barrel, "m.ts": 'import { COUNT } from "./p";\n' }),
    ).toEqual([
      { to: "p/index.ts", line: 1, names: ["COUNT"], via: undefined },
    ]);
  });

  it("lets a defined name win over an imported one", () => {
    const files = {
      "p/index.ts":
        'import { X } from "./impl";\nexport class X2 {}\nexport const Y = X;\n',
      "p/impl.ts": "export class X {}\n",
      "m.ts": 'import { Y } from "./p";\n',
    };

    expect(edges(files)[0]?.to).toBe("p/index.ts");
  });

  it("follows a local export list of an import binding", () => {
    const files = {
      "p/index.ts": 'import { X } from "./impl";\nexport { X };\n',
      "p/impl.ts": "export class X {}\n",
      "m.ts": 'import { X } from "./p";\n',
    };

    expect(edges(files)[0]).toMatchObject({
      to: "p/impl.ts",
      via: ["p/index.ts"],
    });
  });

  it("follows default re-exports", () => {
    const files = {
      "p/index.ts": 'export { default } from "./impl";\n',
      "p/impl.ts": "export default class X {}\n",
      "m.ts": 'import X from "./p";\n',
    };

    expect(edges(files)[0]).toMatchObject({
      to: "p/impl.ts",
      names: ["default"],
      via: ["p/index.ts"],
    });
  });

  it("keeps the barrel for a name re-exported from a foreign module", () => {
    const files = {
      "p/index.ts": 'export { z } from "left-pad";\n',
      "m.ts": 'import { z } from "./p";\n',
    };

    expect(edges(files)[0]).toMatchObject({ to: "p/index.ts", via: undefined });
  });

  it("falls back to the barrel for a name found nowhere", () => {
    expect(
      edges({ ...barrel, "m.ts": 'import { ghost } from "./p";\n' })[0],
    ).toMatchObject({ to: "p/index.ts", names: ["ghost"] });
  });

  it("emits one edge per defining module on one line", () => {
    const files = {
      "p/index.ts": 'export { A } from "./a";\nexport { B } from "./b";\n',
      "p/a.ts": "export class A {}\n",
      "p/b.ts": "export class B {}\n",
      "m.ts": 'import { A, B } from "./p";\n',
    };

    expect(
      edges(files).map((edge) => [edge.to, edge.line, edge.names]),
    ).toEqual([
      ["p/a.ts", 1, ["A"]],
      ["p/b.ts", 1, ["B"]],
    ]);
  });

  it("unions the routes of names reaching one definer", () => {
    const files = {
      "p/index.ts": 'export { A } from "./a";\nexport { B } from "./mid";\n',
      "p/mid.ts": 'export { B } from "./a";\n',
      "p/a.ts": "export class A {}\nexport class B {}\n",
      "m.ts": 'import { A, B } from "./p";\n',
    };

    expect(edges(files)).toEqual([
      {
        to: "p/a.ts",
        line: 1,
        names: ["A", "B"],
        via: ["p/index.ts", "p/mid.ts"],
      },
    ]);
  });

  it("terminates on a cycle at the module whose next hop would revisit", () => {
    const files = {
      "a.ts": 'export { X } from "./b";\n',
      "b.ts": 'export { X } from "./a";\n',
      "m.ts": 'import { X } from "./a";\n',
    };

    expect(edges(files)).toEqual([
      { to: "b.ts", line: 1, names: ["X"], via: ["a.ts"] },
    ]);
  });

  it("keeps unresolved names on the barrel beside resolved ones", () => {
    const files = {
      ...barrel,
      "m.ts": 'import { X, C } from "./p";\n',
    };

    expect(edges(files).map((edge) => [edge.to, edge.names])).toEqual([
      ["p/impl.ts", ["X"]],
      ["p/index.ts", ["C"]],
    ]);
  });

  it("orders output stably and identically across runs", () => {
    const files = {
      "p/index.ts": 'export { A } from "./a";\nexport { B } from "./b";\n',
      "p/a.ts": "export class A {}\n",
      "p/b.ts": "export class B {}\n",
      "m.ts": 'import { B, A } from "./p";\n',
    };

    expect(JSON.stringify(scanTree(files))).toBe(
      JSON.stringify(scanTree(files)),
    );
  });
});
