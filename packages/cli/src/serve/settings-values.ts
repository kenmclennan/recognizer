import {
  appSettingsProblem,
  describingValues,
  discoverPlugins,
  publishedModel,
  setupValues,
} from "@recognizer/core";
import type { Io } from "../cli.js";
import { manifestPorts } from "../manifest-ports.js";

function object(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function describerModel(io: Io): string | null {
  for (const plugin of discoverPlugins(manifestPorts(io), ["describer"])
    .plugins) {
    const model = publishedModel(plugin.manifest.settings);

    if (model !== null) {
      return model;
    }
  }

  return null;
}

export function settingsValuesReply(
  io: Io,
  args: Record<string, unknown>,
): unknown {
  const describing = object(args.describing);
  const setup = object(args.setup);
  const problem = appSettingsProblem({
    describing: args.describing,
    setup: args.setup,
  });

  if (problem !== null) {
    return { problem, values: null };
  }

  const needsDefault =
    args.with_model_default === true &&
    (describing.model === undefined || describing.model === null);

  return {
    problem: null,
    values: {
      describing: describingValues(describing, {
        model: needsDefault ? describerModel(io) : null,
      }),
      setup: setupValues(setup),
    },
  };
}
