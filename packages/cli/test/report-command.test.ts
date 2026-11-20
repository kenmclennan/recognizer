import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { validateFindings } from "../src/findings-document.js";
import { fakeIo, PYTHON, ROOT, scanJson } from "./scan-helpers.js";

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

const SOURCES = { "m0.py": "x = 1\n", "m1.py": "y = 2\n" };
const SCAN = scanJson(2, 1, {
  commit: "0123456789abcdef0123456789abcdef01234567",
  files: Object.entries(SOURCES).map(([path, text]) => ({
    path,
    hash: sha256(text),
  })),
});
const SCAN_FILES = {
  [`${ROOT}/.recognizer/cache/scan.python.json`]: SCAN,
  ...Object.fromEntries(
    Object.entries(SOURCES).map(([path, text]) => [`${ROOT}/${path}`, text]),
  ),
};

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const TARGET = `${ROOT}/.recognizer/cache/findings/review.json`;
const CONFIG = `${ROOT}/.recognizer/config.yaml`;

function finding(id = "review:1", changes: Record<string, unknown> = {}) {
  return {
    id,
    kind: "review",
    severity: "violation",
    principle: "made-up-principle",
    summary: "a defect",
    evidence: {
      modules: ["shop/a.py"],
      members: [
        { module: "shop/a.py", name: "f", file: "shop/a.py", lines: [1, 3] },
      ],
    },
    ...changes,
  };
}

function document(changes: Record<string, unknown> = {}) {
  return JSON.stringify({
    findings_version: 1,
    findings: [finding()],
    ...changes,
  });
}

function reporting(
  argv: string[],
  options: {
    files?: Record<string, string>;
    stdin?: string;
    commit?: string | null;
  } = {},
) {
  const fake = fakeIo({
    ...(options.commit === null ? {} : { commit: options.commit ?? COMMIT }),
    files: { ...SCAN_FILES, ...options.files },
    scanners: { [PYTHON]: { output: SCAN } },
    ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
    now: () => Date.UTC(2026, 10, 2, 10, 30, 0),
  });
  const code = run(["report", ...argv, "--repository", ROOT], fake.io);

  return { fake, code, out: fake.out(), err: fake.err() };
}

const written = (fake: ReturnType<typeof fakeIo>) =>
  JSON.parse(fake.files.get(TARGET) as string);

describe("recognizer report", () => {
  it("writes a document read from a file with the fields the command fills", () => {
    const { fake, code, out } = reporting(
      ["--as", "review", `${ROOT}/f.json`],
      {
        files: { [`${ROOT}/f.json`]: document() },
      },
    );

    expect(code).toBe(0);
    expect(out).toBe("reported review: 1 findings at 0123456\n");
    expect(written(fake)).toMatchObject({
      findings_version: 2,
      sensor: { name: "review", version: "reported" },
      commit: COMMIT,
      modified: false,
      settings: {},
      reported_at: "2026-11-02T10:30:00.000Z",
    });
  });

  it("writes version 2 with every scanned module's hash whatever version the agent's file gave", () => {
    const { fake, code } = reporting(["--as", "review"], {
      stdin: document({ findings_version: 1 }),
    });
    const file = written(fake);

    expect(code).toBe(0);
    expect(file.findings_version).toBe(2);
    expect(file.inputs).toEqual({
      "m0.py": sha256(SOURCES["m0.py"]),
      "m1.py": sha256(SOURCES["m1.py"]),
    });
    expect(() => validateFindings(file)).not.toThrow();
  });

  it("reads stdin when no file is given and accepts any principle text", () => {
    const { fake, code } = reporting(["--as", "review"], { stdin: document() });

    expect(code).toBe(0);
    expect(written(fake).findings[0].principle).toBe("made-up-principle");
  });

  it("keeps the document's own sensor version and overwrites supplied stamps", () => {
    const { fake } = reporting(["--as", "review"], {
      stdin: document({
        sensor: { name: "other", version: "7" },
        commit: "zzz",
        modified: true,
        settings: { a: 1 },
        reported_at: "2000-01-01T00:00:00Z",
      }),
    });
    const file = written(fake);

    expect(file.sensor).toEqual({ name: "review", version: "7" });
    expect(file.commit).toBe(COMMIT);
    expect(file.modified).toBe(false);
    expect(file.settings).toEqual({});
    expect(file.reported_at).toBe("2026-11-02T10:30:00.000Z");
  });

  it("replaces an earlier report of the same name", () => {
    const { fake } = reporting(["--as", "review"], {
      stdin: document({ findings: [finding("new:1")] }),
      files: { [TARGET]: "old" },
    });

    expect(written(fake).findings.map((one: { id: string }) => one.id)).toEqual(
      ["new:1"],
    );
    expect(fake.files.has(`${TARGET}.tmp`)).toBe(false);
  });

  it("refuses a document that fails the schema, with exit 1 and nothing written", () => {
    const { fake, code, err } = reporting(["--as", "review"], {
      stdin: document({ findings: [finding("a", { severity: "bad" })] }),
    });

    expect(code).toBe(1);
    expect(err).toContain("findings/findings/0/severity");
    expect(fake.files.has(TARGET)).toBe(false);
    expect(fake.writes).toEqual([]);
  });

  it("refuses repeated ids and unparseable JSON", () => {
    const repeated = reporting(["--as", "review"], {
      stdin: document({ findings: [finding("a"), finding("a")] }),
    });
    const broken = reporting(["--as", "review"], { stdin: "{" });

    expect(repeated.code).toBe(1);
    expect(repeated.err).toContain("repeat the id a");
    expect(broken.code).toBe(1);
    expect(broken.err).toContain("not JSON");
    expect(repeated.fake.writes).toEqual([]);
    expect(broken.fake.writes).toEqual([]);
  });

  it("refuses structure, a registered sensor name and a name outside the pattern with exit 2", () => {
    const files = {
      [CONFIG]:
        'sensors:\n  mine:\n    command: [mine, "{commit}", "{output}"]\n',
    };

    for (const name of ["structure", "mine", "Bad Name", ""]) {
      const result = reporting(["--as", name], { stdin: document(), files });

      expect(result.code).toBe(2);
      expect(result.fake.writes).toEqual([]);
    }
  });

  it("refuses the name of a shipped sensor that is not registered", () => {
    const result = reporting(["--as", "crap"], { stdin: document() });

    expect(result.code).toBe(2);
    expect(result.fake.writes).toEqual([]);
  });

  it("needs --as", () => {
    const { code, fake } = reporting([], { stdin: document() });

    expect(code).toBe(2);
    expect(fake.writes).toEqual([]);
  });

  it("refuses a folder with no git HEAD with exit 2", () => {
    const { code, err, fake } = reporting(["--as", "review"], {
      stdin: document(),
      commit: null,
    });

    expect(code).toBe(2);
    expect(err).toContain("has none");
    expect(fake.writes).toEqual([]);
  });

  it("prints the path, commit and count with --json", () => {
    const { out } = reporting(["--as", "review", "--json"], {
      stdin: document({ findings: [finding("a"), finding("b")] }),
    });

    expect(JSON.parse(out)).toEqual({
      path: TARGET,
      commit: COMMIT,
      findings: 2,
    });
  });
});
