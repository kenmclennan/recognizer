import { describe, expect, it } from "vitest";
import { findDescriberGaps } from "../src/application/describing/find-describer-gaps.js";
import { findCommitGaps } from "../src/application/sensing/find-commit-gaps.js";
import { findProgramGaps } from "../src/application/sensing/find-program-gaps.js";
import { findReadinessGaps } from "../src/application/sensing/find-readiness-gaps.js";
import {
  type DescriberBuild,
  noneRegistered,
  type PluginLimits,
  type SensorReport,
} from "../src/index.js";
import { createFakes } from "./fakes/container.js";

const SENSE = ["recognizer", "sense", ""].join("-");
const DESCRIBE = ["recognizer", "describe", ""].join("-");

const FIRST_COMMIT =
  "make the first commit (git add the files, then git commit)";

function sensor(name: string) {
  return { name, command: [`${SENSE}${name}`, "run"] };
}

function sensing() {
  const fakes = createFakes();

  return {
    fakes,
    ports: {
      sensors: fakes.sensors,
      config: fakes.config,
      clock: fakes.clock,
      catalog: fakes.catalog,
      files: fakes.files,
    },
  };
}

function install(fakes: ReturnType<typeof createFakes>, name: string): void {
  fakes.sensors.installed.set(name, {
    name,
    runsTests: false,
    held: false,
  });
}

describe("no-commit gap", () => {
  it("names every ticked sensor and the first-commit fix", () => {
    expect(
      findCommitGaps({
        commit: null,
        sensors: [sensor("ruler"), sensor("tally")],
      }),
    ).toEqual([
      {
        id: "no-commit",
        line: "the folder has no git commit",
        needs: ["ruler", "tally"],
        fix: {
          text: FIRST_COMMIT,
          command: null,
          cwd: "",
          env: {},
          kind: "outside",
        },
      },
    ]);
  });

  it("is absent with no sensors or with a commit", () => {
    expect(findCommitGaps({ commit: null, sensors: [] })).toEqual([]);
    expect(
      findCommitGaps({ commit: "c0ffee", sensors: [sensor("ruler")] }),
    ).toEqual([]);
  });
});

describe("program gaps", () => {
  it("reports an installed sensor whose program is missing or exits non-zero", () => {
    const { fakes, ports } = sensing();

    install(fakes, "ruler");
    install(fakes, "tally");
    install(fakes, "pencil");
    fakes.sensors.unavailable.add("tally");

    const gaps = findProgramGaps(ports, {
      sensors: [
        sensor("ruler"),
        sensor("tally"),
        { name: "own", command: ["own", "run"] },
      ],
      install: {},
    });

    expect(gaps).toEqual([
      {
        id: "sensors:missing:tally",
        line: `${SENSE}tally is not installed`,
        needs: ["tally"],
        fix: {
          text: `install ${SENSE}tally`,
          command: null,
          cwd: "",
          env: {},
          kind: "outside",
        },
      },
    ]);
  });

  it("counts a started program with a non-zero status as a gap", () => {
    const { fakes, ports } = sensing();

    install(fakes, "ruler");
    ports.sensors.probe = () => ({ started: true, status: 3 });

    expect(
      findProgramGaps(ports, { sensors: [sensor("ruler")], install: {} }).map(
        (one) => one.id,
      ),
    ).toEqual(["sensors:missing:ruler"]);
  });

  it("uses the install map entry when present", () => {
    const { fakes, ports } = sensing();

    install(fakes, "ruler");
    fakes.sensors.unavailable.add("ruler");

    const [gap] = findProgramGaps(ports, {
      sensors: [sensor("ruler")],
      install: { [`${SENSE}ruler`]: "brew install ruler" },
    });

    expect(gap?.fix.text).toBe("brew install ruler");
  });
});

describe("readiness gaps", () => {
  const limits = {} as PluginLimits;

  function report(gaps: SensorReport["gaps"], ready: boolean): SensorReport {
    return { name: "ruler", ready, checked: true, gaps, notes: [] };
  }

  it("builds an id from the suite or config and points at the help", () => {
    const { fakes, ports } = sensing();

    fakes.sensors.reports.push(
      report(
        [
          { code: "no-runner", suite: "unit", line: "unit has no runner" },
          { code: "no-setting", suite: null, line: "ruler has no setting" },
        ],
        false,
      ),
    );

    const fix = {
      text: "recognizer help sensors ruler",
      command: null,
      cwd: "",
      env: {},
      kind: "outside",
    };

    expect(
      findReadinessGaps(ports, {
        root: "/work",
        commit: "c0ffee",
        sensors: [sensor("ruler")],
        limits,
      }),
    ).toEqual([
      {
        id: "ruler:unit:no-runner",
        line: "unit has no runner",
        needs: ["ruler"],
        fix,
      },
      {
        id: "ruler:config:no-setting",
        line: "ruler has no setting",
        needs: ["ruler"],
        fix,
      },
    ]);
  });

  it("is empty for a ready report and with no commit", () => {
    const { fakes, ports } = sensing();
    const input = {
      root: "/work",
      sensors: [sensor("ruler")],
      limits,
    };

    fakes.sensors.reports.push(report([], true));

    expect(findReadinessGaps(ports, { ...input, commit: "c0ffee" })).toEqual(
      [],
    );

    fakes.sensors.reports.push(
      report([{ code: "x", suite: null, line: "x" }], false),
    );

    expect(findReadinessGaps(ports, { ...input, commit: null })).toEqual([]);
  });
});

describe("describer gaps", () => {
  function describing(command: string[] | null) {
    const fakes = createFakes();

    fakes.describer.registered = command !== null;

    if (command !== null) {
      fakes.describer.command = command;
    }

    return {
      fakes,
      ports: {
        describer: fakes.describer,
        confirm: fakes.confirm,
        clock: fakes.clock,
      },
    };
  }

  function gapsOf(
    world: ReturnType<typeof describing>,
    describe = true,
    install: Record<string, string> = {},
    build: DescriberBuild | null = null,
  ) {
    return findDescriberGaps(world.ports, {
      root: "/work",
      describe,
      located: world.fakes.describer.locate(),
      install,
      build,
    });
  }

  it("is empty when describing is off", () => {
    expect(gapsOf(describing(null), false)).toEqual([]);
  });

  it("reports a missing describer with the registration instruction", () => {
    expect(gapsOf(describing(null))).toEqual([
      {
        id: "describe:missing",
        line: "no describer is registered",
        needs: ["describe"],
        fix: {
          text: noneRegistered(),
          command: null,
          cwd: "",
          env: {},
          kind: "outside",
        },
      },
    ]);
  });

  it("reports a reference describer with no run element", () => {
    const [gap] = gapsOf(describing([`${DESCRIBE}claude`]));

    expect(gap?.id).toBe("describe:arguments");
    expect(gap?.line).toBe(
      "the describer does not speak the plugin verbs: its command has no run element",
    );
    expect(gap?.fix.text).toBe(`install ${DESCRIBE}claude`);
  });

  it("reports a failing check with the declared build fix", () => {
    const world = describing(["node", "/work/x/dist/bin.js", "run"]);

    world.fakes.describer.unavailable.add("node");

    const [gap] = gapsOf(
      world,
      true,
      {},
      {
        command: ["make", "all"],
        directory: "tools/d",
      },
    );

    expect(gap?.line).toBe(
      "the describer rejects the arguments the scan passes",
    );
    expect(gap?.fix).toEqual({
      text: "make all",
      command: ["make", "all"],
      cwd: "tools/d",
      env: {},
      kind: "repository",
    });
  });

  it("falls back to the install fix when no build is declared", () => {
    const world = describing(["node", "/work/x/dist/bin.js", "run"]);

    world.fakes.describer.unavailable.add("node");

    const [gap] = gapsOf(world);

    expect(gap?.fix).toEqual({
      text: "install node",
      command: null,
      cwd: "",
      env: {},
      kind: "outside",
    });
  });

  it("holds a reference-prefixed describer to the arguments check without a build", () => {
    const world = describing([`${DESCRIBE}claude`]);

    const [gap] = gapsOf(world);

    expect(gap?.id).toBe("describe:arguments");
    expect(gap?.fix.text).toBe(`install ${DESCRIBE}claude`);
  });

  it("reports a non-reference describer that does not start, and only that", () => {
    const world = describing(["quill", "run"]);

    expect(gapsOf(world)).toEqual([]);

    world.fakes.describer.unavailable.add("quill");

    expect(gapsOf(world, true, { quill: "brew install quill" })).toEqual([
      {
        id: "describe:program",
        line: "the describer program quill does not start",
        needs: ["describe"],
        fix: {
          text: "brew install quill",
          command: null,
          cwd: "",
          env: {},
          kind: "outside",
        },
      },
    ]);
  });
});
