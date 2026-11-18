import { buildChanges, policyCommands, type Survey } from "recognizer";
import { describe, expect, it } from "vitest";
import {
  CLEAN_DOCTOR,
  type FakeSetup,
  fakeSetup,
  LOOM_SURVEY,
  RECOMMENDATION,
} from "./setup-fake";
import {
  choicesOf,
  createSetupController,
  currentKey,
  isSkipped,
  SETUP_STEPS,
  type SetupController,
  type StepKey,
  testsWanted,
  type WizardState,
} from "./setup-model";

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
    await controller.askClaude();
    expect(wizard(controller).policy.kind).toBe("done");

    controller.next();
    expect(currentKey(wizard(controller))).toBe("review");
  });

  it("an accepted card contributes exactly its commands and a rejected or undecided one none", async () => {
    const { controller } = await opened();

    controller.setPolicyMode("ask");
    await controller.askClaude();

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

    expect(fake.calls.filter((call) => call === "stop_setup")).toHaveLength(1);
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

    expect(fake.calls.filter((call) => call === "stop_setup")).toHaveLength(1);
    expect(wizard(controller).tried.kind).toBe("done");
  });
});
