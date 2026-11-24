import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../tools/scripts/pool-scale.mjs";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { REPO } from "./helpers.js";
import { launcher, Serve, typescriptRepository } from "./serve-harness.js";

const TIMEOUT = scaledTimeout(180_000);
const MANIFEST_EXAMPLE = join(
  REPO,
  "schema/manifest-examples/valid/sensor-crap.json",
);

const FINDING = {
  id: "crap:full",
  kind: "crap",
  severity: "warning",
  principle: "change-risk-anti-patterns",
  summary: "full",
  evidence: { modules: ["a.py"] },
};

const FULL = [
  { event: "start", total: 3, unit: "functions" },
  { event: "result", findings: [FINDING], overlay: { crap: { full: 7 } } },
  {
    event: "settled",
    modified: false,
    settings: {},
    counts: { measured: 3, total: 3 },
  },
];

const EARLY_STOP = [
  { event: "start", total: 1, unit: "functions" },
  {
    event: "settled",
    modified: false,
    settings: {},
    stopped: { measured: 0, total: 1 },
    counts: { measured: 0, total: 1 },
  },
];

const PARTIAL_STOP = [
  { event: "result", findings: [FINDING], overlay: { crap: { full: 7 } } },
  {
    event: "settled",
    modified: false,
    settings: {},
    stopped: { measured: 2, total: 3 },
    counts: { measured: 2, total: 3 },
  },
];

const echo = (event: object) =>
  `echo 'recognizer-event ${JSON.stringify(event)}' >&2`;

function manifestText(): string {
  const base = JSON.parse(readFileSync(MANIFEST_EXAMPLE, "utf8"));

  delete base.suite_keys;
  delete base.placeholders;
  delete base.log_path;

  return JSON.stringify({ ...base, runs_tests: false, settings: [] });
}

function plugins(gate: string): string {
  const directory = makeTempDir("reported-service-plugins-");
  const manifest = join(gate, "manifest.json");

  writeFileSync(manifest, manifestText());
  launcher(
    directory,
    "recognizer-scan-typescript",
    `exec node ${REPO}/packages/scanners/typescript/dist/bin.js "$@"`,
  );
  launcher(
    directory,
    "recognizer-sense-crap",
    [
      `case "$1" in`,
      `manifest) cat ${manifest};;`,
      `check) echo '{"gaps":[]}';;`,
      `run)`,
      `  if [ -e ${gate}/hang ]; then`,
      `    settle() { ${echo(EARLY_STOP[1] as object)}; exit 143; }`,
      `    partial() { ${PARTIAL_STOP.map(echo).join("; ")}; exit 143; }`,
      `    silent() { exit 143; }`,
      `    trap "$(cat ${gate}/hang)" TERM`,
      `    ${echo(EARLY_STOP[0] as object)}`,
      `    echo $$ > ${gate}/run.pid`,
      `    while true; do sleep 0.1; done`,
      `  fi`,
      ...FULL.map((event) => `  ${echo(event)}`),
      `  exit 0;;`,
      `esac`,
    ].join("\n"),
  );

  return directory;
}

function repository(): string {
  const root = typescriptRepository();

  mkdirSync(join(root, ".recognizer"), { recursive: true });
  writeFileSync(
    join(root, ".recognizer", "config.yaml"),
    "sensors:\n  crap:\n    command: [recognizer-sense-crap, run]\n    manifest: [recognizer-sense-crap, manifest]\n",
  );
  writeFileSync(
    join(root, ".gitignore"),
    ".recognizer/cache/\nnode_modules/\n",
  );

  for (const args of [
    ["init", "-q"],
    ["add", "."],
    [
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-q",
      "-m",
      "initial",
    ],
  ]) {
    spawnSync("git", args, { cwd: root });
  }

  return root;
}

function read(root: string, ...parts: string[]) {
  return JSON.parse(
    readFileSync(join(root, ".recognizer", "cache", ...parts), "utf8"),
  );
}

describe("a stopped run through the service", () => {
  it.each(["settle", "silent"])(
    "a_run_stopped_before_its_first_result_keeps_the_full_findings_and_overlay_%s",
    async (mode) => {
      const gate = makeTempDir("reported-service-gate-");
      const root = repository();
      const serve = new Serve(plugins(gate));

      try {
        const full = await serve.call("scan.start", {
          repository: root,
          describe: false,
          analysis: false,
          sense: ["crap"],
        });

        await serve.outcome(full.ok);

        expect(read(root, "findings", "crap.json").findings).toHaveLength(1);
        expect(read(root, "overlays", "crap.json").values).toEqual({
          crap: { full: 7 },
        });

        const before = {
          findings: readFileSync(
            join(root, ".recognizer", "cache", "findings", "crap.json"),
            "utf8",
          ),
          overlay: readFileSync(
            join(root, ".recognizer", "cache", "overlays", "crap.json"),
            "utf8",
          ),
        };

        writeFileSync(join(gate, "hang"), mode);
        rmSync(join(gate, "run.pid"), { force: true });

        const stopping = await serve.call("scan.start", {
          repository: root,
          describe: false,
          analysis: false,
          sense: ["crap"],
        });

        await serve.until(() => {
          try {
            return readFileSync(join(gate, "run.pid"), "utf8").trim() === ""
              ? undefined
              : true;
          } catch {
            return undefined;
          }
        });
        await serve.call("scan.stop", { scan: stopping.ok });
        await serve.outcome(stopping.ok);

        expect(
          readFileSync(
            join(root, ".recognizer", "cache", "findings", "crap.json"),
            "utf8",
          ),
        ).toBe(before.findings);
        expect(
          readFileSync(
            join(root, ".recognizer", "cache", "overlays", "crap.json"),
            "utf8",
          ),
        ).toBe(before.overlay);
      } finally {
        await serve.close();
      }
    },
    TIMEOUT,
  );

  it(
    "a_run_stopped_before_its_first_result_keeps_an_earlier_stopped_result",
    async () => {
      const gate = makeTempDir("reported-service-gate-");
      const root = repository();
      const serve = new Serve(plugins(gate));
      const file = (...parts: string[]) =>
        join(root, ".recognizer", "cache", ...parts);
      const stopRun = async (mode: string) => {
        writeFileSync(join(gate, "hang"), mode);
        rmSync(join(gate, "run.pid"), { force: true });

        const started = await serve.call("scan.start", {
          repository: root,
          describe: false,
          analysis: false,
          sense: ["crap"],
        });

        await serve.until(() => {
          try {
            return readFileSync(join(gate, "run.pid"), "utf8").trim() === ""
              ? undefined
              : true;
          } catch {
            return undefined;
          }
        });
        await serve.call("scan.stop", { scan: started.ok });
        await serve.outcome(started.ok);
      };

      try {
        await stopRun("partial");

        const before = readFileSync(file("findings", "crap.json"), "utf8");

        expect(JSON.parse(before).stopped).toEqual({ measured: 2, total: 3 });

        await stopRun("settle");

        expect(readFileSync(file("findings", "crap.json"), "utf8")).toBe(
          before,
        );
        expect(read(root, "overlays", "crap.json").values).toEqual({
          crap: { full: 7 },
        });
      } finally {
        await serve.close();
      }
    },
    TIMEOUT,
  );
});
