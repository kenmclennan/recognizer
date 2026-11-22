import { describe, expect, it } from "vitest";
import { createPlanAnswers } from "../../src/plan-answers";
import type { PlanRequest, ScanPlanView } from "../../src/plan-reads";
import { NO_RUN, type PanelInput, scanPanel } from "../../src/scan-panel-model";
import { plainSensor } from "../../src/shipped-fake";

const request = (changed: string[] = []): PlanRequest => ({
  repository: ".",
  mode: "bring",
  ticks: {
    describe: false,
    analysis: true,
    ticked: [],
    once: [],
    onlyView: false,
    suites: {},
    folds: [],
  },
  scope: null,
  changed,
});

const view = (modules: number): ScanPlanView => ({
  intent: {
    describe: false,
    describeAll: false,
    analysis: true,
    sense: [],
    modules: null,
  },
  dropped: [],
  modules,
  idle: false,
  work: {},
  gaps: {},
  never: [],
});

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function panelInput(plan: PanelInput["plan"]): PanelInput {
  return {
    scan: null,
    config: "sensors:\n  crap: {}\n",
    sensors: [],
    lines: { modules: ["a.py"], of: () => ({ kind: "current", line: "x" }) },
    describedAt: null,
    ticks: request().ticks,
    run: NO_RUN,
    scanning: false,
    now: 0,
    shipped: { status: "ok", sensors: [plainSensor("crap")] },
    plan,
  };
}

describe("plan answers", () => {
  it("the_latest_reply_wins_and_the_panel_renders_again", async () => {
    const first = deferred<ScanPlanView>();
    const second = deferred<ScanPlanView>();
    const replies = [first, second];
    let rendered = 0;
    const answers = createPlanAnswers(
      () =>
        (replies.shift() as ReturnType<typeof deferred<ScanPlanView>>).promise,
      () => {
        rendered += 1;
      },
    );
    const older = request(["a.py"]);
    const newer = request(["a.py", "b.py"]);

    answers.ask(older);
    answers.ask(newer);
    second.resolve(view(2));
    await settle();
    first.resolve(view(1));
    await settle();

    expect(rendered).toBe(1);
    expect(answers.answerFor(newer)).toEqual({ view: view(2), settled: true });
    expect(answers.answerFor(older)?.view).toEqual(view(2));
    expect(answers.answerFor(older)?.settled).toBe(false);
  });

  it("before_the_first_reply_the_primary_action_is_disabled", async () => {
    const reply = deferred<ScanPlanView>();
    const answers = createPlanAnswers(
      () => reply.promise,
      () => {},
    );
    const asked = request();

    answers.ask(asked);

    expect(answers.answerFor(asked)).toBeNull();
    expect(
      scanPanel(panelInput(answers.answerFor(asked))).freshness.action.primary
        .disabled,
    ).toBe(true);

    reply.resolve(view(0));
    await settle();

    const answer = answers.answerFor(asked);

    expect(answer).not.toBeNull();
    expect(
      scanPanel(panelInput(answer)).freshness.action.primary.disabled,
    ).toBe(false);
  });
});
