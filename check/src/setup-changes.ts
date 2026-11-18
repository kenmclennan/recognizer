import { type PolicyCard, policyCommands, summaryOf } from "./setup-cards.js";
import { commandRefusal, quoteCommand } from "./setup-proposal.js";
import type { Survey, SurveyRunner } from "./setup-survey.js";
import { SHIPPED_DESCRIBER_NAME } from "./shipped-describer.js";

export interface ChangeStep {
  argv: string[];
  cwd: string;
}

export type ChangeGroup = "fixes" | "checks" | "tests" | "policy";

export interface PlannedChange {
  id: string;
  group: ChangeGroup;
  title: string;
  detail?: string;
  steps: ChangeStep[];
}

export interface RunnerChoice {
  name: string;
  command?: string;
  env?: Record<string, string>;
}

export interface SetupChoices {
  analysis?: {
    on: boolean;
    limits?: Record<string, number>;
  };
  plugins?: string[];
  runners?: RunnerChoice[];
  tools?: string[];
  policy?: PolicyCard[];
  fixes?: string[];
  plugins_off?: string[];
  remove_suites?: string[];
}

export interface DroppedRunner {
  runner: string;
  tool: string;
}

export interface BuiltChanges {
  changes: PlannedChange[];
  dropped: DroppedRunner[];
  needing_user: { command: string; reason: string }[];
}

function step(survey: Survey, argv: string[], cwd?: string): ChangeStep {
  return { argv, cwd: cwd ?? survey.repository };
}

export function splitCommand(text: string): string[] {
  const words: string[] = [];
  let word = "";
  let started = false;
  let quoted = false;

  for (const character of text) {
    if (quoted) {
      if (character === "'") {
        quoted = false;
      } else {
        word += character;
      }
    } else if (character === "'") {
      quoted = true;
      started = true;
    } else if (/\s/.test(character)) {
      if (started) {
        words.push(word);
        word = "";
        started = false;
      }
    } else {
      word += character;
      started = true;
    }
  }

  if (started) {
    words.push(word);
  }

  return words;
}

export function withoutRepository(argv: string[]): string[] {
  const at = argv.indexOf("--repository");

  return at === -1 ? argv : [...argv.slice(0, at), ...argv.slice(at + 2)];
}

function configStep(survey: Survey, key: string, value: string): ChangeStep {
  return step(survey, ["recognizer", "config", key, value]);
}

function analysisChanges(
  survey: Survey,
  choices: SetupChoices,
): PlannedChange[] {
  const check = survey.checks.find((one) => one.id === "analysis");

  if (choices.analysis === undefined || check === undefined) {
    return [];
  }

  if (!choices.analysis.on) {
    return check.enabled
      ? [
          {
            id: "analysis-off",
            group: "checks",
            title: "Turn structural analysis off",
            steps: [configStep(survey, "sensors.structure", "off")],
          },
        ]
      : [];
  }

  const changes: PlannedChange[] = [];

  for (const limit of check.limits) {
    const chosen = choices.analysis.limits?.[limit.label];

    if (chosen !== undefined && chosen !== (limit.current ?? limit.default)) {
      changes.push({
        id: `analysis-${limit.label}`,
        group: "checks",
        title: `Set ${limit.label} to ${chosen}`,
        steps: [configStep(survey, limit.key, String(chosen))],
      });
    }
  }

  return changes;
}

function runnerSteps(
  survey: Survey,
  runner: SurveyRunner,
  choice: RunnerChoice,
): ChangeStep[] {
  const key = (name: string) => `tests.${runner.name}.${name}`;
  const env = Object.entries(choice.env ?? runner.env ?? {}).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  return [
    configStep(survey, key("language"), runner.language),
    configStep(survey, key("directory"), runner.directory),
    configStep(survey, key("command"), choice.command ?? runner.command),
    ...(runner.language === "typescript"
      ? [configStep(survey, key("runner"), runner.runner)]
      : []),
    ...env.map(([name, value]) =>
      configStep(survey, key(`env.${name}`), value),
    ),
    configStep(survey, key("coverage.path"), runner.coverage.path),
    configStep(survey, key("coverage.format"), runner.coverage.format),
  ];
}

function testsWanted(survey: Survey, choices: SetupChoices): boolean {
  const chosen = new Set(choices.plugins ?? []);

  return survey.checks.some(
    (check) => chosen.has(check.id) && check.runs_tests,
  );
}

function toolChanges(survey: Survey, choices: SetupChoices): PlannedChange[] {
  if (!testsWanted(survey, choices)) {
    return [];
  }

  const kept = new Set(choices.tools ?? []);
  const wanted = new Set((choices.runners ?? []).map((one) => one.name));

  return survey.tools
    .filter((tool) => !tool.installed && kept.has(tool.name))
    .filter((tool) => tool.needed_by.some((name) => wanted.has(name)))
    .map((tool) => ({
      id: `tool-${tool.name}${tool.cwd === "." ? "" : `-${tool.cwd}`}`,
      group: "tests" as const,
      title: `Install ${tool.name}`,
      steps: [
        step(
          survey,
          tool.command,
          tool.cwd === "."
            ? survey.repository
            : `${survey.repository}/${tool.cwd}`,
        ),
      ],
    }));
}

function droppedRunners(
  survey: Survey,
  choices: SetupChoices,
): DroppedRunner[] {
  if (!testsWanted(survey, choices)) {
    return [];
  }

  const kept = new Set(choices.tools ?? []);
  const dropped: DroppedRunner[] = [];

  for (const choice of choices.runners ?? []) {
    const runner = survey.runners.find((one) => one.name === choice.name);
    const tool = survey.tools.find((one) =>
      one.needed_by.includes(choice.name),
    );

    if (
      runner !== undefined &&
      tool !== undefined &&
      !tool.installed &&
      !kept.has(tool.name)
    ) {
      dropped.push({ runner: choice.name, tool: tool.name });
    }
  }

  return dropped;
}

function runnerChanges(
  survey: Survey,
  choices: SetupChoices,
  dropped: DroppedRunner[],
): PlannedChange[] {
  if (!testsWanted(survey, choices)) {
    return [];
  }

  const out = new Set(dropped.map((one) => one.runner));
  const changes: PlannedChange[] = [];

  for (const choice of choices.runners ?? []) {
    const runner = survey.runners.find((one) => one.name === choice.name);

    if (runner !== undefined && !out.has(runner.name)) {
      changes.push({
        id: `tests-${runner.name}`,
        group: "tests",
        title: `Add the ${runner.name} test runner`,
        steps: runnerSteps(survey, runner, choice),
      });
    }
  }

  return changes;
}

function pluginChanges(survey: Survey, choices: SetupChoices): PlannedChange[] {
  return (choices.plugins ?? [])
    .filter((name) => {
      const check = survey.checks.find((one) => one.id === name);

      return (
        check !== undefined &&
        !check.always_on &&
        check.id !== "analysis" &&
        !check.enabled
      );
    })
    .map((name) => ({
      id: `plugin-${name}`,
      group: "checks" as const,
      title: `Turn on ${survey.checks.find((one) => one.id === name)?.display ?? name}`,
      steps: [step(survey, ["recognizer", "plugin", "add", name])],
    }));
}

function pluginOffChanges(
  survey: Survey,
  choices: SetupChoices,
): PlannedChange[] {
  return [...new Set(choices.plugins_off ?? [])].flatMap((name) => {
    const check = survey.checks.find((one) => one.id === name);

    if (
      check === undefined ||
      check.always_on ||
      check.id === "analysis" ||
      !check.enabled
    ) {
      return [];
    }

    const steps =
      name === SHIPPED_DESCRIBER_NAME
        ? ["describer.command", "describer.version"].map((key) =>
            step(survey, ["recognizer", "config", "--unset", key]),
          )
        : [
            step(survey, [
              "recognizer",
              "config",
              "--remove-section",
              `sensors.${name}`,
            ]),
          ];

    return [
      {
        id: `plugin-off-${name}`,
        group: "checks" as const,
        title: `Turn off ${check.display}`,
        steps,
      },
    ];
  });
}

function suiteRemoveChanges(
  survey: Survey,
  choices: SetupChoices,
): PlannedChange[] {
  return [...new Set(choices.remove_suites ?? [])].flatMap((name) => {
    const suite = survey.suites.find((one) => one.name === name);

    if (suite === undefined || suite.mark !== "gone") {
      return [];
    }

    return [
      {
        id: `suite-remove-${name}`,
        group: "tests" as const,
        title: `Remove the ${name} test suite`,
        steps: [
          step(survey, [
            "recognizer",
            "config",
            "--remove-section",
            `tests.${name}`,
          ]),
        ],
      },
    ];
  });
}

function policyChanges(survey: Survey, choices: SetupChoices): PlannedChange[] {
  const cards = choices.policy ?? [];
  const changes: PlannedChange[] = cards.map((card, index) => ({
    id: `policy-${index + 1}`,
    group: "policy",
    title: summaryOf(card),
    steps: policyCommands(card).map((argv) => step(survey, argv)),
  }));
  const broken = cards.some(
    (card) => card.kind === "forbid" && (card.today?.count ?? 0) > 0,
  );

  if (broken) {
    changes.push({
      id: "policy-baseline",
      group: "policy",
      title: "Record today's violations as the baseline",
      steps: [step(survey, ["recognizer", "check", "--init-baseline"])],
    });
  }

  return changes;
}

function fixChanges(
  survey: Survey,
  choices: SetupChoices,
): { changes: PlannedChange[]; needing: BuiltChanges["needing_user"] } {
  const changes: PlannedChange[] = [];
  const needing: BuiltChanges["needing_user"] = [];

  for (const command of choices.fixes ?? []) {
    const known = survey.fixes.find((one) => one.command === command);
    const argv = withoutRepository(splitCommand(command));
    const refusal =
      known === undefined
        ? "not a finding of the survey"
        : commandRefusal(argv);

    if (refusal !== null) {
      needing.push({ command, reason: refusal });
    } else {
      changes.push({
        id: `fix-${changes.length + 1}`,
        group: "fixes",
        title: known?.title ?? command,
        ...(known === undefined ? {} : { detail: known.line }),
        steps: [step(survey, argv)],
      });
    }
  }

  return { changes, needing };
}

export function buildChanges(
  survey: Survey,
  choices: SetupChoices,
): BuiltChanges {
  const dropped = droppedRunners(survey, choices);
  const fixes = fixChanges(survey, choices);

  return {
    changes: [
      ...fixes.changes,
      ...analysisChanges(survey, choices),
      ...pluginChanges(survey, choices),
      ...pluginOffChanges(survey, choices),
      ...suiteRemoveChanges(survey, choices),
      ...toolChanges(survey, choices),
      ...runnerChanges(survey, choices, dropped),
      ...policyChanges(survey, choices),
    ],
    dropped,
    needing_user: fixes.needing,
  };
}

export function commandText(argv: string[]): string {
  return quoteCommand(argv);
}
