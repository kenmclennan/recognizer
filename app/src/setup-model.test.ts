import { describe, expect, it } from "vitest";
import { CLEAN_DOCTOR, fakeSetup } from "./setup-fake";
import {
  canApply,
  createSetupController,
  doctorProblems,
  type ReportState,
  sectionCounts,
  sectionsOf,
} from "./setup-model";
import type { DoctorRead } from "./setup-port";

const DOCTOR_2: DoctorRead = {
  status: "ok",
  report: {
    ...(CLEAN_DOCTOR as { report: object }).report,
    problems: 2,
  } as never,
};

const PROPOSAL = {
  summary: "s",
  changes: [
    {
      section: "problems",
      title: "Drop key",
      reason: "r",
      commands: [["recognizer", "config", "--unset", "a.b"]],
    },
    {
      section: "tests",
      title: "Run suites",
      reason: "r",
      commands: [["recognizer", "sensors", "check", "--run"]],
    },
    {
      section: "policy",
      title: "Draft",
      reason: "r",
      commands: [["recognizer", "policy", "--add", "levels", "core"]],
    },
  ],
};

function controller(fake = fakeSetup({ doctor: DOCTOR_2 })) {
  const doctors: DoctorRead[] = [];
  const one = createSetupController({
    port: fake,
    readModel: async () => "sonnet",
    onDoctor: (read) => doctors.push(read),
  });

  return { fake, one, doctors };
}

async function reported() {
  const fake = fakeSetup({
    doctor: DOCTOR_2,
    checkResult: {
      status: "proposal",
      output: PROPOSAL,
      costUsd: 0.5,
      durationMs: 12000,
      denials: 0,
    },
  });
  const made = controller(fake);

  await made.one.open();
  await made.one.check();

  return made;
}

describe("the setup modal model", () => {
  it("runs doctor and nothing else when it opens", async () => {
    const { fake, one, doctors } = controller();

    await one.open();

    expect(fake.calls).toEqual(["read_doctor"]);
    expect(one.state()).toMatchObject({ kind: "start", model: "sonnet" });
    expect(doctors).toHaveLength(1);
    expect(doctorProblems(doctors[0] ?? null)).toBe(2);
  });

  it("ignores a second Check click while a check is live", async () => {
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const fake = fakeSetup({ doctor: DOCTOR_2, gate });
    const { one } = controller(fake);

    await one.open();

    const first = one.check();

    await one.check();
    await one.check();

    expect(one.state().kind).toBe("checking");
    expect(
      fake.calls.filter((call) => call === "run_setup_check"),
    ).toHaveLength(1);

    open();
    await first;
  });

  it("passes the doctor result and the budget from the model's estimate", async () => {
    const { fake } = await reported();

    expect(fake.prompts[0]).toContain('"problems": 2');
    expect(fake.budgets).toEqual([2.08]);
  });

  it("shows progress lines while checking and returns to start on cancel", async () => {
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const fake = fakeSetup({
      doctor: DOCTOR_2,
      gate,
      progress: ["Read a", "Bash b"],
    });
    const { one } = controller(fake);

    await one.open();

    const running = one.check();

    expect(one.state()).toMatchObject({
      kind: "checking",
      lines: ["Read a", "Bash b"],
    });

    await one.cancel();
    await running;

    expect(fake.stopped).toBe(1);
    expect(one.state().kind).toBe("start");
    open();
  });

  it("builds the report with ticks derived from the commands", async () => {
    const { one } = await reported();
    const state = one.state() as ReportState;

    expect(state.kind).toBe("report");
    expect(state.ticks).toEqual([true, false, false]);
    expect(sectionsOf(state)).toEqual(["problems", "tests", "policy"]);
    expect(sectionCounts(state, "problems")).toEqual({ ticked: 1, total: 1 });
    expect(sectionCounts(state, "tests")).toEqual({ ticked: 0, total: 1 });
    expect(state.costUsd).toBe(0.5);
  });

  it("disables Apply with nothing ticked", async () => {
    const { one } = await reported();

    expect(canApply(one.state())).toBe(true);

    one.toggle(0);

    expect(canApply(one.state())).toBe(false);

    await one.apply();

    expect(one.state().kind).toBe("report");
  });

  it("applies exactly the ticked commands and shows doctor's result", async () => {
    const { fake, one, doctors } = await reported();

    one.toggle(1);
    await one.apply();

    expect(fake.ran).toEqual([
      ["recognizer", "config", "--unset", "a.b"],
      ["recognizer", "sensors", "check", "--run"],
    ]);
    expect(one.state()).toMatchObject({
      kind: "applied",
      outcome: { status: "applied", applied: 2, total: 2 },
    });
    expect(doctors).toHaveLength(2);
    expect(
      fake.calls.filter((call) => call === "run_setup_check"),
    ).toHaveLength(1);
  });

  it("leaves the ticks as they were after a failed apply", async () => {
    const { fake, one } = await reported();

    fake.failing = () => ({ code: 1, stderr: "boom" });
    one.toggle(2);
    await one.apply();

    const applied = one.state();

    expect(applied).toMatchObject({
      kind: "applied",
      outcome: { status: "failed", applied: 0, total: 2, stderr: "boom" },
    });

    one.back();

    expect((one.state() as ReportState).ticks).toEqual([true, false, true]);
  });

  it("shows an error and no report for a proposal of the wrong shape", async () => {
    const fake = fakeSetup({
      doctor: DOCTOR_2,
      checkResult: {
        status: "proposal",
        output: [1],
        costUsd: 0.1,
        durationMs: 5,
        denials: 0,
      },
    });
    const { one } = controller(fake);

    await one.open();
    await one.check();

    expect(one.state()).toMatchObject({ kind: "error", costUsd: 0.1 });
  });

  it("shows a failed check with its reason and cost", async () => {
    const fake = fakeSetup({
      doctor: DOCTOR_2,
      checkResult: {
        status: "failed",
        reason: "over budget",
        subtype: "error_max_budget_usd",
        costUsd: 2.1,
        durationMs: 9,
      },
    });
    const { one } = controller(fake);

    await one.open();
    await one.check();

    expect(one.state()).toMatchObject({
      kind: "error",
      message: "over budget",
      detail: "error_max_budget_usd",
    });
  });

  it("shows nothing to change for a proposal with no change", async () => {
    const fake = fakeSetup({
      doctor: DOCTOR_2,
      checkResult: {
        status: "proposal",
        output: { changes: [] },
        costUsd: 0.2,
        durationMs: 5,
        denials: 0,
      },
    });
    const { one } = controller(fake);

    await one.open();
    await one.check();

    const state = one.state() as ReportState;

    expect(state.kind).toBe("report");
    expect(sectionsOf(state)).toEqual([]);
    expect(canApply(state)).toBe(false);
  });

  it("keeps the shared fake honest: a refused command, a failure part way, a live scan", async () => {
    const fake = fakeSetup({ doctor: DOCTOR_2 });

    expect((await fake.apply([["npm", "test"]])).outcome.status).toBe(
      "refused",
    );

    fake.failing = (argv) =>
      argv[3] === "b" ? { code: 2, stderr: "bad" } : null;

    expect(
      (
        await fake.apply([
          ["recognizer", "config", "--unset", "a"],
          ["recognizer", "config", "--unset", "b"],
          ["recognizer", "config", "--unset", "c"],
        ])
      ).outcome,
    ).toMatchObject({ status: "failed", applied: 1, total: 3 });
    expect(fake.ran).toHaveLength(1);

    fake.scanLive = true;

    expect((await fake.apply([["recognizer", "scan"]])).outcome.status).toBe(
      "refused",
    );
  });
});
