import { dirname, isAbsolute, relative } from "node:path";
import type { Io } from "./cli.js";
import type { Describer } from "./describe-modules.js";
import type { Fix, Gap } from "./gap.js";
import { pluginPrefix } from "./plugin-run.js";
import { checkSensors } from "./sensors-check.js";
import { type ManifestReader, shippedSensorOf } from "./shipped-sensors.js";

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
  install: Record<string, string>;
}

const REFERENCE_PROGRAM = "recognizer-describe-claude";

const IN_TREE_DESCRIBER = "describers/claude/dist/bin.js";

const NO_COMMIT_FIX =
  "make the first commit (git add the files, then git commit)";

function outside(text: string, cwd = ""): Fix {
  return { text, command: null, cwd, env: {}, kind: "outside" };
}

export function installFix(
  install: Record<string, string> | undefined,
  program: string,
): Fix {
  return outside(install?.[program] ?? `install ${program}`);
}

function fillDescriber(item: string, root: string): string {
  return item.split("{repository}").join(root);
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
  const prefix = pluginPrefix(describer.command);

  if (prefix === null) {
    return {
      id: "describe:arguments",
      line: "the describer does not speak the plugin verbs: its command has no run element",
      needs: ["describe"],
      fix: installFix(input.install, describer.command[0] as string),
    };
  }

  const filled = prefix.map((item) => fillDescriber(item, input.root));
  const result = io.run(filled[0] as string, [...filled.slice(1), "check"], {
    cwd: input.root,
  });

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
    fix: inRepository
      ? {
          text: "npm run build",
          command: ["npm", "run", "build"],
          cwd: packageDirectory,
          env: {},
          kind: "repository",
        }
      : installFix(input.install, filled[0] as string),
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
        fix: installFix(input.install, REFERENCE_PROGRAM),
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
          fix: installFix(input.install, program),
        },
      ];
}

function sensorProgramGaps(input: EarlyInput): Gap[] {
  return input.sensors.flatMap((sensor) => {
    const name = shippedSensorOf(sensor.command);

    if (name === undefined) {
      return [];
    }

    const program = `recognizer-sense-${name}`;
    const result = input.io.run(program, ["--version"]);

    return result.started && result.status === 0
      ? []
      : [
          {
            id: `sensors:missing:${name}`,
            line: `${program} is not installed`,
            needs: [sensor.name],
            fix: installFix(input.install, program),
          },
        ];
  });
}

export function earlyGaps(input: EarlyInput): Gap[] {
  const gaps: Gap[] = [];

  if (input.commit === null && input.sensors.length > 0) {
    gaps.push({
      id: "no-commit",
      line: "the folder has no git commit",
      needs: input.sensors.map((one) => one.name),
      fix: outside(NO_COMMIT_FIX),
    });
  }

  gaps.push(...describerGaps(input), ...sensorProgramGaps(input));

  return gaps;
}

export function readinessGaps(
  io: Io,
  root: string,
  sensors: PreflightSensor[],
  read?: ManifestReader,
): Gap[] {
  return checkSensors(io, root, sensors, {}, read).flatMap((report) =>
    report.gaps.map((gap) => ({
      id: `${report.name}:${gap.suite ?? "config"}:${gap.code}`,
      line: gap.line,
      needs: [report.name],
      fix: outside(`recognizer help sensors ${report.name}`),
    })),
  );
}
