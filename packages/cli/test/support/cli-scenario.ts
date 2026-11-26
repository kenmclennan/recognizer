import { type CliRoot, cliRoot } from "../roots.js";
import {
  type Scenario,
  type ScenarioOptions,
  typescriptScenario,
} from "./scenario.js";

export interface CliScenarioOptions extends Omit<ScenarioOptions, "files"> {
  files?: Record<string, string | Record<string, unknown>>;
}

export interface CliRun {
  exit: number;
  out: string;
  err: string;
}

export interface CliScenario extends Scenario {
  cli: CliRoot;
  run(argv: string[]): Promise<CliRun>;
  read(path: string): string;
  readJson<T = unknown>(path: string): T;
  exists(path: string): boolean;
}

export function cliScenario(options: CliScenarioOptions = {}): CliScenario {
  const { files = {}, ...scenarioOptions } = options;
  const scenario = typescriptScenario(scenarioOptions);
  const { repository, root } = scenario;
  const seeded = Object.entries(files);

  for (const [path, content] of seeded) {
    root.io.files.writeFile(
      `${repository}/${path}`,
      typeof content === "string"
        ? content
        : `${JSON.stringify(content, null, 2)}\n`,
    );
  }

  if (seeded.length > 0) {
    root.repositories.commitAll(repository, "seed files");
  }

  const at = (path: string) =>
    path.startsWith("/") ? path : `${repository}/${path}`;

  return {
    ...scenario,
    cli: cliRoot({ over: root.io }),
    run: async (argv) => {
      const cli = cliRoot({ over: root.io });
      const exit = await cli.run(argv);

      return { exit, out: cli.out(), err: cli.err() };
    },
    read: (path) => root.io.files.readFile(at(path)),
    readJson: (path) => JSON.parse(root.io.files.readFile(at(path))),
    exists: (path) => root.io.files.exists(at(path)),
  };
}
