import {
  type ApplyEvent,
  buildChanges,
  type DoctorReport,
  type PlannedChange,
  type Recommendation,
  type SetupChoices,
  type Survey,
  type TryEvent,
} from "recognizer";
import loom from "../../schema/setup-survey-examples/valid/loom.json";
import type {
  ApplyResultEvent,
  DoctorRead,
  RecommendRead,
  SetupPort,
  SetupSurveyRead,
  TryResultEvent,
} from "./setup-port";

export type FakeSetup = SetupPort & {
  surveyRead: SetupSurveyRead;
  recommendation: RecommendRead;
  progress: string[];
  failAt: number | null;
  notReady: Record<string, string>;
  notReadyOutput: Record<string, string>;
  calls: string[];
  applied: SetupChoices[];
  tried: SetupChoices[];
  gate: Promise<void> | null;
  stopped: number;
  applyDoctor?: DoctorReport | null;
};

export const CLEAN_REPORT: DoctorReport = {
  repository: "/repo",
  ok: true,
  problems: 0,
  warnings: 0,
  areas: [],
};

export const CLEAN_DOCTOR: DoctorRead = { status: "ok", report: CLEAN_REPORT };

export const LOOM_SURVEY = loom as unknown as Survey;

export const RECOMMENDATION: Recommendation = {
  entries: [
    {
      kind: "ignore",
      globs: ["**/*.test.ts", "scripts/**"],
      why: "Tests import the code they test, and scripts import nothing of the app's.",
      based_on: "14 test files",
    },
    {
      kind: "entry",
      paths: ["app/src/main.tsx"],
      why: "Nothing imports an entry point: the runtime starts it.",
      based_on: "app/index.html loads main.tsx",
    },
    {
      kind: "forbid",
      from: ["engine/src/application/"],
      to: ["engine/src/adapters/"],
      both: false,
      why: "Application code is written against its own interfaces.",
      based_on: "generate-scene.ts imports only application/ports",
      today: {
        count: 1,
        example: "application/ports/config.ts imports adapters/model/strip.ts",
      },
    },
    {
      kind: "forbid",
      from: ["engine/src/adapters/model/"],
      to: ["engine/src/adapters/story/"],
      both: true,
      why: "One adapter calling another couples two outside things together.",
      based_on:
        "adapters/model and adapters/story import nothing from each other",
      today: { count: 0, example: null },
    },
  ],
  dropped: [
    {
      index: 4,
      kind: "forbid",
      summary: "app/ must not import engine/",
      reason: "the policy already holds this rule",
    },
  ],
};

export function fakeSetup(options: Partial<FakeSetup> = {}): FakeSetup {
  let release: (() => void) | null = null;

  const fake: FakeSetup = {
    surveyRead: { status: "ok", survey: LOOM_SURVEY, doctor: CLEAN_DOCTOR },
    recommendation: {
      status: "proposal",
      output: RECOMMENDATION,
      costUsd: null,
      durationMs: null,
      denials: 0,
    },
    progress: [],
    failAt: null,
    notReady: {},
    notReadyOutput: {},
    calls: [],
    applied: [],
    tried: [],
    gate: null,
    stopped: 0,
    ...options,
    async survey(extract) {
      fake.calls.push(extract ? "survey+extract" : "survey");

      return fake.surveyRead;
    },
    async recommend(_prompt, _schema, onLine) {
      fake.calls.push("recommend");

      for (const line of fake.progress) {
        onLine(line);
      }

      if (fake.gate !== null) {
        const stopped = new Promise<void>((resolve) => {
          release = resolve;
        });

        await Promise.race([fake.gate, stopped]);

        if (fake.stopped > 0) {
          return { status: "cancelled" };
        }
      }

      return fake.recommendation;
    },
    async apply(choices, onEvent): Promise<ApplyResultEvent> {
      fake.calls.push("apply");
      fake.applied.push(choices);

      const survey = surveyOf(fake);
      const changes = buildChanges(survey, choices).changes;
      const ok = await run(fake, changes, onEvent);

      return {
        event: "result",
        ok,
        doctor: ok
          ? fake.applyDoctor === undefined
            ? CLEAN_REPORT
            : fake.applyDoctor
          : null,
      };
    },
    async tryRunners(choices, onEvent): Promise<TryResultEvent> {
      fake.calls.push("try");
      fake.tried.push(choices);

      const survey = surveyOf(fake);
      const changes = buildChanges(survey, choices).changes.filter(
        (change) =>
          change.id.startsWith("tool-") ||
          change.id.startsWith("tests-") ||
          change.id.startsWith("plugin-"),
      );
      const ran = await run(fake, changes, onEvent, (undo) => {
        const names = changes
          .filter((change) => change.id.startsWith("tests-"))
          .map((change) => change.id.slice("tests-".length));

        for (const runner of survey.runners) {
          if (names.includes(runner.name)) {
            onEvent({
              event: "runner",
              name: runner.name,
              ready: fake.notReady[runner.name] === undefined,
              detail: fake.notReady[runner.name] ?? "",
              output:
                fake.notReady[runner.name] === undefined
                  ? ""
                  : (fake.notReadyOutput[runner.name] ?? ""),
            });
          }
        }

        undo();
      });

      return {
        event: "result",
        ok: ran && Object.keys(fake.notReady).length === 0,
      };
    },
    async stop() {
      fake.calls.push("stop_setup");
      fake.stopped += 1;
      release?.();
    },
  };

  return fake;
}

function surveyOf(fake: FakeSetup): Survey {
  return fake.surveyRead.status === "ok" ? fake.surveyRead.survey : LOOM_SURVEY;
}

async function run(
  fake: FakeSetup,
  changes: PlannedChange[],
  onEvent: (event: ApplyEvent & TryEvent) => void,
  finish?: (undo: () => void) => void,
): Promise<boolean> {
  onEvent({
    event: "start",
    total: changes.length,
    commands: changes.reduce((sum, change) => sum + change.steps.length, 0),
  });

  const done: number[] = [];
  const undo = () => {
    for (const index of [...done].reverse()) {
      onEvent({ event: "change", index, state: "undone", output: "" });
    }
  };

  for (const [index, change] of changes.entries()) {
    onEvent({ event: "change", index, state: "running", output: "" });

    if (fake.gate !== null) {
      await Promise.race([
        fake.gate,
        new Promise<void>((resolve) => {
          const poll = () =>
            fake.stopped > 0 ? resolve() : setTimeout(poll, 5);

          poll();
        }),
      ]);
    }

    if (fake.failAt === index || fake.stopped > 0) {
      onEvent({
        event: "change",
        index,
        state: "failed",
        output: `${change.id} failed`,
      });
      undo();

      return false;
    }

    done.push(index);
    onEvent({ event: "change", index, state: "done", output: "ok" });
  }

  if (finish === undefined) {
    return true;
  }

  finish(undo);

  return true;
}
