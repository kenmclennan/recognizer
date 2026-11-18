import {
  type ApplyEvent,
  buildChanges,
  type PlannedChange,
  POLICY_RECOMMENDATION_PROMPT,
  POLICY_RECOMMENDATION_SCHEMA,
  type PolicyCard,
  type Recommendation,
  type SetupChoices,
  type Survey,
  type SurveyRunner,
  type TryEvent,
} from "recognizer";
import type { DoctorRead, SetupPort } from "./setup-port";
import {
  applyFill,
  type LoadingState,
  reduceLoading,
  startLoading,
  type Timed,
} from "./setup-progress";

export type StepKey =
  | "files"
  | "checks"
  | "tests"
  | "policy"
  | "review"
  | "apply";

export const SETUP_STEPS: { key: StepKey; name: string }[] = [
  { key: "files", name: "Files" },
  { key: "checks", name: "Checks" },
  { key: "tests", name: "Tests" },
  { key: "policy", name: "Policy" },
  { key: "review", name: "Review" },
  { key: "apply", name: "Apply" },
];

export type RunnerState = {
  on: boolean;
  command: string;
  env: [string, string][];
};

export type RowState = "waiting" | "running" | "done" | "failed" | "undone";

export type Row = {
  title: string;
  state: RowState;
  output: string;
  step?: number;
  steps?: number;
  command?: string;
  startedAt?: number | null;
  endedAt?: number | null;
};

export type RunnerResult = {
  name: string;
  ready: boolean;
  detail: string;
  output: string;
};

export type TryState =
  | { kind: "idle" }
  | { kind: "running"; rows: Row[] }
  | { kind: "done"; ok: boolean; runners: RunnerResult[]; rows: Row[] }
  | { kind: "error"; message: string };

export type PolicyRun =
  | { kind: "idle" }
  | { kind: "running"; lines: string[] }
  | { kind: "done"; recommendation: Recommendation }
  | { kind: "failed"; message: string };

export type ApplyRun = {
  state: "running" | "done" | "failed" | "stopped";
  rows: Row[];
  doctor: DoctorRead | null;
  message: string | null;
  startedAt: number;
  endedAt: number | null;
  fill: number;
  checking: Timed;
  loading: Timed;
};

export type WizardState = {
  kind: "wizard";
  survey: Survey;
  doctor: DoctorRead;
  at: number;
  analysis: boolean;
  limits: Record<string, number>;
  plugins: Record<string, boolean>;
  runners: Record<string, RunnerState>;
  tools: Record<string, boolean>;
  tried: TryState;
  policyMode: "skip" | "ask";
  policy: PolicyRun;
  decisions: Record<number, "accept" | "reject">;
  fixes: boolean[];
  removals: Record<string, boolean>;
  apply: ApplyRun | null;
};

export type SetupState =
  | { kind: "loading"; progress: LoadingState }
  | { kind: "unavailable"; reason: string }
  | WizardState;

export function lineCount(text: string): number {
  if (text === "") {
    return 0;
  }

  return (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n").length;
}

export function linesLabel(count: number): string {
  return count === 1 ? "1 line" : `${count} lines`;
}

export function doctorProblems(read: DoctorRead | null): number | null {
  return read !== null && read.status === "ok" ? read.report.problems : null;
}

export function pluginChecks(survey: Survey) {
  return survey.checks.filter(
    (check) => !check.always_on && check.id !== "analysis",
  );
}

export function testsWanted(state: WizardState): boolean {
  return pluginChecks(state.survey).some(
    (check) => state.plugins[check.id] === true && check.runs_tests,
  );
}

export function isSkipped(state: WizardState, key: StepKey): boolean {
  return key === "tests" && !testsWanted(state);
}

export function currentKey(state: WizardState): StepKey {
  return SETUP_STEPS[state.at]?.key ?? "files";
}

export function acceptedCards(state: WizardState): PolicyCard[] {
  if (state.policyMode !== "ask" || state.policy.kind !== "done") {
    return [];
  }

  return state.policy.recommendation.entries.filter(
    (_, at) => state.decisions[at] === "accept",
  );
}

export function undecidedCards(state: WizardState): number {
  if (state.policy.kind !== "done") {
    return 0;
  }

  return state.policy.recommendation.entries.filter(
    (_, at) => state.decisions[at] === undefined,
  ).length;
}

export function choicesOf(state: WizardState): SetupChoices {
  const wanted = testsWanted(state);
  const analysis = state.survey.checks.find((one) => one.id === "analysis");

  return {
    ...(analysis === undefined
      ? {}
      : { analysis: { on: state.analysis, limits: { ...state.limits } } }),
    plugins: pluginChecks(state.survey)
      .filter((check) => state.plugins[check.id] === true)
      .map((check) => check.id),
    plugins_off: pluginChecks(state.survey)
      .filter(
        (check) => check.mark === "set-up" && state.plugins[check.id] !== true,
      )
      .map((check) => check.id),
    fixes: state.survey.fixes
      .filter((one, at) => state.fixes[at] === true && one.command !== null)
      .map((one) => one.command as string),
    remove_suites: state.survey.suites
      .filter((suite) => suite.mark === "gone")
      .filter((suite) => state.removals[suite.name] === true)
      .map((suite) => suite.name),
    runners: wanted
      ? state.survey.runners
          .filter((runner) => state.runners[runner.name]?.on === true)
          .map((runner) => {
            const own = state.runners[runner.name] as RunnerState;
            const env = Object.fromEntries(own.env);

            return {
              name: runner.name,
              ...(own.command === runner.command
                ? {}
                : { command: own.command }),
              ...(own.env.length === 0 && runner.env === undefined
                ? {}
                : { env }),
            };
          })
      : [],
    tools: wanted
      ? state.survey.tools
          .filter((tool) => state.tools[tool.name] === true)
          .map((tool) => tool.name)
      : [],
    policy: acceptedCards(state),
  };
}

export function changesOf(state: WizardState): PlannedChange[] {
  return buildChanges(state.survey, choicesOf(state)).changes;
}

export function droppedOf(state: WizardState) {
  return buildChanges(state.survey, choicesOf(state)).dropped;
}

export function sharedBy(state: WizardState, runner: SurveyRunner): string[] {
  return state.survey.runners
    .filter(
      (one) =>
        one.tool === runner.tool &&
        runner.tool !== null &&
        state.runners[one.name]?.on === true,
    )
    .map((one) => one.name);
}

export function canNext(state: WizardState): boolean {
  const key = currentKey(state);

  if (key === "policy") {
    return state.policyMode === "skip" || state.policy.kind === "done";
  }

  if (key === "review") {
    return changesOf(state).length > 0;
  }

  return key !== "apply";
}

export type SetupController = {
  state(): SetupState;
  subscribe(listener: (state: SetupState) => void): () => void;
  open(): Promise<void>;
  next(): void;
  back(): void;
  goto(index: number): void;
  setAnalysis(on: boolean): void;
  setLimit(label: string, value: number): void;
  setPlugin(id: string, on: boolean): void;
  setRunner(name: string, on: boolean): void;
  setCommand(name: string, command: string): void;
  addEnv(name: string, variable: string, value: string): boolean;
  removeEnv(name: string, index: number): void;
  setTool(name: string, on: boolean): void;
  setPolicyMode(mode: "skip" | "ask"): void;
  askClaude(): Promise<void>;
  decide(index: number, decision: "accept" | "reject"): void;
  acceptRemaining(): void;
  setFix(index: number, on: boolean): void;
  setRemoval(name: string, on: boolean): void;
  runOnce(): Promise<void>;
  apply(): Promise<void>;
  stop(): Promise<void>;
  backToReview(): void;
};

export type SetupDeps = {
  port: SetupPort;
  reloadSensors?: () => Promise<void> | void;
  scanAfterApply?: () => void;
  onDoctor?: (read: DoctorRead) => void;
  now?: () => number;
};

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function initial(survey: Survey, doctor: DoctorRead): WizardState {
  const analysis = survey.checks.find((one) => one.id === "analysis");
  return {
    kind: "wizard",
    survey,
    doctor,
    at: 0,
    analysis: analysis?.enabled ?? true,
    limits: Object.fromEntries(
      (analysis?.limits ?? []).map((limit) => [
        limit.label,
        limit.current ?? limit.default,
      ]),
    ),
    plugins: Object.fromEntries(
      pluginChecks(survey).map((check) => [
        check.id,
        check.mark === null ? !check.enabled : check.mark === "set-up",
      ]),
    ),
    runners: Object.fromEntries(
      survey.runners.map((runner) => [
        runner.name,
        {
          on: true,
          command: runner.command,
          env: Object.entries(runner.env ?? {}),
        },
      ]),
    ),
    tools: Object.fromEntries(survey.tools.map((tool) => [tool.name, true])),
    tried: { kind: "idle" },
    policyMode: "skip",
    policy: { kind: "idle" },
    decisions: {},
    fixes: survey.fixes.map(() => true),
    removals: Object.fromEntries(
      survey.suites
        .filter((suite) => suite.mark === "gone")
        .map((suite) => [suite.name, true]),
    ),
    apply: null,
  };
}

function rowsOf(changes: PlannedChange[]): Row[] {
  return changes.map((change) => ({
    title: change.title,
    state: "waiting",
    output: "",
  }));
}

function withRow(rows: Row[], index: number, patch: Partial<Row>): Row[] {
  return rows.map((row, at) => (at === index ? { ...row, ...patch } : row));
}

export function createSetupController(deps: SetupDeps): SetupController {
  const now = deps.now ?? Date.now;
  let state: SetupState = { kind: "loading", progress: startLoading(now()) };
  let stopping = false;
  let live = false;
  const listeners = new Set<(state: SetupState) => void>();

  function set(next: SetupState): void {
    state = next;

    for (const listener of listeners) {
      listener(state);
    }
  }

  function edit(change: (wizard: WizardState) => Partial<WizardState>): void {
    if (state.kind === "wizard") {
      set({ ...state, ...change(state) });
    }
  }

  function move(step: number): void {
    edit((wizard) => {
      let at = wizard.at + step;

      while (
        at > 0 &&
        at < SETUP_STEPS.length - 1 &&
        isSkipped(wizard, SETUP_STEPS[at]?.key ?? "files")
      ) {
        at += step;
      }

      return { at: Math.max(0, Math.min(at, SETUP_STEPS.length - 1)) };
    });
  }

  async function finishStop(): Promise<void> {
    if (stopping) {
      return;
    }

    stopping = true;

    await deps.port.stop();
  }

  return {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    async open() {
      let progress = startLoading(now());

      set({ kind: "loading", progress });

      const read = await deps.port.survey(true, (line) => {
        progress = reduceLoading(progress, line, now());

        if (state.kind === "loading") {
          set({ kind: "loading", progress });
        }
      });

      if (read.status === "unavailable") {
        set({ kind: "unavailable", reason: read.reason });

        return;
      }

      deps.onDoctor?.(read.doctor);
      set(initial(read.survey, read.doctor));
    },
    next() {
      if (state.kind !== "wizard" || !canNext(state)) {
        return;
      }

      move(1);
    },
    back() {
      move(-1);
    },
    goto(index) {
      if (
        state.kind !== "wizard" ||
        index >= state.at ||
        currentKey(state) === "apply" ||
        isSkipped(state, SETUP_STEPS[index]?.key ?? "files")
      ) {
        return;
      }

      edit(() => ({ at: index }));
    },
    setAnalysis: (on) => edit(() => ({ analysis: on })),
    setLimit: (label, value) =>
      edit((wizard) => ({
        limits: {
          ...wizard.limits,
          [label]: Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1,
        },
      })),
    setPlugin: (id, on) =>
      edit((wizard) => ({ plugins: { ...wizard.plugins, [id]: on } })),
    setRunner: (name, on) =>
      edit((wizard) => ({
        runners: {
          ...wizard.runners,
          [name]: { ...(wizard.runners[name] as RunnerState), on },
        },
      })),
    setCommand: (name, command) =>
      edit((wizard) => ({
        runners: {
          ...wizard.runners,
          [name]: { ...(wizard.runners[name] as RunnerState), command },
        },
      })),
    addEnv(name, variable, value) {
      if (!NAME.test(variable)) {
        return false;
      }

      edit((wizard) => {
        const own = wizard.runners[name] as RunnerState;

        return {
          runners: {
            ...wizard.runners,
            [name]: {
              ...own,
              env: [
                ...own.env.filter(([key]) => key !== variable),
                [variable, value],
              ],
            },
          },
        };
      });

      return true;
    },
    removeEnv: (name, index) =>
      edit((wizard) => {
        const own = wizard.runners[name] as RunnerState;

        return {
          runners: {
            ...wizard.runners,
            [name]: { ...own, env: own.env.filter((_, at) => at !== index) },
          },
        };
      }),
    setTool: (name, on) =>
      edit((wizard) => ({ tools: { ...wizard.tools, [name]: on } })),
    setPolicyMode: (mode) =>
      edit((wizard) =>
        wizard.policy.kind === "running" ? {} : { policyMode: mode },
      ),
    async askClaude() {
      if (state.kind !== "wizard" || state.policy.kind === "running") {
        return;
      }

      stopping = false;
      edit(() => ({
        policy: { kind: "running", lines: [] },
        decisions: {},
      }));

      const survey = state.survey;
      const prompt = `${POLICY_RECOMMENDATION_PROMPT}\n\nThe setup survey of this repository:\n\n${JSON.stringify(survey, null, 2)}\n`;

      try {
        const result = await deps.port.recommend(
          prompt,
          POLICY_RECOMMENDATION_SCHEMA,
          (line) =>
            edit((wizard) =>
              wizard.policy.kind === "running"
                ? {
                    policy: {
                      kind: "running",
                      lines: [...wizard.policy.lines, line],
                    },
                  }
                : {},
            ),
        );

        if (result.status === "proposal") {
          edit(() => ({
            policy: { kind: "done", recommendation: result.output },
          }));
        } else if (result.status === "cancelled") {
          edit(() => ({ policy: { kind: "idle" } }));
        } else {
          edit(() => ({
            policy: { kind: "failed", message: result.reason },
          }));
        }
      } catch (error) {
        edit(() => ({
          policy: {
            kind: "failed",
            message: error instanceof Error ? error.message : String(error),
          },
        }));
      }
    },
    decide: (index, decision) =>
      edit((wizard) => {
        const decisions = { ...wizard.decisions };

        if (decisions[index] === decision) {
          delete decisions[index];
        } else {
          decisions[index] = decision;
        }

        return { decisions };
      }),
    acceptRemaining: () =>
      edit((wizard) => {
        if (wizard.policy.kind !== "done") {
          return {};
        }

        const decisions = { ...wizard.decisions };

        wizard.policy.recommendation.entries.forEach((_, at) => {
          if (decisions[at] === undefined) {
            decisions[at] = "accept";
          }
        });

        return { decisions };
      }),
    setFix: (index, on) =>
      edit((wizard) => ({
        fixes: wizard.fixes.map((one, at) => (at === index ? on : one)),
      })),
    setRemoval: (name, on) =>
      edit((wizard) => ({ removals: { ...wizard.removals, [name]: on } })),
    async runOnce() {
      if (state.kind !== "wizard" || state.tried.kind === "running") {
        return;
      }

      stopping = false;
      live = true;

      const choices = choicesOf(state);
      const planned = buildChanges(state.survey, choices).changes.filter(
        (change) =>
          change.id.startsWith("tool-") ||
          change.id.startsWith("tests-") ||
          (change.id.startsWith("plugin-") &&
            !change.id.startsWith("plugin-off-")),
      );
      const runners: RunnerResult[] = [];
      let rows = rowsOf(planned);

      edit(() => ({ tried: { kind: "running", rows } }));

      const onEvent = (event: TryEvent) => {
        if (!live) {
          return;
        }

        if (event.event === "change") {
          rows = withRow(rows, event.index, {
            state: event.state,
            output: event.output,
          });
          edit(() => ({ tried: { kind: "running", rows } }));
        } else if (event.event === "runner") {
          runners.push({
            name: event.name,
            ready: event.ready,
            detail: event.detail,
            output: event.output,
          });
        }
      };

      try {
        const result = await deps.port.tryRunners(choices, onEvent);

        live = false;
        edit(() => ({
          tried: { kind: "done", ok: result.ok, runners, rows },
        }));
      } catch (error) {
        live = false;
        edit(() => ({
          tried: {
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          },
        }));
      }
    },
    async apply() {
      if (
        state.kind !== "wizard" ||
        state.apply?.state === "running" ||
        changesOf(state).length === 0
      ) {
        return;
      }

      stopping = false;
      live = true;

      const choices = choicesOf(state);
      const startedAt = now();
      let rows = withRow(rowsOf(changesOf(state)), 0, {
        state: "running",
        startedAt,
      });
      let commands: number | null = null;
      let commandsDone = 0;
      let endedAt: number | null = null;
      let checking: Timed = {
        state: "waiting",
        startedAt: null,
        endedAt: null,
      };
      let loading: Timed = { state: "waiting", startedAt: null, endedAt: null };

      const fill = () =>
        applyFill(
          commands,
          commandsDone,
          rows.filter((one) => one.state === "done").length,
          rows.length,
        );
      const progress = (
        patch: Partial<ApplyRun> & { state: ApplyRun["state"] },
      ) =>
        edit((wizard) => ({
          apply: {
            rows,
            doctor: wizard.apply?.doctor ?? null,
            message: null,
            startedAt,
            endedAt,
            fill: fill(),
            checking,
            loading,
            ...patch,
          },
          at: SETUP_STEPS.length - 1,
        }));

      progress({ state: "running" });

      const onEvent = (event: ApplyEvent) => {
        if (!live) {
          return;
        }

        if (event.event === "start") {
          commands = event.commands ?? null;
        } else if (event.event === "change") {
          rows = withRow(rows, event.index, {
            state: event.state,
            output: event.output,
            ...(event.state === "running"
              ? { startedAt: rows[event.index]?.startedAt ?? now() }
              : event.state === "done" || event.state === "failed"
                ? { endedAt: now() }
                : {}),
          });
        } else if (event.event === "command") {
          if (event.state === "running") {
            rows = withRow(rows, event.index, {
              step: event.step,
              steps: event.steps,
              command: event.command,
            });
          } else {
            commandsDone += 1;
          }
        } else if (event.event === "doctor") {
          checking =
            event.state === "running"
              ? { state: "running", startedAt: now(), endedAt: null }
              : {
                  state: "done",
                  startedAt: checking.startedAt ?? now(),
                  endedAt: now(),
                };
        } else {
          return;
        }

        progress({ state: "running" });
      };

      try {
        const result = await deps.port.apply(choices, onEvent);

        live = false;

        if (result.ok) {
          const doctor: DoctorRead =
            result.doctor === null
              ? { status: "unavailable", reason: "doctor did not answer" }
              : { status: "ok", report: result.doctor };

          if (checking.state !== "done") {
            checking = {
              state: "done",
              startedAt: checking.startedAt ?? now(),
              endedAt: now(),
            };
          }

          loading = { state: "running", startedAt: now(), endedAt: null };
          progress({ state: "running" });
          await deps.reloadSensors?.();
          loading = {
            state: "done",
            startedAt: loading.startedAt,
            endedAt: now(),
          };
          endedAt = now();
          deps.scanAfterApply?.();
          deps.onDoctor?.(doctor);
          progress({ state: "done", doctor });
        } else {
          endedAt = now();
          progress({
            state: stopping ? "stopped" : "failed",
          });
        }
      } catch (error) {
        live = false;
        endedAt = now();
        progress({
          state: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    async stop() {
      if (state.kind !== "wizard") {
        return;
      }

      if (
        state.apply?.state === "running" ||
        state.tried.kind === "running" ||
        state.policy.kind === "running"
      ) {
        await finishStop();
      }
    },
    backToReview() {
      edit(() => ({
        apply: null,
        at: SETUP_STEPS.findIndex((step) => step.key === "review"),
      }));
    },
  };
}
