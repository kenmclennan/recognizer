import type { Loaded } from "../src/scan-loading";
import type { ScanReport } from "../src/scan-report";
import { coreReply } from "../src/scan-source";
import { untilHolds } from "./app-harness";
import { inProcessAppRoot } from "./in-process-root";
import {
  type RecordedCommand,
  type Recording,
  serialiseLoaded,
} from "./look-recording";

export type LookScenario = {
  config?: string;
  answers?: Record<string, unknown>;
  warm?: (root: Awaited<ReturnType<typeof inProcessAppRoot>>) => Promise<void>;
};

export type LookRecording = Recording & { produced: Loaded };

export async function lookRoot(
  scenario: LookScenario = {},
): Promise<LookRecording> {
  const commands: RecordedCommand[] = [];
  const root = await inProcessAppRoot({
    ...(scenario.config === undefined ? {} : { config: scenario.config }),
    record: (command, args, reply) =>
      commands.push({
        command,
        args,
        reply: JSON.parse(JSON.stringify(reply ?? null)),
      }),
  });

  await untilHolds(root.service, () => root.view.loaded() ?? undefined);

  await scenario.warm?.(root);
  await root.service.signal(50);

  const produced = root.view.loaded() as Loaded;
  const read = [...commands]
    .reverse()
    .find(
      ({ command, args }) =>
        command === "core_call" && args.op === "structure.read",
    );
  const documents =
    read === undefined ? [] : coreReply<ScanReport>(read.reply).scans;

  return {
    loaded: serialiseLoaded(produced, documents),
    commands,
    events: root.lines
      .filter((line) => typeof line.id !== "number")
      .map((line) => JSON.parse(JSON.stringify(line))),
    answers: scenario.answers ?? {},
    produced,
  };
}
