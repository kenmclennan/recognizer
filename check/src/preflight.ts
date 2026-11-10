import { dirname, isAbsolute, relative } from "node:path";
import type { Io } from "./cli.js";
import type { Describer } from "./describe-modules.js";
import { type Fix, type Gap, isGap } from "./gap.js";
import { runsTests } from "./shipped-sensors.js";

export interface PreflightSensor {
  name: string;
  command: string[];
}

export interface EarlyInput {
  io: Io;
  root: string;
  commit: string | null;
  sensors: PreflightSensor[];
  describe: boolean;
  describer: Describer | null;
  model: string;
}

export const PROJECT_STAGE_TIMEOUT_MS = 600_000;

const BREW_FIX = "brew install --cask kenmclennan/tap/recognizer";

const SENSORS_PROGRAM = "recognizer-sensors";

const REFERENCE_PROGRAM = "recognizer-describe-claude";

const IN_TREE_DESCRIBER = "describers/claude/dist/bin.js";

const NO_COMMIT_FIX =
  "make the first commit (git add the files, then git commit)";

function outside(text: string, cwd = ""): Fix {
  return { text, command: null, cwd, env: {}, kind: "outside" };
}

function installFix(): Fix {
  return {
    text: BREW_FIX,
    command: BREW_FIX.split(" "),
    cwd: "",
    env: {},
    kind: "outside",
  };
}

function isShipped(sensor: PreflightSensor): boolean {
  return sensor.command[0] === SENSORS_PROGRAM;
}

function fillDescriber(
  item: string,
  root: string,
  model: string,
  request: string,
): string {
  return item
    .split("{repository}")
    .join(root)
    .split("{model}")
    .join(model)
    .split("{request}")
    .join(request);
}

function isReference(command: string[]): boolean {
  return (
    command[0] === REFERENCE_PROGRAM ||
    command.some((item) => item.endsWith(IN_TREE_DESCRIBER))
  );
}

function describerArgumentsGap(
  io: Io,
  input: EarlyInput,
  describer: Describer,
): Gap | null {
  const filled = describer.command.map((item) =>
    fillDescriber(item, input.root, input.model, "--check"),
  );
  const [program, ...rest] = filled as [string, ...string[]];
  const result = io.run(program, rest, { cwd: input.root });

  if (result.started && result.status === 0) {
    return null;
  }

  const tree = filled.find((item) => item.endsWith(IN_TREE_DESCRIBER));
  const packageDirectory =
    tree === undefined ? null : relative(input.root, dirname(dirname(tree)));
  const inRepository =
    packageDirectory !== null &&
    !packageDirectory.startsWith("..") &&
    !isAbsolute(packageDirectory);

  return {
    id: "describe:arguments",
    line: "the describer rejects the arguments the scan passes",
    needs: ["describe"],
    project: null,
    fix: inRepository
      ? {
          text: "npm run build",
          command: ["npm", "run", "build"],
          cwd: packageDirectory,
          env: {},
          kind: "repository",
        }
      : installFix(),
  };
}

function describerGaps(input: EarlyInput): Gap[] {
  if (!input.describe) {
    return [];
  }

  const { io, describer } = input;

  if (describer === null) {
    return [
      {
        id: "describe:missing",
        line: "no describer is registered and recognizer-describe-claude is not installed",
        needs: ["describe"],
        project: null,
        fix: installFix(),
      },
    ];
  }

  if (isReference(describer.command)) {
    const gap = describerArgumentsGap(io, input, describer);

    return gap === null ? [] : [gap];
  }

  const program = describer.command[0] as string;
  const started = io.run(program, ["--version"], { cwd: input.root }).started;

  return started
    ? []
    : [
        {
          id: "describe:program",
          line: `the describer program ${program} does not start`,
          needs: ["describe"],
          project: null,
          fix: outside(`install ${program}`),
        },
      ];
}

function sensorProgramGaps(input: EarlyInput): Gap[] {
  const shipped = input.sensors.filter(isShipped);

  if (shipped.length === 0) {
    return [];
  }

  const result = input.io.run(SENSORS_PROGRAM, ["--version"]);

  return result.started && result.status === 0
    ? []
    : [
        {
          id: "sensors:missing",
          line: `${SENSORS_PROGRAM} is not installed`,
          needs: shipped.map((one) => one.name),
          project: null,
          fix: installFix(),
        },
      ];
}

export function earlyGaps(input: EarlyInput): Gap[] {
  const gaps: Gap[] = [];

  if (input.commit === null && input.sensors.length > 0) {
    gaps.push({
      id: "no-commit",
      line: "the folder has no git commit",
      needs: input.sensors.map((one) => one.name),
      project: null,
      fix: outside(NO_COMMIT_FIX),
    });
  }

  gaps.push(...describerGaps(input), ...sensorProgramGaps(input));

  return gaps;
}

function withoutOutput(command: string[]): string[] {
  const at = command.indexOf("--output");

  return at === -1
    ? command
    : [...command.slice(0, at), ...command.slice(at + 2)];
}

function parseGaps(stdout: string): Gap[] {
  const last = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .pop();

  if (last === undefined) {
    return [];
  }

  try {
    const parsed = JSON.parse(last) as { gaps?: unknown };

    return Array.isArray(parsed.gaps) ? parsed.gaps.filter(isGap) : [];
  } catch {
    return [];
  }
}

export function projectGaps(
  io: Io,
  root: string,
  commit: string,
  sensors: PreflightSensor[],
): Gap[] {
  const gaps: Gap[] = [];

  for (const sensor of sensors) {
    if (!runsTests(sensor.command)) {
      continue;
    }

    const filled = [...withoutOutput(sensor.command), "--preflight"].map(
      (item) =>
        item.split("{repository}").join(root).split("{commit}").join(commit),
    );
    const [program, ...rest] = filled as [string, ...string[]];
    const result = io.run(program, rest, {
      cwd: root,
      timeoutMs: PROJECT_STAGE_TIMEOUT_MS,
    });

    if (result.started && result.status === 0) {
      gaps.push(...parseGaps(result.stdout));
    }
  }

  return gaps;
}
