import type { Program } from "./io/processes.js";
import {
  type ScannerScript,
  seedTypescriptRepository,
  typescriptScanner,
} from "./scanner-program.js";
import { type SensorScript, sensorProgram } from "./sensor-program.js";
import {
  type ServeRoot,
  type ServeRootOptions,
  serveRoot,
} from "./serve-root.js";

export const REPOSITORY = "/repo";

export interface ScenarioOptions extends Omit<ServeRootOptions, "programs"> {
  sample?: boolean;
  sensors?: string[];
  scripts?: Record<string, SensorScript>;
  scanner?: ScannerScript;
  programs?: Record<string, Program>;
  registered?: string[];
  repository?: string;
}

export interface Scenario {
  root: ServeRoot;
  repository: string;
}

export function typescriptScenario(options: ScenarioOptions = {}): Scenario {
  const repository = options.repository ?? REPOSITORY;
  const sensors = options.sensors ?? [];
  const programs: Record<string, Program> = {
    "recognizer-scan-typescript": typescriptScanner(options.scanner),
    ...options.programs,
  };

  for (const name of sensors) {
    programs[`recognizer-sense-${name}`] = sensorProgram(
      name,
      options.scripts?.[name],
    );
  }

  const root = serveRoot({ ...options, programs });
  const registered = options.registered ?? sensors;

  if (options.sample === false) {
    root.io.files.writeFile(
      `${repository}/.gitignore`,
      ".recognizer/cache/\nnode_modules/\n",
    );
  } else {
    seedTypescriptRepository(root.io.files, repository);
  }

  if (registered.length > 0) {
    root.io.files.writeFile(
      `${repository}/.recognizer/config.yaml`,
      `sensors:\n${registered.map((name) => `  ${name}: {}`).join("\n")}\n`,
    );
  }

  root.repositories.commitAll(repository, "initial");

  return { root, repository };
}
