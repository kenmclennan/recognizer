import {
  type ConfigurationPorts,
  readSetup,
  surveySetup,
} from "@recognizer/core";
import {
  type ApplyEvent,
  buildChanges,
  type DoctorReport,
  policyCommands,
  type SetupProblem,
  type Survey,
} from "recognizer";
import { describe, expect, it } from "vitest";
import {
  choicesOf,
  createSetupController,
  currentKey,
  fixChoicesOf,
  isSkipped,
  lineCount,
  linesLabel,
  SETUP_STEPS,
  type SetupController,
  type StepKey,
  testRunnerNames,
  testsWanted,
  type WizardState,
} from "../../src/setup-model";
import type { SetupLine } from "../../src/setup-progress";
import {
  CLEAN_DOCTOR,
  type FakeSetup,
  fakeSetup,
  LOOM_SURVEY,
  RECOMMENDATION,
} from "../setup-fake";

function counting(fake: FakeSetup) {
  const seen = { sensors: 0, doctors: 0, scans: 0 };
  const controller = createSetupController({
    port: fake,
    reloadSensors: () => {
      seen.sensors += 1;
    },
    scanAfterApply: () => {
      seen.scans += 1;
    },
    onDoctor: () => {
      seen.doctors += 1;
    },
  });

  return { controller, seen };
}

function wizard(controller: SetupController): WizardState {
  const state = controller.state();

  if (state.kind !== "wizard") {
    throw new Error(`state is ${state.kind}`);
  }

  return state;
}

function advanceTo(controller: SetupController, key: StepKey): void {
  for (
    let guard = 0;
    guard < 10 && currentKey(wizard(controller)) !== key;
    guard++
  ) {
    controller.next();
  }

  expect(currentKey(wizard(controller))).toBe(key);
}

async function opened(fake: FakeSetup = fakeSetup()) {
  const made = counting(fake);

  await made.controller.open();

  return { ...made, fake };
}

describe("the setup wizard model", () => {
  it("opens by running the survey and doctor and nothing costly", async () => {
    const { controller, fake, seen } = await opened();

    expect(fake.calls).toEqual(["survey+extract"]);
    expect(currentKey(wizard(controller))).toBe("files");
    expect(seen.doctors).toBe(1);
  });

  it("shows the reason when the survey cannot be read", async () => {
    const { controller } = await opened(
      fakeSetup({
        surveyRead: { status: "unavailable", reason: "no recognizer" },
      }),
    );

    expect(controller.state()).toEqual({
      kind: "unavailable",
      reason: "no recognizer",
    });
  });

  it("starts a runner's env from the survey and sends an emptied one as nothing", async () => {
    const withEnv: Survey = {
      ...LOOM_SURVEY,
      runners: LOOM_SURVEY.runners.map((runner, at) =>
        at === 0 ? { ...runner, env: { NODE_CONFIG_DIR: "./config" } } : runner,
      ),
    };
    const { controller } = await opened(
      fakeSetup({
        surveyRead: { status: "ok", survey: withEnv, doctor: CLEAN_DOCTOR },
      }),
    );
    const name = withEnv.runners[0]?.name as string;

    expect(wizard(controller).runners[name]?.on).toBe(true);
    expect(wizard(controller).runners[name]?.env).toEqual([
      ["NODE_CONFIG_DIR", "./config"],
    ]);

    controller.removeEnv(name, 0);

    const sent = choicesOf(wizard(controller)).runners?.find(
      (runner) => runner.name === name,
    );

    expect(sent?.env).toEqual({});
  });

  it("skips Tests when no chosen check runs tests", async () => {
    const { controller } = await opened();

    expect(testsWanted(wizard(controller))).toBe(true);
    expect(isSkipped(wizard(controller), "tests")).toBe(false);

    controller.setPlugin("crap", false);
    controller.setPlugin("mutation", false);

    expect(isSkipped(wizard(controller), "tests")).toBe(true);

    advanceTo(controller, "policy");

    expect(currentKey(wizard(controller))).toBe("policy");
    controller.back();
    expect(currentKey(wizard(controller))).toBe("checks");

    const plain: Survey = {
      ...LOOM_SURVEY,
      checks: LOOM_SURVEY.checks.map((check) => ({
        ...check,
        runs_tests: false,
      })),
    };
    const second = await opened(
      fakeSetup({
        surveyRead: { status: "ok", survey: plain, doctor: CLEAN_DOCTOR },
      }),
    );

    expect(isSkipped(wizard(second.controller), "tests")).toBe(true);
    expect(choicesOf(wizard(second.controller)).runners).toEqual([]);
    expect(choicesOf(wizard(second.controller)).tools).toEqual([]);
  });

  it("disables Next on Policy with Ask chosen and not run, and enables it after Skip or a run", async () => {
    const { controller } = await opened();

    advanceTo(controller, "policy");
    expect(wizard(controller).policyMode).toBe("skip");

    controller.setPolicyMode("ask");
    controller.next();
    expect(currentKey(wizard(controller))).toBe("policy");

    controller.setPolicyMode("skip");
    controller.next();
    expect(currentKey(wizard(controller))).toBe("review");

    controller.back();
    controller.setPolicyMode("ask");
    await controller.askAssistant();
    expect(wizard(controller).policy.kind).toBe("done");

    controller.next();
    expect(currentKey(wizard(controller))).toBe("review");
  });

  it("an accepted card contributes exactly its commands and a rejected or undecided one none", async () => {
    const { controller } = await opened();

    controller.setPolicyMode("ask");
    await controller.askAssistant();

    expect(
      buildChanges(LOOM_SURVEY, choicesOf(wizard(controller))).changes.filter(
        (one) => one.id.startsWith("policy"),
      ),
    ).toEqual([]);

    controller.decide(0, "accept");
    controller.decide(1, "reject");
    controller.decide(3, "accept");

    const policy = buildChanges(
      LOOM_SURVEY,
      choicesOf(wizard(controller)),
    ).changes.filter((one) => one.id.startsWith("policy"));
    const [first, , , fourth] = RECOMMENDATION.entries;

    expect(policy.map((one) => one.id)).toEqual(["policy-1", "policy-2"]);
    expect(policy[0]?.steps.map((one) => one.argv)).toEqual(
      policyCommands(first as never),
    );
    expect(policy[1]?.steps.map((one) => one.argv)).toEqual(
      policyCommands(fourth as never),
    );
  });

  it("a configured repository opens on Files and lists doctor's fixes", async () => {
    const fixes = ["config-retired", "config-empty", "policy-retired"].map(
      (code, at) => ({
        code,
        subject: `k${at}`,
        title: `title ${code}`,
        line: `fix ${code}`,
        fix_text: `fix ${code}`,
        command: `recognizer config --unset k${at}`,
      }),
    );
    const survey: Survey = { ...LOOM_SURVEY, configured: true, fixes };
    const { controller, fake } = await opened(
      fakeSetup({ surveyRead: { status: "ok", survey, doctor: CLEAN_DOCTOR } }),
    );
    const state = wizard(controller);

    expect(SETUP_STEPS).toHaveLength(6);
    expect(currentKey(state)).toBe("files");
    expect(state.fixes).toEqual([true, true, true]);

    controller.setFix(1, false);
    advanceTo(controller, "review");
    await controller.apply();

    expect(fake.applied[0]?.fixes).toEqual([
      "recognizer config --unset k0",
      "recognizer config --unset k2",
    ]);
  });

  it("a text-only fix is never applied", async () => {
    const survey: Survey = {
      ...LOOM_SURVEY,
      configured: true,
      fixes: [
        {
          code: "config-duplicate-suite",
          subject: "unit",
          title: "t",
          line: "l",
          fix_text: "rename it",
          command: null,
        },
      ],
    };
    const { controller } = await opened(
      fakeSetup({ surveyRead: { status: "ok", survey, doctor: CLEAN_DOCTOR } }),
    );

    expect(wizard(controller).fixes).toEqual([true]);
    expect(choicesOf(wizard(controller)).fixes).toEqual([]);
  });

  it("starts set-up checks and gone suites ticked and new checks unticked", async () => {
    const survey: Survey = {
      ...LOOM_SURVEY,
      configured: true,
      checks: LOOM_SURVEY.checks.map((check) =>
        check.id === "crap"
          ? { ...check, enabled: true, mark: "set-up" as const }
          : check.id === "mutation"
            ? { ...check, enabled: false, mark: "new" as const }
            : check,
      ),
      suites: [
        {
          name: "legacy",
          language: "python",
          directory: "legacy",
          command: "pytest",
          mark: "gone",
        },
      ],
    };
    const { controller } = await opened(
      fakeSetup({ surveyRead: { status: "ok", survey, doctor: CLEAN_DOCTOR } }),
    );
    const state = wizard(controller);

    expect(state.plugins.crap).toBe(true);
    expect(state.plugins.mutation).toBe(false);
    expect(state.removals).toEqual({ legacy: true });
    expect(choicesOf(state).remove_suites).toEqual(["legacy"]);
    expect(choicesOf(state).plugins_off).toEqual([]);

    controller.setRemoval("legacy", false);
    controller.setPlugin("crap", false);

    expect(choicesOf(wizard(controller)).remove_suites).toEqual([]);
    expect(choicesOf(wizard(controller)).plugins_off).toEqual(["crap"]);
  });

  it("applies exactly the chosen changes and shows doctor's result", async () => {
    const { controller, fake } = await opened();

    controller.setPlugin("mutation", false);
    controller.setLimit("long_function", 30);
    advanceTo(controller, "review");

    const before = buildChanges(
      LOOM_SURVEY,
      choicesOf(wizard(controller)),
    ).changes;

    await controller.apply();

    const state = wizard(controller);

    expect(fake.applied).toHaveLength(1);
    expect(fake.applied[0]).toEqual(choicesOf(state));
    expect(state.apply?.state).toBe("done");
    expect(state.apply?.rows.map((row) => row.title)).toEqual(
      before.map((change) => change.title),
    );
    expect(state.apply?.rows.every((row) => row.state === "done")).toBe(true);
    expect(state.apply?.doctor?.status).toBe("ok");
    expect(before.some((change) => change.id === "plugin-mutation")).toBe(
      false,
    );
    expect(
      before.some((change) => change.id === "analysis-long_function"),
    ).toBe(true);
  });

  it("leaves the choices as they were after a failed apply", async () => {
    const { controller, fake, seen } = await opened(fakeSetup({ failAt: 2 }));

    advanceTo(controller, "review");

    const choices = choicesOf(wizard(controller));

    await controller.apply();

    const state = wizard(controller);

    expect(state.apply?.state).toBe("failed");
    expect(state.apply?.rows.map((row) => row.state).slice(0, 3)).toEqual([
      "undone",
      "undone",
      "failed",
    ]);
    expect(choicesOf(state)).toEqual(choices);
    expect(fake.applied).toHaveLength(1);
    expect(seen.sensors).toBe(0);

    controller.backToReview();
    expect(currentKey(wizard(controller))).toBe("review");
    expect(wizard(controller).apply).toBeNull();
  });

  it("re-reads the registry and doctor after apply", async () => {
    const { controller, seen } = await opened();

    expect(seen.sensors).toBe(0);
    expect(seen.doctors).toBe(1);

    advanceTo(controller, "review");
    await controller.apply();

    expect(seen.sensors).toBeGreaterThan(0);
    expect(seen.doctors).toBeGreaterThan(1);
  });

  it("starts one open-time scan after a successful apply", async () => {
    const { controller, seen } = await opened();

    advanceTo(controller, "review");
    await controller.apply();

    expect(seen.scans).toBe(1);
  });

  it("starts no scan after a failed apply or a Run once", async () => {
    const failed = await opened(fakeSetup({ failAt: 2 }));

    advanceTo(failed.controller, "review");
    await failed.controller.apply();

    expect(wizard(failed.controller).apply?.state).toBe("failed");
    expect(failed.seen.scans).toBe(0);

    const tried = await opened();

    advanceTo(tried.controller, "tests");
    await tried.controller.runOnce();

    expect(tried.seen.scans).toBe(0);
  });

  it("names each runner with its readiness after Run once", async () => {
    const { controller, fake } = await opened(
      fakeSetup({ notReady: { tauri: "tauri has no coverage" } }),
    );

    advanceTo(controller, "tests");
    await controller.runOnce();

    const tried = wizard(controller).tried;

    expect(fake.tried).toHaveLength(1);
    expect(tried.kind).toBe("done");

    if (tried.kind === "done") {
      expect(tried.ok).toBe(false);
      expect(tried.runners).toEqual([
        { name: "engine", ready: true, detail: "", output: "" },
        { name: "app", ready: true, detail: "", output: "" },
        {
          name: "tauri",
          ready: false,
          detail: "tauri has no coverage",
          output: "",
        },
      ]);
      expect(tried.rows.some((row) => row.state === "undone")).toBe(true);
    }
  });

  it("carries a not-ready runner's output into its result", async () => {
    const { controller } = await opened(
      fakeSetup({
        notReady: { tauri: "no report" },
        notReadyOutput: { tauri: "engine not built" },
      }),
    );

    advanceTo(controller, "tests");
    await controller.runOnce();

    const tried = wizard(controller).tried;

    expect(tried.kind).toBe("done");

    if (tried.kind === "done") {
      expect(tried.runners.map((one) => one.output)).toEqual([
        "",
        "",
        "engine not built",
      ]);
    }
  });

  it("calls stop once during Apply and ignores a second click", async () => {
    let open: () => void = () => {};
    const { controller, fake } = await opened(
      fakeSetup({
        gate: new Promise<void>((resolve) => {
          open = resolve;
        }),
      }),
    );

    advanceTo(controller, "review");

    const running = controller.apply();

    await new Promise((resolve) => setTimeout(resolve, 10));
    await controller.stop();
    await controller.stop();
    await running;
    open();

    expect(fake.calls.filter((call) => call === "setup.stop")).toHaveLength(1);
    expect(wizard(controller).apply?.state).toBe("stopped");
  });

  it("calls stop once during Run once and ignores a second click", async () => {
    const { controller, fake } = await opened(
      fakeSetup({ gate: new Promise<void>(() => {}) }),
    );

    advanceTo(controller, "tests");

    const running = controller.runOnce();

    await new Promise((resolve) => setTimeout(resolve, 10));
    await controller.stop();
    await controller.stop();
    await running;

    expect(fake.calls.filter((call) => call === "setup.stop")).toHaveLength(1);
    expect(wizard(controller).tried.kind).toBe("done");
  });

  it("moves the apply bar per command and shows the current row running before any event", async () => {
    let release: () => void = () => {};
    const { controller } = await opened(
      fakeSetup({
        holdAfterCommand: new Promise<void>((resolve) => {
          release = resolve;
        }),
      }),
    );

    advanceTo(controller, "review");

    const finished = controller.apply();

    await Promise.resolve();

    const held = wizard(controller).apply;
    const total = held?.rows.length ?? 0;

    expect(held?.rows[0]?.state).toBe("running");
    expect(held?.rows[0]?.step).toBe(1);
    expect(held?.rows[0]?.command).toBeTruthy();
    expect(held?.fill).toBeGreaterThan(0);
    expect(held?.fill).toBeLessThan(1);
    expect(total).toBeGreaterThan(1);

    release();
    await finished;

    const end = wizard(controller).apply;

    expect(end?.state).toBe("done");
    expect(end?.fill).toBe(1);
    expect(end?.checking.state).toBe("done");
    expect(end?.loading.state).toBe("done");
  });

  it("falls back to a bar per finished change when the toolchain sends no command events", async () => {
    const fake = fakeSetup();
    const base = fake.apply;
    const { controller } = await opened(fake);

    fake.apply = (choices, onEvent) =>
      base(choices, (event) => {
        if (event.event !== "command" && event.event !== "doctor") {
          onEvent(
            (event.event === "start"
              ? { event: "start", total: event.total }
              : event) as ApplyEvent,
          );
        }
      });
    advanceTo(controller, "review");
    await controller.apply();

    const end = wizard(controller).apply;

    expect(end?.state).toBe("done");
    expect(end?.fill).toBe(1);
    expect(end?.checking.state).toBe("done");
  });

  describe("fixing one problem from the done screen", () => {
    const problem = (
      code: SetupProblem["code"],
      subject: string,
      command: string | null,
    ): SetupProblem => ({
      code,
      subject,
      title: `Problem ${subject}`,
      line: "line",
      fix: { text: "fix it", command },
      severity: "problem",
    });
    const report = (...list: SetupProblem[]): DoctorReport => ({
      repository: "/repo",
      ok: list.length === 0,
      problems: list.length,
      warnings: 0,
      areas:
        list.length === 0
          ? []
          : [{ name: "config", skipped: null, problems: list }],
    });
    const fixable = problem(
      "config-retired",
      "k1",
      "recognizer config --unset k1",
    );
    const survey: Survey = {
      ...LOOM_SURVEY,
      fixes: [
        {
          code: "config-retired",
          subject: "k1",
          title: "Problem k1",
          line: "line",
          fix_text: "fix it",
          command: "recognizer config --unset k1",
        },
      ],
    };
    const finished = async (applyDoctor: DoctorReport) => {
      const fake = fakeSetup({
        surveyRead: { status: "ok", survey, doctor: CLEAN_DOCTOR },
        applyDoctor,
      });
      const made = await opened(fake);

      advanceTo(made.controller, "review");
      await made.controller.apply();

      return made;
    };

    it("pressing a problem's fix runs only that fix and re-reads doctor", async () => {
      const { controller, fake, seen } = await finished(report(fixable));
      const before = {
        applies: fake.calls.filter((call) => call === "apply").length,
        applied: fake.applied.length,
        sensors: seen.sensors,
        scans: seen.scans,
        doctors: seen.doctors,
      };

      fake.applyDoctor = report();
      await controller.fixProblem("config-retired:k1");

      expect(fake.applied.length).toBe(before.applied + 1);
      expect(fake.applied.at(-1)).toEqual({
        fixes: ["recognizer config --unset k1"],
      });
      expect(fake.calls.filter((call) => call === "apply").length).toBe(
        before.applies + 1,
      );
      expect(fake.calls).not.toContain("try");
      expect(wizard(controller).apply?.doctor).toEqual({
        status: "ok",
        report: report(),
      });
      expect(wizard(controller).apply?.fixed).toEqual(["config-retired:k1"]);
      expect(seen.sensors).toBe(before.sensors + 1);
      expect(seen.scans).toBe(before.scans + 1);
      expect(seen.doctors).toBe(before.doctors + 1);
    });

    it("ignores a second press while the first fix is running", async () => {
      const { controller, fake } = await finished(report(fixable));
      let release = () => {};

      fake.gate = new Promise<void>((resolve) => {
        release = resolve;
      });

      const first = controller.fixProblem("config-retired:k1");

      await Promise.resolve();

      const count = fake.applied.length;

      await controller.fixProblem("config-retired:k1");
      expect(fake.applied.length).toBe(count);
      expect(wizard(controller).apply?.fixing).toEqual({
        "config-retired:k1": "running",
      });

      fake.gate = null;
      release();
      await first;
    });

    it("marks a fix that leaves its problem in the report as failed", async () => {
      const { controller } = await finished(report(fixable));

      await controller.fixProblem("config-retired:k1");

      expect(wizard(controller).apply?.fixing).toEqual({
        "config-retired:k1": "failed",
      });
      expect(wizard(controller).apply?.fixed).toEqual([]);
    });

    it("does nothing for a problem with no runnable fix", async () => {
      const hand = problem("config-duplicate-suite", "unit", null);
      const { controller, fake } = await finished(report(hand));
      const count = fake.applied.length;

      await controller.fixProblem("config-duplicate-suite:unit");

      expect(fake.applied.length).toBe(count);
    });

    it("picks the fix choice for a problem", () => {
      const claude = {
        id: "claude",
        display: "Claude",
        description: "",
        always_on: false,
        enabled: false,
        runs_tests: false,
        kind: "describer" as const,
        limits: [],
        mark: null,
      };
      const withClaude: Survey = {
        ...survey,
        checks: [...survey.checks, claude],
      };

      expect(
        fixChoicesOf(
          withClaude,
          problem(
            "unregistered-plugin",
            "claude",
            "recognizer plugin add claude",
          ),
        ),
      ).toEqual({ plugins: ["claude"] });
      expect(fixChoicesOf(survey, fixable)).toEqual({
        fixes: ["recognizer config --unset k1"],
      });
      expect(
        fixChoicesOf(survey, problem("config-duplicate-suite", "unit", null)),
      ).toBeNull();
      expect(
        fixChoicesOf(survey, problem("config-retired", "k9", "recognizer x")),
      ).toBeNull();
    });

    it("counts the lines of an output", () => {
      expect(lineCount("")).toBe(0);
      expect(lineCount("a\nb\n")).toBe(2);
      expect(lineCount("a\nb")).toBe(2);
    });
  });

  it("labels one line singular and any other count plural", () => {
    expect(linesLabel(1)).toBe("1 line");
    expect(linesLabel(0)).toBe("0 lines");
    expect(linesLabel(3)).toBe("3 lines");
  });
});

describe("testRunnerNames", () => {
  it("names the checks that run tests, following the survey", () => {
    expect(testRunnerNames(LOOM_SURVEY)).toBe("C.R.A.P. or Mutation");

    const foo = {
      ...LOOM_SURVEY,
      checks: [
        {
          ...(LOOM_SURVEY.checks[0] as Survey["checks"][number]),
          id: "foo",
          display: "Foo",
          always_on: false,
          runs_tests: true,
        },
      ],
    };

    expect(testRunnerNames(foo)).toBe("Foo");
    expect(testRunnerNames({ ...LOOM_SURVEY, checks: [] })).toBe("");
  });
});

describe("a rerun of Setup on a configured repository", () => {
  const unregistered: SetupProblem = {
    code: "unregistered-plugin",
    subject: "claude",
    title: "The claude plugin is not registered",
    line: "claude is installed but not registered",
    fix: {
      text: "Register the plugin",
      command: "recognizer plugin add claude",
    },
    severity: "problem",
  };
  const doctor: DoctorReport = {
    repository: "/repo",
    ok: false,
    problems: 1,
    warnings: 0,
    areas: [{ name: "describers", skipped: null, problems: [unregistered] }],
  };
  const ports = {
    version: "0.0.0-test",
    files: {
      children: () => [],
      exists: () => false,
    },
    listing: { list: () => ({ from: "none", warning: null }) },
    config: {
      setupDocument: () => ({
        present: true,
        document: { sensors: { structure: {} } },
      }),
    },
    plugins: {
      answers: async () => [],
    },
    keys: { entries: () => [] },
    policy: { rules: () => [] },
    reads: {
      cachedScans: () => null,
      sensors: () => [],
      describers: () => [
        {
          name: "claude",
          display: "Claude",
          description: "",
          runs_tests: false,
        },
      ],
      languageRules: () => [],
      diagnose: () => doctor,
    },
  } as unknown as ConfigurationPorts;

  it("turns no plugin on when every default is accepted for a check the survey offers unticked", async () => {
    const survey = await surveySetup(ports, { root: "/repo" });
    const offered = survey.checks.find((check) => check.id === "claude");

    expect(offered?.mark).toBe("new");

    const fake = fakeSetup({
      surveyRead: {
        status: "ok",
        survey,
        doctor: { status: "ok", report: doctor },
      },
    });
    const { controller } = await opened(fake);

    expect(wizard(controller).plugins.claude).toBe(false);

    advanceTo(controller, "review");

    const reviewed = wizard(controller);
    const planned = buildChanges(reviewed.survey, choicesOf(reviewed)).changes;

    expect(reviewed.survey.fixes).toEqual([]);
    expect(choicesOf(reviewed).fixes).toEqual([]);
    expect(choicesOf(reviewed).plugins).not.toContain("claude");
    expect(planned.filter((change) => change.title.includes("claude"))).toEqual(
      [],
    );
  });
});

describe("Setup's opening screen on the survey events the service emits", () => {
  const event = (value: unknown) => JSON.stringify(value);
  const scanEvents = [
    event({
      event: "phase",
      phase: "extract",
      state: "run",
      commit: null,
      languages: ["typescript"],
    }),
    event({
      event: "plugin",
      phase: "extract",
      name: "typescript",
      data: { event: "start", total: 125, unit: "files" },
    }),
    event({
      event: "entry",
      phase: "extract",
      name: "typescript",
      outcome: "ok",
      modules: 3,
      edges: 2,
    }),
    event({ event: "structure", state: "run" }),
    event({ event: "structure", state: "done", files: 125 }),
  ];
  const doctor: DoctorReport = {
    repository: "/repo",
    ok: true,
    problems: 0,
    warnings: 0,
    areas: [],
  };
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const ports = {
    version: "0.0.0-test",
    files: { children: () => [], exists: () => false },
    listing: { list: () => ({ from: "none", warning: null }) },
    config: {
      setupDocument: () => ({ present: true, document: { sensors: {} } }),
    },
    plugins: { answers: async () => [] },
    keys: { entries: () => [] },
    policy: { rules: () => [] },
    reads: {
      cachedScans: () => null,
      sensors: () => [],
      describers: () => [],
      languageRules: () => [],
      diagnose: () => doctor,
    },
    scan: {
      extract: async (_root: string, onLine: (line: string) => void) => {
        for (const line of scanEvents) {
          onLine(line);

          await tick();
        }

        return { ok: true };
      },
    },
  } as unknown as ConfigurationPorts;

  it("keeps the read row pending until the scan row has finished", async () => {
    const fake = fakeSetup();
    const port: FakeSetup = {
      ...fake,
      survey: async (extract, onLine) => {
        const read = await readSetup(ports, {
          root: "/repo",
          extract,
          onLine: (text) => onLine(JSON.parse(text) as SetupLine),
        });

        return read as typeof fake.surveyRead;
      },
    };
    const seen: Array<{ scan: string; reading: string }> = [];
    const controller = createSetupController({
      port,
      reloadSensors: () => {},
      scanAfterApply: () => {},
    });

    controller.subscribe(() => {
      const state = controller.state();

      if (state.kind === "loading" && state.progress.scan !== null) {
        seen.push({
          scan: state.progress.scan.state,
          reading: state.progress.reading.state,
        });
      }
    });

    await controller.open();

    expect(seen.length).toBeGreaterThan(scanEvents.length);
    expect(seen.some((one) => one.scan === "running")).toBe(true);
    expect(
      seen.filter((one) => one.scan !== "done").map((one) => one.reading),
    ).not.toContain("running");
    expect(
      seen.filter((one) => one.scan !== "done").map((one) => one.reading),
    ).not.toContain("done");
  });
});
