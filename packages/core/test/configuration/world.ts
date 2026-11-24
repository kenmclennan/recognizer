import {
  type ConfigurationPorts,
  PolicyRule,
  type Repository,
} from "../../src/index.js";
import {
  configurationPortsOf,
  createFakes,
  type Fakes,
} from "../fakes/container.js";
import { repositoryOf } from "../fakes/repository-of.js";

export const ROOT = "/work/repository";

export interface ConfigurationWorld {
  fakes: Fakes;
  ports: ConfigurationPorts;
}

export function worldOf(): ConfigurationWorld {
  const fakes = createFakes();

  fakes.repositoryChecks.directories.add(ROOT);
  fakes.setupFiles.directory(ROOT);

  return { fakes, ports: configurationPortsOf(fakes) };
}

export function seedFiles(world: ConfigurationWorld, paths: string[]): void {
  for (const path of paths) {
    world.fakes.setupFiles.seed(`${ROOT}/${path}`, "");
  }
}

export function scanOfFiles(
  paths: string[],
  language = "typescript",
): Repository {
  return repositoryOf(
    Object.fromEntries(paths.map((path) => [path, "h"])),
    [],
    language,
  );
}

export function ignoring(glob: string): PolicyRule[] {
  return [PolicyRule.of({ type: "ignore", glob })];
}
