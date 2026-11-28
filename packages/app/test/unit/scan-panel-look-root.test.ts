import { basename } from "node:path";
import { scanHistory } from "@recognizer/core";
import { beforeAll, describe, expect, it } from "vitest";
import REASONS from "../../../../fixtures/sensor-reasons/states.json";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import { readRunRecordFiles } from "../../../cli/src/serve/refusals";
import { type Program, sensorProgram } from "../../../cli/test/support/index";
import { describerManifestText } from "../../../cli/test/support/manifest-text";
import { collectFacts, FAKE_WORKER, here, webkit } from "../../src/look-page";
import { untilHolds } from "../app-harness";
import { appSensor } from "../in-process-root";
import {
  type Diagnosis,
  digestOf,
  failingProgram,
  Gate,
  heldProgram,
  type LookScenario,
  type LookStage,
  lookRoots,
  scanProgram,
} from "../look-root";

type Root = Parameters<LookStage["run"]>[0];

const A_TEXT = "def f():\n    return 1\n\n\ndef g():\n    return 2\n";
const B_TEXT = "def h():\n    return 3\n";
const HA = digestOf(A_TEXT);
const HB = digestOf(B_TEXT);
const HC = "c".repeat(64);
const IDS = ["app/a.py", "app/b.py"];
const member = (name: string, line: number) => ({
  name,
  kind: "function",
  exported: true,
  line,
  params: [],
  returns: "int",
});
const SCAN = {
  commit: "cur1234",
  modified: false,
  files: [
    { path: IDS[0], hash: HA },
    { path: IDS[1], hash: HB },
  ],
  modules: [
    { id: IDS[0], kind: "module", members: [member("f", 1), member("g", 5)] },
    { id: IDS[1], kind: "module", members: [member("h", 1)] },
  ],
  edges: [{ from: IDS[0], to: IDS[1], kind: "depends", line: 1, names: ["X"] }],
  foreign: [],
};

const DESCRIBER =
  "describer:\n  command: [describer, run, '--model', '{model}', '{request}']\n  version: v1\n";
const COMMAND = (name: string, script: string) =>
  `  ${name}:\n    command: [node, '{repository}/${script}', '{commit}', '{output}']\n`;
const SENSORS =
  "sensors:\n  crap:\n    manifest: [recognizer-sense-crap, manifest]\n  mutation:\n    manifest: [recognizer-sense-mutation, manifest]\n" +
  COMMAND("tally", "t.mjs") +
  COMMAND("alpha", "a.mjs") +
  COMMAND("beta", "b.mjs");
const CONFIG = DESCRIBER + SENSORS;
const SUITE_CONFIG = `${CONFIG}tests:
  - name: unit
    language: python
    directory: tests/unit
    command: pytest
    coverage: { path: coverage.xml, format: lcov }
  - name: a-suite-with-a-very-long-name-indeed
    language: python
    directory: tests/long
    command: pytest
    coverage: { path: coverage.xml, format: lcov }
  - name: web
    language: typescript
    directory: web
    runner: vitest
    command: vitest
    coverage: { path: coverage/lcov.info, format: lcov }
`;

const withManifest =
  (program: Program, patch: Record<string, unknown>): Program =>
  (call) => {
    const result = program(call);

    if (call.args[0] !== "manifest") {
      return result;
    }

    const manifest = JSON.parse((result as { stdout: string }).stdout);

    return {
      ...(result as object),
      stdout: JSON.stringify({ ...manifest, ...patch }),
    } as never;
  };

const crapProgram = (): Program =>
  withManifest(
    appSensor("crap", true, false, () => HA),
    {
      description: "Runs the tests with coverage.",
      expansion: "C.R.A.P.: Change Risk Anti-Patterns.",
      planned_work: undefined,
    },
  );
const mutationProgram = (): Program =>
  withManifest(
    appSensor("mutation", true, false, () => HA),
    {
      description: "Mutates and tests.",
      expansion: undefined,
      scoped: true,
      log_path: ".recognizer/cache/coverage/last-run.log",
    },
  );
const SCRIPTS: Record<string, string> = {
  "t.mjs": "tally",
  "a.mjs": "alpha",
  "b.mjs": "beta",
};
const commandSensors =
  (by: Record<string, Program> = {}): Program =>
  (call) => {
    const name = SCRIPTS[basename(call.args[0] ?? "")] as string;
    const program = by[name] ?? sensorProgram(name);

    return program(
      Object.create(call, {
        args: {
          value: ["run", "--commit", call.args[1], "--output", call.args[2]],
        },
      }),
    );
  };
const stamping =
  (name: string, program: Program): Program =>
  (call) => {
    const result = program(call);

    if (call.args[0] !== "run") {
      return result;
    }

    const at = (flag: string) => call.args[call.args.indexOf(flag) + 1] ?? "";

    return Promise.resolve(result).then((done) => {
      if (done.status === 0) {
        call.files.writeFile(
          at("--output"),
          findingsDoc(name, CURRENT)(at("--commit")),
        );
      }

      return done;
    });
  };
const describerLine: Program = () => ({
  started: true,
  status: 0,
  stdout: "Does a thing.\n",
  stderr: "",
});
const describerProgram =
  (given?: Program): Program =>
  (call) =>
    call.args[0] === "manifest"
      ? {
          started: true,
          status: 0,
          stdout: describerManifestText("v1"),
          stderr: "",
        }
      : call.args[0] === "run"
        ? (given ?? describerLine)(call)
        : { started: true, status: 0, stdout: "1\n", stderr: "" };

type Made = {
  config?: string;
  files?: LookScenario["files"];
  programs?: Record<string, Program>;
  ticks?: Record<string, unknown>;
  sensors?: Record<string, Program>;
  describer?: Program;
  rest?: Partial<LookScenario>;
};

const TICKS = { describe: false, analysis: true, ticked: [] as string[] };

const made = (one: Made = {}): LookScenario => ({
  config: one.config ?? CONFIG,
  files: {
    "app/a.py": A_TEXT,
    "app/b.py": B_TEXT,
    ...one.files,
  },
  programs: {
    "recognizer-scan-typescript": scanProgram(SCAN),
    "recognizer-sense-crap": crapProgram(),
    "recognizer-sense-mutation": mutationProgram(),
    node: commandSensors(one.sensors),
    describer: describerProgram(one.describer),
    ...one.programs,
  },
  ticks: { ...TICKS, ...one.ticks },
  ...one.rest,
});

const findingsDoc =
  (
    name: string,
    inputs: Record<string, string>,
    extra: Record<string, unknown> = {},
  ) =>
  (commit: string) =>
    JSON.stringify({
      findings_version: 1,
      sensor: { name, version: "1" },
      commit,
      modified: false,
      settings: {},
      inputs,
      findings: [],
      ...extra,
    });
const CURRENT = { [IDS[0] as string]: HA, [IDS[1] as string]: HB };
const resultFile = (name: string) => `.recognizer/cache/findings/${name}.json`;
const current = (name: string, extra: Record<string, unknown> = {}) => ({
  [resultFile(name)]: findingsDoc(name, CURRENT, extra),
});
const unavailable: Program = () => ({
  started: false,
  status: 127,
  stdout: "",
  stderr: "recognizer is not installed",
});
const isoAgo = (ms: number) => new Date(Date.now() - ms).toISOString();
const REPORT = (_commit: string) =>
  JSON.stringify({
    findings_version: 1,
    sensor: { name: "review", version: "reported" },
    commit: "feed123abc",
    modified: false,
    settings: {},
    reported_at: isoAgo(3 * 60000),
    findings: [],
  });

const rewriteConfig = (name: string, text: string): LookStage => ({
  name,
  run: async (root: Root) => {
    const events = () =>
      root.lines.filter((line) => typeof line.id !== "number").length;
    const before = events();

    root.io.files.writeFile(`${root.repository}/.recognizer/config.yaml`, text);

    while (events() === before) {
      await root.service.signal(50);
    }
  },
});

const SCENARIOS1 = (): Record<string, LookScenario> => ({
  plain: made(),
  blank: made({
    programs: {
      "recognizer-scan-typescript": scanProgram({
        modules: [],
        files: [],
        edges: [],
      }),
    },
    rest: {},
  }),
  reopened: made({ ticks: { describe: true, ticked: ["tally", "crap"] } }),
  down: made({
    programs: {
      "recognizer-sense-crap": unavailable,
      "recognizer-sense-mutation": unavailable,
    },
  }),
  report: made({
    files: { [resultFile("review")]: REPORT },
    rest: {
      stages: [
        { name: "idle", run: async () => {} },
        {
          name: "cleared",
          run: async (root: Root) => {
            const explorer = root.view.explorer();

            await explorer?.host.port.clearResults("review");
            explorer?.host.refresh();
            await explorer?.reloadSensors();
          },
        },
      ],
    },
  }),
  badConfig: made({
    rest: {
      stages: [
        { name: "idle", run: async () => {} },
        rewriteConfig(
          "broken",
          CONFIG.replace(
            "manifest: [recognizer-sense-crap, manifest]",
            "manifest: [recognizer-sense-crap, manifest]\n    timeout_factor: 2",
          ),
        ),
      ],
    },
  }),
  unregistered: made({ config: "sensors:\n  crap: {}\n" }),
});
const DESCRIBED = JSON.stringify({
  schema_version: 1,
  modules: Object.fromEntries(
    [
      [IDS[0], HA],
      [IDS[1], HB],
    ].map(([id, hash]) => [
      id,
      {
        line: "Does a thing.",
        source_hash: hash,
        describer: ["describer", "run", "--model", "{model}", "{request}"],
        version: "v1",
      },
    ]),
  ),
});
const ALL_CURRENT = {
  ...current("crap"),
  ...current("mutation"),
  ...current("tally"),
  ...current("alpha"),
  ...current("beta"),
  ".recognizer/responsibilities.json": DESCRIBED,
};

const runToEnd = async (root: Root) => {
  const host = await untilHolds(root.service, () => root.view.explorer()?.host);

  host.run(null);

  for (let round = 0; round < 400; round += 1) {
    await root.service.signal(1000);

    if (round > 2 && !host.running()) {
      break;
    }
  }
};

const RAN: LookStage[] = [
  { name: "idle", run: async () => {} },
  { name: "ran", run: runToEnd },
];

const failingRun = (key: string, gate: Gate): LookStage[] => [
  { name: "idle", run: async () => {} },
  {
    name: "ran",
    run: async (root: Root) => {
      const host = await hostOf(root);

      host.run(null);
      await untilPlugin(root, key, "running");
      gate.open();
      await finish(root, host);
    },
  },
];

const failing = (
  name: string,
  diagnosis?: Diagnosis,
  reason?: string,
): Made => {
  const gate = held();
  const wrap = (program: Program) =>
    heldProgram(failingProgram(program, diagnosis, reason), gate);

  return {
    ticks: { ticked: [name] },
    rest: { stages: failingRun(name, gate) },
    ...(name === "crap" || name === "mutation"
      ? {
          programs: {
            [`recognizer-sense-${name}`]: wrap(
              name === "crap" ? crapProgram() : mutationProgram(),
            ),
          },
        }
      : { sensors: { [name]: wrap(sensorProgram(name)) } }),
  };
};

const moduleFailing = (): Made => {
  const gate = held();

  return {
    ticks: { describe: true, analysis: false },
    describer: (call) =>
      (async () => {
        await Promise.race([gate.wait(), call.whenKilled()]);

        return { started: true, status: 1, stdout: "", stderr: "no describer" };
      })(),
    rest: { stages: failingRun("describe", gate) },
  };
};

const SCENARIOS2 = (): Record<string, LookScenario> => ({
  freshPartial: made({
    files: {
      ...ALL_CURRENT,
      ...{
        [resultFile("crap")]: findingsDoc("crap", {
          [IDS[0] as string]: HA,
          [IDS[1] as string]: HC,
        }),
      },
    },
  }),
  freshComplete: made({ files: ALL_CURRENT }),
  crapRed: made({
    files: current("crap", { diagnosis: REASONS["crap-tests-failed"] }),
  }),
  crapNoCov: made({
    files: current("crap", { diagnosis: REASONS["crap-no-coverage"] }),
  }),
  crapNoRun: made(failing("crap", REASONS["crap-no-runner"])),
  mutationRed: made(failing("mutation", REASONS["mutation-tests-failing"])),
  mutationNoCov: made(failing("mutation", REASONS["mutation-no-coverage"])),
  plainFail: made(failing("crap")),
  failed: made(failing("tally", undefined, "broke")),
  moduleFail: made(moduleFailing()),
});
const pluginsOf = (root: Root): { name: string; state: string }[] => {
  const states = (root.lines as Record<string, unknown>[]).filter(
    (line) => typeof line.state === "object" && line.state !== null,
  );
  const run = (
    states[states.length - 1]?.state as
      | { run?: { plugins?: { name: string; state: string }[] } | null }
      | undefined
  )?.run;

  return run?.plugins ?? [];
};

const untilPlugin = async (root: Root, name: string, state: string) => {
  for (let round = 0; round < 600; round += 1) {
    if (
      pluginsOf(root).some((one) => one.name === name && one.state === state)
    ) {
      return;
    }

    await root.service.signal(1000);
  }

  throw new Error(`${name} never reached ${state}`);
};

const hostOf = (root: Root) =>
  untilHolds(root.service, () => root.view.explorer()?.host);

const finish = async (root: Root, host: { running(): boolean }) => {
  for (let round = 0; round < 600 && host.running(); round += 1) {
    await root.service.signal(1000);
  }
};

const describerHolding =
  (gate: Gate): Program =>
  (call) =>
    (async () => {
      await Promise.race([gate.wait(), call.whenKilled()]);

      if (call.killed) {
        return { started: true, status: 143, stdout: "", stderr: "" };
      }

      return describerLine(call);
    })();

const held = () => {
  const gate = new Gate();

  gate.hold();

  return gate;
};

const heldRun = () => {
  const describing = held();
  const crap = held();
  const tally = held();

  return made({
    ticks: { describe: true, analysis: true, ticked: ["tally", "crap"] },
    describer: describerHolding(describing),
    sensors: {
      tally: heldProgram(stamping("tally", sensorProgram("tally")), tally),
    },
    programs: {
      "recognizer-sense-crap": heldProgram(
        stamping("crap", crapProgram()),
        crap,
      ),
    },
    rest: {
      plans: [
        {
          ticks: {
            describe: true,
            analysis: true,
            ticked: ["tally", "crap"],
          },
        },
      ],
      stages: [
        { name: "idle", run: async () => {} },
        {
          name: "describing",
          run: async (root) => {
            (await hostOf(root)).run(null);
            await untilPlugin(root, "describe", "running");
          },
        },
        {
          name: "afterDescribe",
          run: async (root) => {
            describing.open();
            await untilPlugin(root, "crap", "running");
          },
        },
        {
          name: "afterDuplication",
          run: async (root) => {
            crap.open();
            await untilPlugin(root, "crap", "finished");
          },
        },
        {
          name: "done",
          run: async (root) => {
            tally.open();
            await finish(root, await hostOf(root));
          },
        },
      ],
    },
  });
};

const stopping = () => {
  const gate = held();

  return made({
    ticks: { describe: true },
    describer: describerHolding(gate),
    rest: {
      stages: [
        { name: "idle", run: async () => {} },
        {
          name: "describing",
          run: async (root) => {
            (await hostOf(root)).run(null);
            await untilPlugin(root, "describe", "running");
          },
        },
        {
          name: "stopped",
          run: async (root) => {
            const host = await hostOf(root);

            host.stop();
            await finish(root, host);
          },
        },
      ],
    },
  });
};

const SUITE_NAMES = ["unit", "a-suite-with-a-very-long-name-indeed", "web"];
const suiteDoc = (name: string) => (commit: string) =>
  JSON.stringify({
    findings_version: 2,
    sensor: { name, version: "1" },
    commit,
    modified: false,
    settings: {},
    inputs: {},
    findings: [],
    suites: [
      { name: "unit", status: "ok", ran_at: isoAgo(3 * 3600000) },
      {
        name: "a-suite-with-a-very-long-name-indeed",
        status: "failed",
        ran_at: isoAgo(2 * 86400000),
        reason: "coverage unavailable",
      },
      { name: "web", status: "never", ran_at: null },
    ],
  });
const SUITE_FILES = {
  [resultFile("crap")]: suiteDoc("crap"),
  [resultFile("mutation")]: suiteDoc("mutation"),
};
const ALL_SUITES = {
  analysis: true,
  armed: ["crap"],
  suites: { crap: { ticked: SUITE_NAMES, known: SUITE_NAMES } },
};
const suites = (ticks: Record<string, unknown> = {}, ran = false): Made => ({
  config: SUITE_CONFIG,
  files: SUITE_FILES,
  ticks,
  ...(ran ? { rest: { stages: RAN } } : {}),
});

const STALE_CONFIG = `${CONFIG}tests:
  - name: app-suite
    language: python
    directory: app
    command: pytest
    coverage: { path: coverage.xml, format: lcov }
  - name: tools-suite
    language: python
    directory: tools
    command: pytest
    coverage: { path: coverage.xml, format: lcov }
`;
const staleDoc = (commit: string) =>
  JSON.stringify({
    findings_version: 2,
    sensor: { name: "crap", version: "1" },
    commit,
    modified: false,
    settings: {},
    inputs: { [IDS[0] as string]: HC, [IDS[1] as string]: HB },
    findings: [],
    suites: [
      { name: "app-suite", status: "ok", ran_at: isoAgo(3 * 3600000) },
      { name: "tools-suite", status: "ok", ran_at: isoAgo(3 * 3600000) },
    ],
  });

const FAILED_AT = "2026-11-02T09:00:00.000Z";
const runRecord = (diagnosis: unknown) =>
  JSON.stringify({
    log_version: 1,
    kind: "sense",
    started: FAILED_AT,
    finished: FAILED_AT,
    by: "ken",
    arguments: [],
    outcome: "failed",
    exit: 1,
    entries: [
      {
        name: "crap",
        command: ["node", "x.mjs"],
        status: 1,
        outcome: "failed",
        duration_ms: 1,
        stderr: "",
        reason: "tests failed",
        diagnosis,
      },
    ],
  });
const RECORD_PATH = ".recognizer/cache/log/20261102T090000000Z-sense.json";
const restart = (record: unknown | null, reportedAt: string): Made => ({
  files: {
    ...current("crap", { reported_at: reportedAt }),
    ...(record === null ? {} : { [RECORD_PATH]: runRecord(record) }),
  },
});
const msAfter = (ms: number) =>
  new Date(Date.parse(FAILED_AT) + ms).toISOString();

const SCENARIOS3 = (): Record<string, LookScenario> => ({
  scope: made({
    rest: {
      stages: RAN,
      plans: [
        {
          ticks: { analysis: true, armed: ["mutation"], onlyView: true },
          scope: ["app/a.py"],
        },
        { ticks: { analysis: true, armed: ["mutation"] }, scope: null },
      ],
    },
  }),
  scopeEmpty: made({ ticks: { onlyView: true } }),
  changed: made({
    rest: {
      hostEvents: [
        {
          event: "changes-changed",
          payload: {
            files: [{ path: "app/a.py", kind: "modified" }],
            moved: null,
          },
        },
      ],
    },
  }),
  running: heldRun(),
  stopping: stopping(),
  suites: made(suites()),
  suitesTicked: made({
    ...suites(
      {
        ticked: ["crap"],
        suites: {
          crap: { ticked: ["unit"], known: SUITE_NAMES },
        },
      },
      true,
    ),
    rest: {
      stages: RAN,
      plans: [
        { mode: "bring", ticks: ALL_SUITES },
        { mode: "rescan", ticks: ALL_SUITES },
        {
          ticks: {
            analysis: true,
            armed: ["crap"],
            suites: { crap: { ticked: ["unit"], known: SUITE_NAMES } },
          },
        },
      ],
    },
  }),
  suitesRan: made(suites({}, true)),
  suitesStale: made({
    config: STALE_CONFIG,
    files: { [resultFile("crap")]: staleDoc },
  }),
  refused: made(restart(REASONS["mutation-tests-failing"], msAfter(-1000))),
  okNewer: made(restart(null, msAfter(-1000))),
  copy: made(restart(REASONS["crap-no-coverage"], msAfter(-1000))),
  none: made(restart(null, msAfter(-1000))),
  older: made(restart(REASONS["mutation-tests-failing"], msAfter(1000))),
  tie: made(restart(REASONS["mutation-tests-failing"], msAfter(0))),
});

const HISTORY_RECORD = JSON.stringify({
  log_version: 1,
  kind: "scan",
  started: "2026-11-03T09:00:00.000Z",
  finished: "2026-11-03T09:10:00.000Z",
  by: "ken",
  arguments: [],
  outcome: "ok",
  exit: 0,
  structure_ms: 6000,
  phases: [
    {
      phase: "sense",
      entries: [
        {
          name: "mutation",
          command: ["x"],
          status: 0,
          outcome: "ok",
          stderr: "",
          duration_ms: 160000,
          modules: 2,
          fixed_ms: 100000,
          work: { unit: "functions", performed: 2 },
        },
      ],
    },
  ],
});

const withWork =
  (program: Program, performed: number): Program =>
  (call) =>
    call.args.includes("--work")
      ? {
          started: true,
          status: 0,
          stdout: JSON.stringify({
            gaps: [],
            work: { unit: "functions", to_perform: performed, reusable: 0 },
          }),
          stderr: "",
        }
      : program(call);

const estimateScenario = (): LookScenario => {
  const answers: Record<string, unknown> = {};
  const base = made({
    files: {
      ".recognizer/cache/log/20261103T090000000Z-scan.json": HISTORY_RECORD,
    },
    programs: {
      "recognizer-sense-mutation": withWork(mutationProgram(), 2),
    },
  });

  return {
    ...base,
    answers,
    plans: [
      { ticks: { analysis: true, armed: ["mutation"] } },
      { ticks: { analysis: true, armed: [] } },
    ],
    stages: [
      { name: "idle", run: async () => {} },
      {
        name: "answers",
        run: async (root: Root) => {
          answers["sensor.work"] = await root.service.call("sensor.work", {
            repository: root.repository,
            sensor: "mutation",
          });
          answers["scan.history"] = scanHistory(
            readRunRecordFiles(root.io, root.repository),
          );
        },
      },
    ],
  };
};

const SCENARIOS4 = (): Record<string, LookScenario> => ({
  bare: made({ config: "sensors: {}\n" }),
  timed: estimateScenario(),
});

const SCENARIOS = (): Record<string, LookScenario> => ({
  ...SCENARIOS1(),
  ...SCENARIOS2(),
  ...SCENARIOS3(),
  ...SCENARIOS4(),
});
const HARNESS = (recordings: unknown, extra: unknown) => `
window.addEventListener("unhandledrejection", (e) => { window.__rej = String(e.reason && e.reason.message || e.reason).slice(0, 400); });
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { drawRecording } from ${JSON.stringify(here("../test/look-draw.ts"))};
import { pageAnswers } from ${JSON.stringify(here("../test/look-answers.ts"))};
import { afterTickChanges } from "@recognizer/core";
import REASONS from ${JSON.stringify(here("../../../fixtures/sensor-reasons/states.json"))};
import { PANEL_LIMITS } from ${JSON.stringify(here("panel-widths.ts"))};
import { icon as drawIcon } from ${JSON.stringify(here("../src/icons.ts"))};
${FAKE_WORKER}

const recordings = ${JSON.stringify(recordings)};
const extra = ${JSON.stringify(extra)};
const clock = { offset: 0 };
const realNow = Date.now.bind(Date);
Date.now = () => realNow() + clock.offset;
const tick = () => new Promise((resolve) => setTimeout(resolve, 60));
const until = async (ready, what) => { for (let waited = 0; !ready(); waited += 5) { if (waited >= 20000) throw new Error("timed out waiting for " + what + " :: " + (document.querySelector(".scan-panel")?.textContent || "").slice(0, 400) + " :: " + (document.querySelector(".footer")?.textContent || "").slice(0, 200)); await new Promise((resolve) => setTimeout(resolve, 5)); } };
let lastQ = "";
const click = (node) => { if (!node) throw new Error("click on nothing after " + lastQ + " EMPTY=" + (document.querySelector(".view-empty")?.textContent) + " LIST=" + (document.querySelector(".view-list")?.textContent)); return node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); };
const host = document.getElementById("content");
const footerElement = document.getElementById("footer");
const facts = {};
const errors = {};
let live = null;

const q = (selector) => { lastQ = selector; return document.querySelector(selector); };
const all = (selector) => { lastQ = selector; return [...document.querySelectorAll(selector)]; };
const visible = (selector) => { const n = q(selector); return n !== null && getComputedStyle(n).display !== "none"; };
const rows = () => all(".scan-row:not(.scan-suite)").map((r) => ({ key: r.dataset.sensor, name: r.querySelector(".scan-row-label").textContent, state: r.querySelector(".scan-state-text").textContent, note: (() => { const last = r.querySelector(".scan-state").title.split(": ").pop(); return /^(stopped|skipped)/.test(last) ? last : null; })(), tone: r.querySelector(".scan-state").className.replace("scan-state", "").trim(), color: getComputedStyle(r.querySelector(".scan-state")).color, title: r.dataset.tip, ticked: r.querySelector(".scan-tick").checked, disabled: r.querySelector(".scan-tick").disabled, accent: getComputedStyle(r.querySelector(".scan-tick")).accentColor, spinner: r.querySelectorAll(".scan-state .scan-spin").length, logLink: r.querySelector(".scan-log-link")?.textContent ?? null, bar: r.querySelectorAll(".scan-bar").length }));
const text = (selector) => q(selector)?.textContent ?? "<missing " + selector + ">";
const scanLineText = () => q(".scan-line").textContent;
const footerButtons = () => all(".footer button").filter((b) => !b.closest(".message-tray, .message-toast")).map((b) => b.className);
const messages = () => all(".message-list .msg").map((m) => ({ text: m.querySelector(".msg-text").textContent, actions: [...m.querySelectorAll(".msg-act")].map((b) => b.textContent) }));
const message = (contains) => all(".message-list .msg").find((m) => m.querySelector(".msg-text").textContent.includes(contains));
const act = (contains, label) => click([...message(contains).querySelectorAll(".msg-act")].find((b) => b.textContent === label));
const setTick = async (key, checked) => { const box = q('.scan-row[data-sensor="' + key + '"] .scan-tick'); box.checked = checked; box.dispatchEvent(new Event("change", { bubbles: true })); await tick(); };
const panel = () => ({ header: q(".scan-sub").textContent, amber: q(".scan-sub .warn")?.textContent ?? null, amberColor: q(".scan-sub .warn") ? getComputedStyle(q(".scan-sub .warn")).color : null, rows: rows(), buttons: all(".scan-buttons button").map((b) => ({ text: b.textContent, disabled: b.disabled, spinner: b.querySelectorAll("svg").length })), summary: q(".summary") ? { shape: q(".summary").dataset.shape, tone: q(".summary").className.replace("summary", "").trim(), head: q(".summary-head").textContent, line: q(".summary-line")?.textContent ?? null, bar: all(".summary-bar").length, spinning: q(".summary .scan-spin") !== null } : null, rowBars: all(".scan-bar").length, strays: all(".scan-block, .scan-block-title, .sensor-add, .sensor-remove, .scan-summary, .scan-stop-button, .scan-panel h2, .scan-panel h3, .scan-extract, .scan-describe, .measure-row").length, subLines: all(".scan-row *").filter((n) => n.matches("div")).length });
const openScan = async () => { click(q(".rail-scan")); await tick(); };

async function draw(name, options = {}) {
  live?.dispose();
  host.replaceChildren();
  footerElement.replaceChildren();
  for (const old of document.querySelectorAll(".scan-tip")) old.remove();
  const recording = recordings[name];
  if (recording === undefined) throw new Error("no recording " + name);
  if (window.__dbg) {} const dbgInfo = JSON.stringify({ marks: recording.marks, events: recording.events.length, cmds: recording.commands.map((c) => c.command + ':' + (c.args.op || '')).join(',') });
  clock.offset = 0;
  if (options.fake) { const stamps = (JSON.stringify(recording.events).match(/20\\d\\d-\\d\\d-\\d\\dT[\\d:.]+Z/g) || []).map((s) => Date.parse(s)).filter((n) => !Number.isNaN(n) && n < 1800000000000); if (stamps.length > 0) clock.offset = Math.max(...stamps) + 2000 - realNow(); }
  const drawn = await drawRecording(host, recording, {
    answer: pageAnswers(recording, options.page ?? {}),
    ...(options.until === undefined ? {} : { until: options.until }),
    ...(options.hold === undefined ? {} : { hold: options.hold }),
    ...(options.hostEvents === undefined ? {} : { hostEvents: options.hostEvents }),
    ...(options.carried === undefined ? {} : { carried: options.carried }),
  }).catch((e) => { throw new Error(String(e.message).slice(-100) + " REJ " + window.__rej + " DBG " + dbgInfo.slice(0, 80) + " opt " + JSON.stringify(Object.keys(options))); });
  live = drawn;
  await tick();
  const sentOf = (command) => drawn.sent().filter((one) => one.command === command);
  const allStarts = () => drawn.sent().filter((one) => one.command === "core_call" && one.args.op === "scan.start").map((one) => one.args.args);
  const boot = allStarts().length;
  const starts = () => allStarts().slice(boot);
  const writes = () => sentOf("write_scan_ticks").map((one) => one.args);
  const opened = () => sentOf("open_in_editor").map((one) => one.args.relative);
  const go = async (mark) => { drawn.release(mark); await new Promise((r) => setTimeout(r, 30)); await drawn.drained(); await tick(); };
  return { go, drawn, q, all, visible, rows, text, scanLineText, footerButtons, messages, message, act, setTick, panel, starts, writes, opened, sentOf, openScan };
}

async function group(keys, body) {
  try { await body(); } catch (error) { for (const key of keys) errors[key] = String(error && error.stack ? error.message + " " + error.stack : error); }
}
`;
const SHARED = `
const viewJson = (commit, steps) => JSON.stringify({ schema_version: 4, description: "Shows a.", commit, steps }, null, 2) + "\\n";
const commitOf = (name) => recordings[name].loaded.scans[0].document.commit;
const gated = (op) => { const gate = { held: false, release: () => {}, promise: null }; gate.promise = new Promise((resolve) => { gate.release = resolve; }); gate.hold = (command, args) => (gate.held && command === "core_call" && args.op === op ? gate.promise : undefined); return gate; };

const whyFacts = (m, key) => {
  const row = m.q('.scan-row[data-sensor="' + key + '"]');
  const hover = row.querySelector(".scan-state").title;
  const at = hover.indexOf(": ");
  const rowBox = row.getBoundingClientRect();
  const next = row.nextElementSibling;
  const nextBox = next ? next.getBoundingClientRect() : null;
  const sibling = m.q('.scan-row[data-sensor="structure"]').getBoundingClientRect();
  return {
    state: m.rows().find((r) => r.key === key).state,
    tone: m.rows().find((r) => r.key === key).tone,
    why: at < 0 ? null : hover.slice(at + 2),
    beneath: row.querySelector(".scan-why") !== null,
    log: row.querySelector(".scan-log-link")?.textContent ?? null,
    oneLine: Math.abs(rowBox.height - sibling.height) < 1,
    clear: nextBox === null ? null : nextBox.top >= rowBox.bottom - 0.5,
  };
};
const completedScan = async (name) => { const m = await draw(name); await m.openScan(); return m; };
const reasonScan = async (name, sensor) => {
  const m = await draw(name, { until: "idle" });
  await m.openScan();
  await m.setTick(sensor, true);
  click(m.q(".scan-run"));
  await tick();
  await m.go("ran");
  await tick(); await tick(); await tick();
  return m;
};

const foldOf = (m, sensor) => ({ open: m.all('.scan-suite[data-sensor="' + sensor + '"]').length > 0, suites: m.all('.scan-suite[data-sensor="' + sensor + '"]').map((r) => ({ name: r.dataset.suite, ticked: r.querySelector(".scan-tick").checked, state: r.querySelector(".scan-state-text").textContent })) });
const sensorRow = (m, key) => { const r = m.q('.scan-row:not(.scan-suite)[data-sensor="' + key + '"]'); const t = r.querySelector(".scan-tick"); return { ticked: t.checked, indeterminate: t.indeterminate, state: r.querySelector(".scan-state-text").textContent }; };

`;
const GROUPS = `

await group(["fresh", "long"], async () => {
  const a = await draw("blank");
  await a.openScan();
  facts.fresh = { ...a.panel(), order: a.all(".rail button").map((b) => b.className.split(" ")[1]), railLabel: getComputedStyle(a.q(".rail-scan"), "::after").content, files: a.visible(".tree-header"), panelOpen: a.visible(".scan-panel"), ran: a.starts().length, buttonTitle: a.q(".scan-run").title };

  const rowEls = a.all(".scan-row:not(.scan-suite)");
  const first = rowEls[0].querySelector(".scan-state");
  first.textContent = "155 files described, 34 minutes ago";
  const paneBox = a.q(".scan-panel").getBoundingClientRect();
  const paneStyle = getComputedStyle(a.q(".scan-panel"));
  const contentRight = paneBox.right - parseFloat(paneStyle.paddingRight);
  const stateBox = first.getBoundingClientRect();
  const lineHeight = parseFloat(getComputedStyle(first).lineHeight) || 16;
  const lastRow = rowEls[rowEls.length - 1];
  lastRow.dispatchEvent(new MouseEvent("mouseenter"));
  const tipBox = document.querySelector(".scan-tip").getBoundingClientRect();
  facts.long = { stateRight: stateBox.right, contentRight, lines: Math.round(stateBox.height / lineHeight), nameOverflow: rowEls[0].querySelector(".scan-row-label").scrollWidth > rowEls[0].querySelector(".scan-row-label").clientWidth, tip: { left: tipBox.left, top: tipBox.top, right: tipBox.right, bottom: tipBox.bottom }, viewport: { w: window.innerWidth, h: window.innerHeight } };
  lastRow.dispatchEvent(new MouseEvent("mouseleave"));
});

await group(["scanned", "ticked"], async () => {
  const b = await draw("plain");
  await b.openScan();
  facts.scanned = b.panel();
  await b.setTick("describe", true);
  await b.setTick("tally", true);
  await b.setTick("crap", true);
  facts.ticked = { rows: b.rows().filter((r) => r.ticked).map((r) => r.key), written: b.writes().at(-1) };
});

await group(["reopened"], async () => {
  const c = await draw("reopened");
  await c.openScan();
  facts.reopened = c.rows().filter((r) => r.ticked).map((r) => r.key);
});

await group(["down"], async () => {
  const down = await draw("down");
  await down.openScan();
  facts.down = down.rows().map((r) => ({ name: r.name, disabled: r.disabled }));
});

await group(["report", "reportCleared"], async () => {
  const rp = await draw("report", { until: "idle" });
  await rp.openScan();
  const reportRow = () => rp.q('.sensor-row.reported[data-sensor="review"]');
  facts.report = {
    names: rp.rows().map((r) => r.name),
    listCount: rp.all(".scan-row").length,
    ticks: reportRow()?.querySelectorAll("input").length ?? null,
    chip: reportRow()?.querySelector(".sensor-chip").textContent ?? "",
    commit: reportRow()?.querySelector(".sensor-commit").textContent ?? "",
    clear: reportRow()?.querySelector(".sensor-clear")?.textContent ?? "",
    afterList: reportRow() !== null && rp.all(".scan-row").at(-1).compareDocumentPosition(reportRow()) === Node.DOCUMENT_POSITION_FOLLOWING,
  };
  await rp.go("cleared");
  click(reportRow().querySelector(".sensor-clear"));
  await tick(); await tick(); await tick();
  facts.reportCleared = { removed: rp.sentOf("core_call").filter((one) => one.args.op === "results.clear").map((one) => one.args.args.plugin), present: reportRow() !== null };
});

await group(["settingsError"], async () => {
  const broken = await draw("badConfig", { until: "idle" });
  await broken.openScan();
  await broken.go("broken");
  await tick(); await tick();
  const brokenRow = broken.q('.scan-row[data-sensor="crap"]');
  const reasonEl = brokenRow.querySelector(".scan-row-reason");
  const reasonBox = reasonEl.getBoundingClientRect();
  const brokenPane = broken.q(".scan-panel");
  const brokenPaneStyle = getComputedStyle(brokenPane);
  const brokenText = reasonEl.textContent;
  facts.settingsError = {
    label: brokenRow.querySelector(".scan-state-text").textContent,
    reason: brokenText,
    occurrences: brokenText.split("timeout_factor").length - 1,
    fitsRight: reasonBox.right <= brokenPane.getBoundingClientRect().right - parseFloat(brokenPaneStyle.paddingRight) + 0.5,
    unclipped: reasonEl.scrollWidth <= reasonEl.clientWidth,
    belowLabel: reasonBox.top >= brokenRow.querySelector(".scan-row-label").getBoundingClientRect().bottom - 0.5,
  };
});

await group(["unregistered", "unregisteredSummary"], async () => {
  const unregMount = await draw("unregistered");
  await unregMount.openScan();
  const bareKeys = () => unregMount.all(".scan-row").map((n) => n.dataset.sensor);
  facts.unregistered = { keys: bareKeys(), fixLines: unregMount.q(".scan-panel").textContent.split("recognizer plugin add").length - 1 };
  facts.unregisteredSummary = unregMount.q(".summary").textContent;
});
`;
const GROUPS2A = `
await group(["scopeNone","scopeUntitled","scopeUntitledOn","scopeOff","scopeOn","scopeRunning","scopeRan","scopeOffRan"], async () => {
  const start = gated("scan.start");
  const sc = await draw("scope", { until: "idle", hold: start.hold, page: { views: [{ name: "demo", text: viewJson(commitOf("scope"), [{ kind: "pick", module: "app/a.py" }]) }] } });
  await sc.openScan();
  const scopeOf = () => ({ switches: sc.all(".scan-scope").length, caption: sc.q(".scan-scope-canvas")?.textContent ?? null, on: sc.q(".scan-scope-canvas")?.getAttribute("aria-pressed") ?? null, all: sc.q(".scan-scope-all")?.textContent ?? null, disabled: sc.q(".scan-scope-canvas")?.disabled ?? null });
  const stateOf = (key) => sc.rows().find((r) => r.key === key)?.state;
  const noteOf = (key) => sc.rows().find((r) => r.key === key)?.note;
  facts.scopeNone = { scope: scopeOf(), describe: stateOf("describe") };
  click(sc.q(".rail-files"));
  await tick();
  click(sc.q(".reye"));
  await tick();
  click(sc.q(".rail-scan"));
  await tick();
  facts.scopeUntitled = { scope: scopeOf(), describe: stateOf("describe") };
  click(sc.q(".scan-scope-canvas"));
  await tick();
  facts.scopeUntitledOn = { scope: scopeOf(), describe: stateOf("describe") };
  click(sc.q(".scan-scope-all"));
  await tick();
  click(sc.q(".view-list"));
  await tick();
  const item = sc.all(".view-item").find((n) => n.querySelector(".view-item-name").textContent === "demo");
  click(item);
  await tick(); await tick();
  click(sc.q(".rail-scan"));
  await tick();
  await sc.setTick("mutation", true);
  facts.scopeOff = { scope: scopeOf(), describe: stateOf("describe"), mutation: stateOf("mutation"), mutationNote: noteOf("mutation"), crap: stateOf("crap"), duplication: stateOf("tally") };
  click(sc.q(".scan-scope-canvas"));
  await tick();
  facts.scopeOn = { scope: scopeOf(), describe: stateOf("describe"), mutation: stateOf("mutation"), mutationNote: noteOf("mutation"), crap: stateOf("crap"), duplication: stateOf("tally"), written: sc.writes().at(-1) };
  start.held = true;
  click(sc.q(".scan-run"));
  await tick();
  facts.scopeRunning = scopeOf();
  start.held = false;
  start.release();
  await tick();
  await sc.go("ran");
  await tick(); await tick();
  facts.scopeRan = { modules: sc.starts().map((plan) => plan.modules), after: scopeOf() };
  click(sc.q(".scan-scope-all"));
  await tick();
  click(sc.q(".scan-run"));
  await tick(); await tick();
  facts.scopeOffRan = sc.starts().map((plan) => plan.modules);
  facts.dbgRec = recordings.scope.commands.filter((c) => c.args.op === "scan.plan").map((c) => JSON.stringify(c.args));
  facts.dbgPlans = sc.sentOf("core_call").filter((o) => o.args.op === "scan.plan" || o.args.op === "scan.start").map((o) => JSON.stringify(o.args).slice(0, 700));
});

await group(["emptyCanvas","emptyCanvasClick","idleButton","idleClick","emptyCanvasRun"], async () => {
  const em = await draw("scopeEmpty", { page: { views: [{ name: "demo", text: viewJson(commitOf("scopeEmpty"), []) }] } });
  click(em.q(".rail-files"));
  await tick();
  click(em.q(".view-list"));
  await tick();
  click(em.all(".view-item").find((n) => n.querySelector(".view-item-name").textContent === "demo"));
  await tick(); await tick();
  click(em.q(".rail-scan"));
  await tick();
  await tick(); await tick();
  const emptyScope = () => ({ canvasDisabled: em.q(".scan-scope-canvas")?.disabled ?? null, canvasTitle: em.q(".scan-scope-canvas")?.title ?? null, canvasPressed: em.q(".scan-scope-canvas")?.getAttribute("aria-pressed") ?? null, allPressed: em.q(".scan-scope-all")?.getAttribute("aria-pressed") ?? null, allDisabled: em.q(".scan-scope-all")?.disabled ?? null, caption: em.q(".scan-scope-canvas")?.textContent ?? null });
  facts.emptyCanvas = emptyScope();
  const writtenBefore = em.writes().length;
  em.q(".scan-scope-canvas").click();
  await tick();
  facts.emptyCanvasClick = { writes: em.writes().length - writtenBefore };
  const beforeIdle = { ran: em.starts().length, written: em.writes().length };
  facts.idleButton = { label: em.q(".scan-run").textContent, disabled: em.q(".scan-run").disabled, text: em.q(".scan-panel").textContent };
  em.q(".scan-run").click();
  await tick(); await tick();
  facts.idleClick = { ran: em.starts().length - beforeIdle.ran, written: em.writes().length - beforeIdle.written };
  click(em.q(".scan-run-mode-full"));
  await tick();
  click(em.q(".scan-run"));
  await tick(); await tick();
  facts.emptyCanvasRun = { modules: em.starts().map((plan) => plan.modules), onlyView: em.writes().every((write) => write.onlyView === true) };
});

await group(["freshPartial","freshComplete","freshRescan","freshBack","layout"], async () => {
  const freshFacts = (fr) => ({ summary: fr.panel().summary, rows: fr.rows().filter((r) => r.key === "crap").map((r) => ({ state: r.state, note: r.note })), rowBars: fr.all(".scan-bar, .summary-bar").length, button: fr.q(".scan-run")?.textContent ?? null, disabled: fr.q(".scan-run")?.disabled ?? null, secondary: fr.all(".scan-secondary").length, mode: fr.q(".scan-run-mode .on")?.textContent ?? null, modeToggles: fr.all(".scan-run-mode button").map((b) => ({ text: b.textContent, pressed: b.getAttribute("aria-pressed"), disabled: b.disabled })), oldSwitch: fr.all(".scan-mode, .scan-mode-switch").length });
  const part = await draw("freshPartial");
  await part.openScan();
  await part.setTick("crap", true);
  facts.freshPartial = freshFacts(part);
  const fr = await draw("freshComplete");
  await fr.openScan();
  await fr.setTick("crap", true);
  facts.freshComplete = freshFacts(fr);
  click(fr.q(".scan-run-mode-full"));
  await tick();
  facts.freshRescan = { ...freshFacts(fr), ranBefore: fr.starts().length };
  click(fr.q(".scan-run-mode-incremental"));
  await tick();
  facts.freshBack = freshFacts(fr);
  const boxOf = (n) => n.getBoundingClientRect();
  const panelEl = fr.q(".scan-panel");
  const panelStyle = getComputedStyle(panelEl);
  const layoutLastRow = fr.all(".scan-row").at(-1);
  facts.layout = {
    order: [...panelEl.children].map((n) => n.className.split(" ")[0]),
    controls: [...fr.q(".scan-controls").children].map((n) => n.className.split(" ")[0]),
    rowsBeforeControls: Boolean(layoutLastRow.compareDocumentPosition(fr.q(".scan-controls")) & Node.DOCUMENT_POSITION_FOLLOWING),
    scopeAboveMode: boxOf(fr.q(".scan-scope")).bottom <= boxOf(fr.q(".scan-run-mode")).top + 0.5,
    modeAbovePrimary: boxOf(fr.q(".scan-run-mode")).bottom <= boxOf(fr.q(".scan-run")).top + 0.5,
    runWidth: boxOf(fr.q(".scan-run")).width,
    contentWidth: panelEl.clientWidth - parseFloat(panelStyle.paddingLeft) - parseFloat(panelStyle.paddingRight),
    modeClipped: fr.q(".scan-run-mode").scrollWidth > fr.q(".scan-run-mode").clientWidth,
    secondaryCss: fr.all(".scan-secondary").length,
  };
});

`;

const GROUPS2B = `
await group(["reasons"], async () => {
  facts.reasons = {};
  const crapRed = await completedScan("crapRed");
  facts.reasons.crapRed = whyFacts(crapRed, "crap");
  click(crapRed.q('.scan-row[data-sensor="crap"] .scan-log-link'));
  await tick();
  facts.reasons.opened = crapRed.opened();
  const crapNoCov = await completedScan("crapNoCov");
  facts.reasons.crapNoCov = whyFacts(crapNoCov, "crap");
  facts.reasons.crapNoRun = whyFacts(await reasonScan("crapNoRun", "crap"), "crap");
  facts.reasons.mutationRed = whyFacts(await reasonScan("mutationRed", "mutation"), "mutation");
  facts.reasons.mutationNoCov = whyFacts(await reasonScan("mutationNoCov", "mutation"), "mutation");
  facts.reasons.plain = whyFacts(await reasonScan("plainFail", "crap"), "crap");
});

await group(["restart"], async () => {
  facts.restart = {};
  for (const name of ["refused", "okNewer", "copy", "none", "older", "tie"]) {
    const m = await draw(name);
    await m.openScan();
    facts.restart[name] = whyFacts(m, "crap");
  }
});

await group(["failed"], async () => {
  const t = await draw("failed", { until: "idle", fake: true });
  await t.openScan();
  click(t.q(".scan-run"));
  await tick();
  await t.go("ran");
  await tick(); await tick();
  facts.failed = t.panel();
});

await group(["sensorFail","noLog"], async () => {
  const t = await draw("failed", { until: "idle", fake: true });
  await t.openScan();
  click(t.q(".scan-run"));
  await tick();
  await t.go("ran");
  await tick(); await tick();
  click(t.q(".rail-files"));
  await tick();
  const failedFooter = { text: t.scanLineText(), buttons: t.footerButtons() };
  const messagesBefore = t.messages();
  const hiddenBefore = !t.visible(".scan-panel");
  t.act("tally failed", "Show");
  await tick();
  const dot = t.q(".rail-scan .rail-dot");
  t.act("tally failed", "Open log");
  await tick();
  facts.sensorFail = {
    footer: failedFooter,
    messages: messagesBefore,
    hiddenBefore,
    panelOpen: t.visible(".scan-panel"),
    dot: dot !== null && !dot.hidden && getComputedStyle(dot).display !== "none",
    opened: t.opened(),
    reasonLines: t.all(".scan-row").map((r) => r.querySelectorAll("div").length).reduce((a, b) => a + b, 0),
  };
  facts.noLog = messagesBefore;
});

await group(["moduleFail","missing"], async () => {
  const m = await draw("moduleFail", { until: "idle" });
  await m.openScan();
  click(m.q(".scan-run"));
  await tick();
  await m.go("ran");
  await tick(); await tick();
  click(m.q(".rail-files"));
  await tick();
  const moduleFooter = { text: m.scanLineText(), buttons: m.footerButtons() };
  const moduleMessages = m.messages();
  m.act("Describe wrote", "Show");
  await tick();
  facts.moduleFail = {
    footer: moduleFooter,
    messages: moduleMessages,
    header: m.q(".inspector")?.textContent ?? "",
    reason: m.q(".responsibility .finding.warning")?.textContent ?? "",
  };
  facts.missing = { text: m.q(".responsibility .muted, .responsibility .line")?.textContent ?? "", describe: m.all(".responsibility .describe").length };
});

await group(["changedBefore","changed"], async () => {
  const changed = await draw("changed", { hostEvents: "later" });
  clock.offset = 2 * 3600000;
  await changed.openScan();
  facts.changedBefore = changed.panel();
  changed.drawn.deliverHostEvents();
  await tick();
  facts.changed = changed.panel();
  clock.offset = 0;
});
`;
const GROUPS3A = `
await group(["run"], async () => {
  const hold = gated("scan.start");
  const c = await draw("running", { until: "idle", hold: hold.hold });
  await c.openScan();
  await c.setTick("describe", true);
  await c.setTick("crap", true);
  hold.held = true;
  click(c.q(".scan-run"));
  await tick();
  const heldSamples = c.rows().filter((r) => r.spinner > 0).length;
  const heldPlans = c.starts().length;
  hold.held = false;
  hold.release();
  await tick();
  await c.go("describing");
  await tick(); await tick(); await tick();
  const sample = () => ({ panel: c.panel(), footer: { text: c.scanLineText(), buttons: c.footerButtons() } });
  const first = sample();
  facts.run = { plans: c.starts(), heldSamples, heldPlans, first: first.panel, footer: first.footer };
  await c.go("afterDescribe");
  await tick(); await tick(); await tick();
  facts.run.afterDescribe = c.panel();
  await c.go("afterDuplication");
  await tick(); await tick(); await tick();
  facts.run.afterDuplication = c.panel();
  await c.go("done");
  await until(() => c.q(".scan-stop") === null, "the scan to finish");
  await tick(); await tick(); await tick();
  facts.run.after = c.panel();
  facts.run.footerAfter = { text: c.scanLineText(), buttons: c.footerButtons() };
  facts.run.written = c.writes().map((w) => w.ticked);
  facts.run.crapTickAfter = c.rows().find((r) => r.key === "crap").ticked;
});

await group(["stopWhileRunning","modeWhileRunning","ticksWhileRunning","ticksAfterStop","stop"], async () => {
  const s = await draw("stopping", { until: "idle" });
  await s.openScan();
  await s.setTick("describe", true);
  click(s.q(".scan-run"));
  await tick();
  await s.go("describing");
  await tick(); await tick(); await tick();
  facts.stopWhileRunning = { count: s.all(".scan-buttons .scan-stop").length, buttons: s.panel().buttons, order: s.all(".scan-buttons button").map((b) => b.className.split(" ")[0]) };
  facts.modeWhileRunning = { disabled: s.all(".scan-run-mode button").map((b) => b.disabled), stopEnabled: s.q(".scan-stop").disabled === false };
  const tickedBefore = s.rows().map((r) => r.ticked);
  s.all(".scan-row-label").forEach((label) => click(label));
  await tick();
  facts.ticksWhileRunning = { disabled: s.rows().map((r) => r.disabled), unchanged: s.rows().map((r) => r.ticked).join() === tickedBefore.join(), stopEnabled: s.q(".scan-stop").disabled === false };
  click(s.q(".scan-stop"));
  await tick();
  await s.go("stopped");
  await tick(); await tick(); await tick();
  facts.ticksAfterStop = s.rows().map((r) => r.disabled);
  facts.stop = { footer: s.scanLineText(), footerButtons: s.footerButtons(), stopAfter: s.all(".scan-stop").length, button: s.q(".scan-run")?.textContent ?? "", disabled: s.q(".scan-run")?.disabled, stops: s.sentOf("core_call").filter((one) => one.args.op === "scan.stop").length };
});

`;

const GROUPS3B = `
await group(["suiteStale"], async () => {
  const stale = await draw("suitesStale");
  await stale.openScan();
  click(stale.q('.scan-row[data-sensor="crap"] .scan-fold'));
  await tick();
  const styleOf = (row) => { const state = row.querySelector(".scan-state"); return { icon: state.querySelector("svg").innerHTML, className: state.className, text: row.querySelector(".scan-state-text").textContent, title: state.title }; };
  const suiteRow = (name) => stale.q('.scan-suite[data-sensor="crap"][data-suite="' + name + '"]');
  facts.suiteStale = { alert: drawIcon("circle-alert").innerHTML, behind: styleOf(suiteRow("app-suite")), current: styleOf(suiteRow("tools-suite")), behindKind: suiteRow("app-suite").dataset.state, currentKind: suiteRow("tools-suite").dataset.state };
});

await group(["suiteStart","suiteOpened","suiteFoldWritten","suiteAfterTick"], async () => {
  const sm = await draw("suites");
  await sm.openScan();
  const suiteTick = async (m, sensor, suite) => { const box = m.q('.scan-suite[data-sensor="' + sensor + '"][data-suite="' + suite + '"] .scan-tick'); box.checked = !box.checked; box.dispatchEvent(new Event("change", { bubbles: true })); await tick(); };
  facts.suiteStart = { crap: sensorRow(sm, "crap"), fold: foldOf(sm, "crap") };
  click(sm.q('.scan-row[data-sensor="crap"] .scan-fold'));
  await tick();
  facts.suiteOpened = foldOf(sm, "crap");
  facts.suiteFoldWritten = sm.writes().at(-1).folds;
  await suiteTick(sm, "crap", "unit");
  facts.suiteAfterTick = { sensor: sensorRow(sm, "crap"), written: sm.writes().at(-1) };
});

  await group(["suiteReopened","suiteArmed","suiteAfterScan","suiteWidths"], async () => {
  const reopened = await draw("suitesTicked", { until: "idle" });
  await reopened.openScan();
  facts.suiteReopened = { sensor: sensorRow(reopened, "crap"), fold: foldOf(reopened, "crap") };
  await reopened.setTick("crap", true);
  await reopened.setTick("crap", true);
  facts.suiteArmed = sensorRow(reopened, "crap");
  click(reopened.q(".scan-run-mode-full"));
  await tick();
  click(reopened.q(".scan-run"));
  await tick();
  await reopened.go("ran");
  await tick(); await tick(); await tick();
  facts.suiteAfterScan = { sensor: sensorRow(reopened, "crap"), fold: foldOf(reopened, "crap"), plan: reopened.starts().at(-1) };
  facts.suiteWidths = {};
  for (const width of [PANEL_LIMITS.tree.min, PANEL_LIMITS.tree.initial]) {
    const explorerEl = reopened.q(".explorer");
    explorerEl.style.setProperty("--tree-w", width + "px");
    await tick();
    for (const key of ["mutation"]) { if (reopened.all('.scan-suite[data-sensor="' + key + '"]').length === 0) { click(reopened.q('.scan-row[data-sensor="' + key + '"] .scan-fold')); await tick(); } }
    const panelEl = reopened.q(".scan-panel");
    const rowsNow = reopened.all(".scan-row");
    const reference = reopened.q('.scan-row[data-sensor="structure"]').getBoundingClientRect().height;
    facts.suiteWidths[width] = {
      count: rowsNow.length,
      heights: rowsNow.map((r) => Math.abs(r.getBoundingClientRect().height - reference) < 1),
      clipped: rowsNow.map((r) => r.scrollWidth > r.clientWidth + 0.5),
      nameClipped: rowsNow.map((r) => { const n = r.querySelector(".scan-row-name"); return n.scrollWidth > n.clientWidth; }),
      panelOverflow: panelEl.scrollWidth > panelEl.clientWidth + 0.5,
      panelWidth: panelEl.getBoundingClientRect().width,
    };
  }
});

await group(["foldAcrossRebuild","foldReopened","foldSecondScan"], async () => {
  const foldRun = await draw("suitesRan", { until: "idle" });
  await foldRun.openScan();
  if (foldOf(foldRun, "crap").open) { click(foldRun.q('.scan-row[data-sensor="crap"] .scan-fold')); await tick(); }
  click(foldRun.q('.scan-row[data-sensor="crap"] .scan-fold'));
  await tick();
  const foldBefore = { instance: foldRun.drawn.explorer(), chevron: foldRun.q('.scan-row[data-sensor="crap"] .scan-fold').getAttribute("aria-expanded"), suites: foldOf(foldRun, "crap").suites.length, folds: [...foldRun.writes().at(-1).folds] };
  click(foldRun.q(".scan-run-mode-full"));
  await tick();
  click(foldRun.q(".scan-run"));
  await tick();
  await foldRun.go("ran");
  await tick(); await tick(); await tick();
  facts.foldAcrossRebuild = { before: { chevron: foldBefore.chevron, suites: foldBefore.suites, folds: foldBefore.folds }, rebuilt: foldRun.drawn.explorer() !== foldBefore.instance, chevron: foldRun.q('.scan-row[data-sensor="crap"] .scan-fold').getAttribute("aria-expanded"), suites: foldOf(foldRun, "crap").suites.length, folds: [...foldRun.writes().at(-1).folds] };
  click(foldRun.q(".rail-files"));
  await tick();
  click(foldRun.q(".rail-scan"));
  await tick();
  facts.foldReopened = { chevron: foldRun.q('.scan-row[data-sensor="crap"] .scan-fold').getAttribute("aria-expanded"), folds: [...foldRun.writes().at(-1).folds] };
  click(foldRun.q('.scan-row[data-sensor="crap"] .scan-fold'));
  await tick();
  click(foldRun.q(".scan-run"));
  await tick(); await tick(); await tick();
  facts.foldSecondScan = { chevron: foldRun.q('.scan-row[data-sensor="crap"] .scan-fold').getAttribute("aria-expanded") };
});

await group(["memoryAcrossFirstScan"], async () => {
  const memoryRun = await draw("suitesRan", { until: "idle" });
  const memoryRows = () => memoryRun.all('.tree .row[data-path^="app/"]').length;
  const memoryBefore = { instance: memoryRun.drawn.explorer(), rows: memoryRows() };
  click(memoryRun.q('.tree .row[data-path="app"] .name'));
  await tick();
  click(memoryRun.q('.tree .row[data-path="app/a.py"] .reye'));
  await tick();
  click(memoryRun.q('.box[data-id="app/a.py"] .box-body'));
  await tick();
  click(memoryRun.q('.selection-bar [aria-label^="Dependencies"]'));
  await tick();
  memoryBefore.opened = { rows: memoryRows(), inspector: memoryRun.q(".inspector-open") !== null };
  click(memoryRun.q(".rail-scan"));
  await tick();
  click(memoryRun.q(".scan-run-mode-full"));
  await tick();
  click(memoryRun.q(".scan-run"));
  await tick();
  await memoryRun.go("ran");
  await tick(); await tick(); await tick();
  facts.memoryAcrossFirstScan = { before: { rows: memoryBefore.rows, opened: memoryBefore.opened }, rebuilt: memoryRun.drawn.explorer() !== memoryBefore.instance, rows: memoryRows(), inspector: memoryRun.q(".inspector-open") !== null };
});

await group(["rapidTicks"], async () => {
  let releaseFirst = () => {};
  const firstReply = new Promise((resolve) => { releaseFirst = resolve; });
  let requests = 0;
  const rapid = await draw("suites", { hold: (command, args) => { if (command === "core_call" && args.op === "scan.ticks") { requests += 1; return requests === 1 ? firstReply : undefined; } return undefined; } });
  await rapid.openScan();
  click(rapid.q('.scan-row[data-sensor="crap"] .scan-fold'));
  await tick();
  const rapidBox = (suite) => rapid.q('.scan-suite[data-sensor="crap"][data-suite="' + suite + '"] .scan-tick');
  const rapidBefore = { unit: rapidBox("unit").checked, web: rapidBox("web").checked };
  const requestsBefore = rapid.sentOf("core_call").filter((one) => one.args.op === "scan.ticks").length;
  requests = 0;
  for (const suite of ["unit", "web"]) { const box = rapidBox(suite); box.checked = !box.checked; box.dispatchEvent(new Event("change", { bubbles: true })); }
  await tick();
  const requested = rapid.sentOf("core_call").filter((one) => one.args.op === "scan.ticks").slice(requestsBefore).map((one) => one.args.args);
  releaseFirst();
  await tick();
  facts.rapidTicks = { before: rapidBefore, requests: requested.map((r) => r.changes.map((c) => c.kind + ":" + c.suite)), after: { unit: rapidBox("unit").checked, web: rapidBox("web").checked } };
});
`;
const GROUPS4 = `
await group(["estimatePending","estimateTicked","estimateUnticked"], async () => {
  const work = gated("sensor.work");
  const timed = await draw("timed", { until: "idle", hold: work.hold });
  await timed.openScan();
  const estimateOf = () => { const n = timed.q(".scan-estimate"); return n === null ? null : { exists: true, hidden: n.hidden, text: n.textContent, title: n.title, afterButtons: timed.q(".scan-buttons").compareDocumentPosition(n) === Node.DOCUMENT_POSITION_FOLLOWING }; };
  work.held = true;
  await timed.setTick("mutation", true);
  facts.estimatePending = estimateOf();
  work.held = false;
  work.release();
  await tick(); await tick(); await tick();
  facts.estimateTicked = estimateOf();
  await timed.setTick("mutation", false);
  facts.estimateUnticked = estimateOf();
});

await group(["afterRunUnregistered"], async () => {
  const bare = await draw("bare");
  await bare.openScan();
  click(bare.q(".scan-run"));
  await tick(); await tick(); await tick();
  facts.afterRunUnregistered = { shape: bare.q(".summary")?.dataset.shape ?? null, card: bare.all(".scan-run-card, .scan-card").length, text: bare.q(".scan-panel").textContent, button: bare.q(".scan-run")?.textContent ?? null, fixLines: bare.q(".scan-panel").textContent.split("recognizer plugin add").length - 1 };
});

await group(["beforePlan","beforePlanAfterRun","afterPlan"], async () => {
  const plan = gated("scan.plan");
  plan.held = true;
  const pending = await draw("plain", { hold: plan.hold });
  await pending.openScan();
  facts.beforePlan = pending.panel();
  click(pending.q(".scan-run"));
  await tick(); await tick();
  facts.beforePlanAfterRun = pending.panel();
  plan.held = false;
  plan.release();
  await tick(); await tick();
  facts.afterPlan = pending.panel();
});
`;
const END = `
document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify({ facts, errors }))));
`;
const eachGroup = (text: string) =>
  text.split(/^(?=await group\()/m).filter((part) => part.trim() !== "");
const SETS = [
  GROUPS,
  GROUPS2A,
  ...eachGroup(GROUPS2B),
  ...eachGroup(GROUPS3A),
  GROUPS3B,
  GROUPS4,
];
const PAGE = (recordings: unknown, body: string) =>
  `${HARNESS(recordings, null)}
${SHARED}
(async () => {
${body}
${END}
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = ReturnType<typeof JSON.parse>;
type Collected = { facts: Facts; errors: Record<string, string> };
const SHORT_AGE = /^(current|now|\d+[mhd])$/;
const GREEN = "rgb(63, 185, 80)";
const RED = "rgb(248, 81, 73)";
const ACCENT = "rgb(68, 147, 248)";
const _MUTED = "rgb(145, 152, 161)";
const NAMES = [
  "Structural analysis",
  "Descriptions",
  "C.R.A.P.",
  "Mutation",
  "tally",
  "alpha",
  "beta",
];

const _names = (panel: Facts) => panel.rows.map((r: Facts) => r.name);
const states = (panel: Facts) => panel.rows.map((r: Facts) => r.state);

describe.skipIf(webkit === undefined)("the Scan panel", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    const named = await lookRoots(SCENARIOS());
    const recordings = Object.fromEntries(
      Object.entries(named).map(([name, { produced: _, ...one }]) => [
        name,
        one,
      ]),
    );
    const collected: Collected = { facts: {}, errors: {} };

    for (const body of SETS) {
      const part = await collectFacts<Collected>(
        PAGE(recordings, body),
        "scan-panel-look",
      );

      Object.assign(collected.facts, part.facts);
      Object.assign(collected.errors, part.errors);
    }

    f = new Proxy(collected.facts, {
      get: (target, key) => {
        if (key in target) {
          return target[key];
        }

        throw new Error(
          collected.errors[String(key)] ?? `no fact ${String(key)}`,
        );
      },
    });
  }, scaledTimeout(900000));

  it("offers the canvas and whole-repository switch on an Untitled canvas, captioned This canvas and sized by its open files", () => {
    expect(f.scopeNone.scope.switches).toBe(1);
    expect(f.scopeNone.scope.caption).toBe("This canvas, 0");
    expect(f.scopeNone.scope.all).toBe("Whole repository");
    expect(f.scopeUntitled.scope.caption).toMatch(/^This canvas, [1-9]/);
    expect(f.scopeUntitledOn.scope.on).toBe("true");
  });

  it("lists an unregistered installed sensor as one untickable not-registered row and renders no fix text", () => {
    expect(f.unregistered.keys).toEqual(["structure", "crap", "mutation"]);
    expect(f.unregistered.fixLines).toBe(0);
    expect(f.unregisteredSummary).not.toMatch(/Mutation/);
  });

  it("shows the unregistered summary and its fix lines after a run when nothing is registered", () => {
    expect(f.afterRunUnregistered.shape).toBe("unregistered");
    expect(f.afterRunUnregistered.button).toBe("Nothing to run");
    expect(f.afterRunUnregistered.fixLines).toBeGreaterThan(0);
  });

  it("reads Checking on the rows and the headline until the first plan answer arrives, then reads the real state", () => {
    for (const panel of [f.beforePlan, f.beforePlanAfterRun]) {
      expect(panel.summary.shape).toBe("checking");
      expect(panel.summary.head).toBe("Checking what is out of date");
      expect(panel.rows.find((r: Facts) => r.key === "structure").state).toBe(
        "checking",
      );
      expect(panel.rows.find((r: Facts) => r.key === "crap").state).toBe(
        "checking",
      );
    }

    expect(f.afterPlan.summary.shape).not.toBe("checking");
    expect(states(f.afterPlan)).not.toContain("checking");
  });

  it("captions a saved view by name and locks the switch during a run", () => {
    expect(f.scopeOff.scope).toEqual({
      switches: 1,
      caption: "demo, 1",
      on: "false",
      all: "Whole repository",
      disabled: false,
    });
    expect(f.scopeOn.scope.on).toBe("true");
    expect(f.scopeRunning.disabled).toBe(true);
    expect(f.scopeRan.after.disabled).toBe(false);
  });

  it("reads Descriptions and a ticked Mutation row as never run under either scope and leaves the other rows alone", () => {
    expect(f.scopeOff.describe).toBe("never run");
    expect(f.scopeOff.mutation).toBe("never run");
    expect(f.scopeOn.describe).toBe("never run");
    expect(f.scopeOn.mutation).toBe("never run");
    expect(f.scopeOn.crap).toBe(f.scopeOff.crap);
    expect(f.scopeOn.duplication).toBe(f.scopeOff.duplication);
  });

  it("sits third on the rail as Scan, swaps with the tree and runs nothing on open", () => {
    expect(f.fresh.order).toEqual([
      "rail-files",
      "rail-commits",
      "rail-views",
      "rail-notes",
      "rail-scan",
      "rail-findings",
      "rail-setup",
      "rail-settings",
    ]);
    expect(f.fresh.panelOpen).toBe(true);
    expect(f.fresh.files).toBe(false);
    expect(f.fresh.ran).toBe(0);
    expect(f.fresh.railLabel).toContain("Scan");
  });

  it("has no heading, sub-line, Remove button, Add block, summary or disabled checkbox, and an accent-coloured checkbox", () => {
    expect(f.fresh.strays).toBe(0);
    expect(f.fresh.subLines).toBe(0);
    expect(
      f.fresh.rows.filter((r: Facts) => r.disabled).map((r: Facts) => r.key),
    ).toEqual([]);
    expect(f.fresh.rows.every((r: Facts) => r.accent === ACCENT)).toBe(true);
  });

  it("titles each row with its one-sentence description and prints nothing under it", () => {
    const title = (key: string) =>
      f.fresh.rows.find((r: Facts) => r.key === key).title;

    expect(title("structure")).toBe(
      "Finds import cycles, files nothing imports, unused exports, private imports, long or complex functions, duplication and policy violations. Runs with every scan and needs no tests.",
    );
    expect(title("describe")).toBe(
      "Writes one line per file saying what it is responsible for.",
    );
    expect(title("crap")).toBe(
      "C.R.A.P.: Change Risk Anti-Patterns. Runs the tests with coverage.",
    );
    expect(title("tally")).toBe("tally");
  });

  it("wraps a long status inside the panel's content box and keeps the tip inside the window", () => {
    expect(f.long.stateRight).toBeLessThanOrEqual(f.long.contentRight + 0.5);
    expect(f.long.lines).toBe(1);
    expect(f.long.nameOverflow).toBe(false);
    expect(f.long.tip.left).toBeGreaterThanOrEqual(0);
    expect(f.long.tip.top).toBeGreaterThanOrEqual(0);
    expect(f.long.tip.right).toBeLessThanOrEqual(f.long.viewport.w);
    expect(f.long.tip.bottom).toBeLessThanOrEqual(f.long.viewport.h);
  });

  it("matches the mock after a scan: Scanned with an age and no sha or counts", () => {
    expect(f.scanned.header).toBe("Ran just now");
    expect(f.scanned.amber).toBeNull();
  });

  it("carries no amber phrase in the header with files changed, and says so in the summary and the Structure row", () => {
    expect(f.changedBefore.buttons[0].text).not.toBe("Update 1 file");
    expect(f.changed.header).toBe("Ran 2 hours ago");
    expect(f.changed.amber).toBeNull();
    expect(f.changed.summary).toMatchObject({
      shape: "attention",
      head: "Descriptions, C.R.A.P., Mutation, tally, alpha and beta have never run",
      bar: 0,
    });
    expect(f.changed.rows.find((r: Facts) => r.key === "structure").state).toBe(
      "2h",
    );
    expect(f.changed.buttons[0]).toEqual({
      text: "Update 1 file",
      disabled: false,
      spinner: 0,
    });
  });

  it("posts the failure and the scan start to the tray in order for a failed sensor", () => {
    expect(f.sensorFail.messages.map((m: Facts) => m.text)).toEqual([
      "tally failed: broke",
      "Scan started - tally",
    ]);
    expect(f.sensorFail.reasonLines).toBe(0);
  });

  it("shows a failed sensor row from the message's Show and opens the log from its Open log", () => {
    expect(f.sensorFail.footer.text).toBe("");
    expect(f.sensorFail.footer.buttons).toEqual(["bell"]);
    expect(f.sensorFail.messages).toEqual([
      { text: "tally failed: broke", actions: ["Show", "Open log"] },
      { text: "Scan started - tally", actions: [] },
    ]);
    expect(f.sensorFail.hiddenBefore).toBe(true);
    expect(f.sensorFail.panelOpen).toBe(true);
    expect(f.sensorFail.dot).toBe(true);
    expect(f.sensorFail.opened).toEqual([
      expect.stringMatching(/^\.recognizer\/cache\/log\/.+-scan\.json$/),
    ]);
  });

  it("leaves a failed sensor at failed with its age and a log link in red under a run card in the bad tone", () => {
    const row = f.failed.rows.find((r: Facts) => r.key === "tally");

    expect(row.state).toBe("failed, just now");
    expect(row.color).toBe(RED);
    expect(row.logLink).toBe("log");
    expect(f.failed.summary.shape).toBe("run-card");
    expect(f.failed.summary.tone).toBe("bad");
    expect(f.failed.summary.bar).toBe(0);
    expect(f.failed.amber).toBeNull();
  });

  it("two_quick_tick_clicks_apply_in_order", () => {
    const r = f.rapidTicks;
    expect(r.requests).toEqual([["suite:unit"], ["suite:unit", "suite:web"]]);
    expect(r.after).toEqual({ unit: !r.before.unit, web: !r.before.web });
  });

  it("closes an open suites fold when the Scan panel is reopened", () => {
    expect(f.foldReopened.chevron).toBe("false");
    expect(f.foldReopened.folds).toEqual([]);
  });

  it("keeps an open suites fold open when a Scan rebuilds the explorer", () => {
    const r = f.foldAcrossRebuild;

    expect(r.before.chevron).toBe("true");
    expect(r.before.suites).toBeGreaterThan(0);
    expect(r.before.folds).toEqual(["crap"]);
    expect(r.chevron).toBe("true");
    expect(r.suites).toBe(r.before.suites);
    expect(r.folds).toEqual(["crap"]);
  });

  it("keeps the expanded folders and the open inspector across the first Scan", () => {
    const r = f.memoryAcrossFirstScan;

    expect(r.before.opened.rows).toBeGreaterThan(r.before.rows);
    expect(r.before.opened.inspector).toBe(true);
    expect(r.rows).toBe(r.before.opened.rows);
    expect(r.inspector).toBe(true);
  });

  it("keeps the fold open on a second Scan that updates the explorer in place (non-gating)", () => {
    expect(f.foldSecondScan.chevron).toBe("true");
  });

  it.each([200, 280])(
    "keeps every row on one line with the fold open at %i px",
    (width) => {
      const w = f.suiteWidths[width];

      expect(w.count).toBeGreaterThan(7);
      expect(w.heights.every(Boolean)).toBe(true);
      expect(w.clipped.some(Boolean)).toBe(false);
      expect(w.panelOverflow).toBe(false);
      expect(w.panelWidth).toBeLessThanOrEqual(width);
    },
  );

  it("matches the run card while running: A scan is running., every planned row running, the Scanning card with a row bar and a single Stop", () => {
    expect(f.run.first).not.toBeNull();
    expect(f.run.heldSamples).toBe(4);
    expect(f.run.heldPlans).toBe(1);
    expect(f.run.plans).toEqual([
      {
        describe: "stale",
        analysis: true,
        sense: ["tally", "crap"],
        modules: ["app/a.py", "app/b.py"],
        plannedMs: {},
      },
    ]);
    expect(f.run.first.header).toBe("A scan is running.");
    expect(
      f.run.first.rows
        .filter((r: Facts) => r.spinner > 0)
        .map((r: Facts) => r.key),
    ).toEqual(["describe", "crap", "tally"]);
    expect([1, 2, 4].map((i) => f.run.first.rows[i].state)).toEqual([
      "0 of 2",
      "running",
      "running",
    ]);
    expect(f.run.first.rows[1].color).toBe(ACCENT);
    expect(f.run.first.summary).toMatchObject({
      shape: "run-card",
      tone: "run",
      head: "ScanningNo estimate yet",
      bar: 0,
      spinning: true,
    });
    expect(f.run.first.rowBars).toBe(1);
    expect(f.run.first.buttons).toEqual([
      { text: "Stop", disabled: false, spinner: 0 },
    ]);
    expect(f.run.footer.text).toBe(
      "Running Descriptions, tally and C.R.A.P.\u2026 Describing\u2026 0 of 2 files",
    );
    expect(f.run.footer.buttons).toEqual(["bell"]);
    expect(f.run.footerAfter.text).toBe("");
    expect(f.run.footerAfter.buttons).toEqual(["bell"]);
    expect(f.run.first.rows.every((r: Facts) => r.disabled)).toBe(true);
  });

  it("moves each row on as it finishes and draws no bar once the run is over", () => {
    const row = (panel: Facts, key: string) =>
      panel.rows.find((r: Facts) => r.key === key);

    expect(row(f.run.afterDescribe, "tally").state).toBe("running");
    expect(row(f.run.afterDescribe, "crap").state).toBe("running");
    expect(row(f.run.afterDuplication, "crap").state).toBe("now");
    expect(row(f.run.afterDuplication, "crap").color).toBe(GREEN);
    expect(row(f.run.afterDuplication, "tally").state).toBe("running");
    expect(row(f.run.after, "tally").state).toBe("current");
    expect(row(f.run.after, "crap").state).toBe("now");
    expect(f.run.after.header).toBe("Ran just now");
    expect(f.run.after.rowBars).toBe(0);
    expect(f.run.after.summary.bar).toBe(0);
    expect(f.run.after.summary.shape).not.toBe("running");
  });

  it("keeps a tests-running tick after the scan it ran in and writes it", () => {
    expect(f.run.crapTickAfter).toBe(true);
    expect(f.run.written.at(-1)).toContain("crap");
  });

  it("lays out the rows, then the scope toggle, the mode toggle, the primary, with the primary full width and nothing clipped", () => {
    expect(f.layout.order).toEqual([
      "scan-header",
      "scan-sub",
      "scan-list",
      "scan-controls",
      "scan-buttons",
      "scan-estimate",
    ]);
    expect(f.layout.controls).toEqual(["scan-scope", "scan-run-mode"]);
    expect(f.layout.rowsBeforeControls).toBe(true);
    expect(f.layout.scopeAboveMode).toBe(true);
    expect(f.layout.modeAbovePrimary).toBe(true);
    expect(
      Math.abs(f.layout.runWidth - f.layout.contentWidth),
    ).toBeLessThanOrEqual(1);
    expect(f.layout.modeClipped).toBe(false);
    expect(f.layout.secondaryCss).toBe(0);
  });

  it("disables This canvas with a tooltip at a count of 0 and plans the whole repository without rewriting the tick", () => {
    expect(f.emptyCanvas).toEqual({
      canvasDisabled: true,
      canvasTitle: "The canvas is empty.",
      canvasPressed: "false",
      allPressed: "true",
      allDisabled: false,
      caption: f.emptyCanvas.caption,
    });
    expect(f.emptyCanvasClick.writes).toBe(0);
    expect(f.emptyCanvasRun.modules).toEqual([null]);
    expect(f.emptyCanvasRun.onlyView).toBe(true);
  });

  it("runs nothing and writes no tick when the primary reads Ticked checks are up to date", () => {
    expect(f.idleButton.label).toBe("Ticked checks are up to date");
    expect(f.idleButton.disabled).toBe(true);
    expect(f.idleButton.text).not.toMatch(/include (it|them) in the next scan/);
    expect(f.idleClick).toEqual({ ran: 0, written: 0 });
  });

  it("stops a running scan from the Scan panel with a single Stop button, sends scan.stop once and leaves the footer empty", () => {
    expect(f.stopWhileRunning.order).toEqual(["scan-stop"]);
    expect(f.stopWhileRunning.count).toBe(1);
    expect(f.stop.stops).toBe(1);
    expect(f.stop.footer).toBe("");
    expect(f.stop.footerButtons).toEqual(["bell"]);
    expect(f.stop.stopAfter).toBe(0);
    expect(f.stop.button).toBe("Run Descriptions");
    expect(f.stop.disabled).toBe(false);
  });

  it("(non-gating) disables the mode toggle while a scan runs and keeps Stop enabled", () => {
    expect(f.modeWhileRunning.disabled).toEqual([true, true]);
    expect(f.modeWhileRunning.stopEnabled).toBe(true);
  });

  it("disables every row's checkbox while a run is in progress, ignores a label click, and re-enables them on Stop", () => {
    expect(f.ticksWhileRunning.disabled.length).toBeGreaterThan(0);
    expect(f.ticksWhileRunning.disabled.every(Boolean)).toBe(true);
    expect(f.ticksWhileRunning.unchanged).toBe(true);
    expect(f.ticksWhileRunning.stopEnabled).toBe(true);
    expect(f.ticksAfterStop.length).toBeGreaterThan(0);
    expect(f.ticksAfterStop.filter(Boolean)).toHaveLength(0);
  });

  it("lists Descriptions and the third-party rows, none disabled, when the installed list is unavailable", () => {
    expect(f.down).toEqual([
      { name: "Structural analysis", disabled: false },
      { name: "Descriptions", disabled: false },
      { name: "crap", disabled: false },
      { name: "mutation", disabled: false },
      { name: "tally", disabled: false },
      { name: "alpha", disabled: false },
      { name: "beta", disabled: false },
    ]);
  });

  it("says why each sensor could not run fully, one second line per mock state", () => {
    const r = f.reasons;

    expect(r.crapRed.state).toMatch(SHORT_AGE);
    expect(r.crapRed.tone).toBe("ok");
    expect(r.crapRed.why).toBe("3 tests failed, so coverage may read low.");
    expect(r.crapRed).toMatchObject({ beneath: false, log: "log" });
    expect(r.crapNoCov.state).toMatch(SHORT_AGE);
    expect(r.crapNoCov.why).toContain("cargo install cargo-llvm-cov");
    expect(r.crapNoCov).toMatchObject({ beneath: false, log: null });
    expect(r.crapNoRun.state).toMatch(/^failed/);
    expect(r.crapNoRun.tone).toBe("bad");
    expect(r.crapNoRun.why).toBe(
      "pytest is not in this repository's environment. Add it with uv add --dev pytest.",
    );
    expect(r.crapNoRun).toMatchObject({ beneath: false });
    expect(r.mutationRed.state).toMatch(/^failed/);
    expect(r.mutationRed.tone).toBe("bad");
    expect(r.mutationRed.why).toContain("tests/test_orders.py::test_refund");
    expect(r.mutationRed).toMatchObject({ beneath: false, log: "log" });
    expect(r.mutationNoCov.state).toMatch(/^failed/);
    expect(r.mutationNoCov).toMatchObject({ beneath: false });
  });

  it("keeps each second line inside its row and clear of the next row", () => {
    const r = f.reasons;

    for (const one of [
      r.crapRed,
      r.crapNoCov,
      r.crapNoRun,
      r.mutationRed,
      r.mutationNoCov,
    ]) {
      expect(one.beneath).toBe(false);
      expect(one.oneLine).toBe(true);
      expect(one.clear).not.toBe(false);
    }
  });

  it("opens the sensors' log through the editor and copies the bare fix", () => {
    expect(f.reasons.opened).toEqual([
      ".recognizer/cache/coverage/last-run.log",
    ]);
  });

  it("shows a refusal remembered from the run log after a restart, with its reason, Copy and Show log, and nothing else changes", () => {
    const r = f.restart;

    expect(r.refused.state).toMatch(/^failed/);
    expect(r.refused.tone).toBe("bad");
    expect(r.refused.why).toBeTruthy();
    expect(r.refused.log).toBe("log");
    expect(r.copy.why).toBeTruthy();
    expect(r.refused.beneath).toBe(false);

    for (const one of [r.okNewer, r.none, r.older, r.tie]) {
      expect(one.state).toMatch(SHORT_AGE);
      expect(one.why).toBeNull();
    }
  });

  it("shows each distinct settings-error reason once, wrapped inside the panel", () => {
    expect(f.settingsError.label).toBe("settings error");
    expect(f.settingsError.occurrences).toBe(1);
    expect(f.settingsError.fitsRight).toBe(true);
    expect(f.settingsError.unclipped).toBe(true);
    expect(f.settingsError.belowLabel).toBe(true);
  });

  it("shows failed and no second line for a failure with no diagnosis", () => {
    expect(f.reasons.plain.state).toMatch(/^failed/);
    expect(f.reasons.plain.why).toBeNull();
  });

  it("remembers the switch through the port and sends the view's file ids when it is on, and a click on Run with the scope off runs the still-ticked sensor on the whole repository", () => {
    expect(f.scopeOn.written.onlyView).toBe(true);
    expect(f.scopeRan.modules).toEqual([["app/a.py"]]);
    expect(f.scopeOffRan).toEqual([["app/a.py"], ["app/a.py", "app/b.py"]]);
  });

  it("remembers a tick, a tests-running sensor's tick and a suite tick through the port, and a reopened window reads them back", () => {
    expect(f.ticked.rows).toEqual(["structure", "describe", "crap", "tally"]);
    expect(f.ticked.written).toEqual({
      describe: true,
      analysis: true,
      ticked: ["tally", "crap"],
      onlyView: false,
      suites: {},
      folds: [],
    });
    expect(f.reopened).toEqual(["structure", "describe", "crap", "tally"]);
    expect(f.suiteStart.crap).toEqual({
      ticked: false,
      indeterminate: false,
      state: "none",
    });
    expect(f.suiteStart.fold.open).toBe(false);
    expect(f.suiteOpened.suites.map((s: Facts) => s.name)).toEqual([
      "unit",
      "a-suite-with-a-very-long-name-indeed",
      "web",
    ]);
    expect(f.suiteFoldWritten).toEqual(["crap"]);
    expect(f.suiteAfterTick.written.suites.crap).toEqual({
      ticked: ["unit"],
      known: ["unit", "a-suite-with-a-very-long-name-indeed", "web"],
    });
    expect(f.suiteAfterTick.sensor).toMatchObject({
      ticked: false,
      indeterminate: true,
    });
    expect(f.suiteReopened.fold.open).toBe(false);
    expect(f.suiteReopened.sensor).toMatchObject({
      ticked: false,
      indeterminate: true,
    });
  });

  it("draws a suite whose covered file changed in the out-of-date style of the sensor row and leaves an up-to-date suite ok", () => {
    const r = f.suiteStale;

    expect(r.currentKind).toBe("ok");
    expect(r.current.title).toMatch(/^current, /);
    expect(r.behindKind).toBe("stale");
    expect(r.behind.text).toBe("1 out of date");
    expect(r.behind.title).toMatch(/^1 file out of date, ran /);
    expect(r.behind.icon).toBe(r.alert);
    expect(r.behind.className).toContain("warn");
    expect(r.current.icon).not.toBe(r.behind.icon);
  });

  it("ticks every suite with the sensor and shows the sensor and its suites still ticked after a scan", () => {
    expect(f.suiteArmed).toMatchObject({ ticked: true, indeterminate: false });
    expect(f.suiteAfterScan.plan.suites).toEqual({
      crap: ["unit", "a-suite-with-a-very-long-name-indeed", "web"],
    });
    expect(f.suiteAfterScan.sensor.ticked).toBe(true);
    expect(f.suiteAfterScan.sensor.indeterminate).toBe(false);
    expect(f.suiteAfterScan.fold.open).toBe(false);
  });

  it("shows the estimate line under the primary button with its breakdown on hover, and hides it when nothing is ticked", () => {
    expect(f.estimateTicked).not.toBeNull();
    expect(f.estimateTicked.exists).toBe(true);
    expect(f.estimateTicked.hidden).toBe(false);
    expect(f.estimateTicked.afterButtons).toBe(true);
    expect(f.estimateTicked.text).toBe("About 3 min");
    expect(f.estimateTicked.title).toBe(
      "Structural analysis: <1 min (last run)\nMutation: 3 min (2 functions at recent pace)",
    );
    expect(f.estimateUnticked.hidden).toBe(true);
  });

  it("reads Mutation as no estimate yet while the sensor's work answer is pending, and a figure after", () => {
    expect(f.estimatePending.hidden).toBe(false);
    expect(f.estimatePending.text).toBe(
      "Under a minute, plus Mutation: no estimate yet",
    );
    expect(f.estimatePending.title).toContain("Mutation: no estimate yet");
    expect(f.estimateTicked.text).toBe("About 3 min");
  });

  it("summarises one sensor-out-of-date file with no bar and Update 1 file, then everything current with a disabled Up to date once the hashes match", () => {
    expect(f.freshPartial.summary).toMatchObject({
      shape: "behind",
      tone: "warn",
      head: "C.R.A.P. is out of date on 1 file",
      bar: 0,
    });
    expect(f.freshPartial.rowBars).toBe(0);
    expect(f.freshPartial.rows).toEqual([
      { state: "1 file out of date", note: null },
    ]);
    expect(f.freshPartial.button).toBe("Update 1 file");
    expect(f.freshPartial.disabled).toBe(false);
    expect(f.freshPartial.secondary).toBe(0);
    expect(f.freshPartial.mode).toBe("Incremental");
    expect(f.freshPartial.oldSwitch).toBe(0);
    expect(f.freshComplete.summary).toMatchObject({
      shape: "current",
      tone: "ok",
      head: "Everything on the repository is current",
      bar: 0,
    });
    expect(f.freshComplete.rowBars).toBe(0);
    expect(f.freshComplete.button).toBe("Up to date");
    expect(f.freshComplete.disabled).toBe(true);
  });

  it("lists a report after the list with no checkbox, its age and short commit, and a Clear button that deletes it", () => {
    expect(f.report.names).toEqual(NAMES);
    expect(f.report.listCount).toBe(7);
    expect(f.report.ticks).toBe(0);
    expect(f.report.chip).toBe("reported 3 minutes ago");
    expect(f.report.commit).toBe("feed123");
    expect(f.report.clear).toBe("Clear");
    expect(f.report.afterList).toBe(true);
    expect(f.reportCleared.removed).toEqual(["review"]);
    expect(f.reportCleared.present).toBe(false);
  });
});
