import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Program } from "../../cli/test/support/index";
import {
  committedScan,
  event,
  Gate,
  typescriptScanner,
} from "../../cli/test/support/index";
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

type Root = Awaited<ReturnType<typeof inProcessAppRoot>>;

export type LookStage = {
  name: string;
  run: (root: Root) => Promise<void>;
};

export type LookScenario = {
  config?: string;
  answers?: Record<string, unknown>;
  warm?: (root: Root) => Promise<void>;
  files?: Record<string, string | ((commit: string) => string)>;
  programs?: Record<string, Program>;
  origin?: { branch: string; commit: string };
  ticks?: Record<string, unknown>;
  armed?: string[];
  plans?: {
    mode?: string;
    ticks?: Record<string, unknown>;
    scope?: string[] | null;
    changed?: string[];
  }[];
  hostEvents?: { event: string; payload: unknown }[];
  stages?: LookStage[];
};

export type Diagnosis = { code: string; line: string; fix?: string };

export type LookRecording = Recording & { produced: Loaded };

export { Gate };

export function digestOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function testsDigestOf(files: Record<string, string>): string {
  const lines = Object.keys(files)
    .sort()
    .map((path) => `${path}\t${digestOf(files[path] as string)}\n`);

  return digestOf(lines.join(""));
}

const LANGUAGE_RULES = JSON.parse(
  readFileSync(
    join(__dirname, "../../../fixtures/plugins/languages.json"),
    "utf8",
  ),
) as { name: string }[];

export function scanProgram(
  document: Record<string, unknown>,
  languages?: string[],
): Program {
  const base = typescriptScanner();
  const envelope = committedScan();

  return (call) => {
    if (call.args[0] !== "run") {
      const result = base(call);

      if (call.args[0] !== "manifest" || languages === undefined) {
        return result;
      }

      const manifest = JSON.parse((result as { stdout: string }).stdout);

      manifest.languages = LANGUAGE_RULES.filter((rule) =>
        languages.includes(rule.name),
      );

      return {
        ...(result as object),
        stdout: JSON.stringify(manifest),
      } as ReturnType<Program>;
    }

    const at = (flag: string) => {
      const index = call.args.indexOf(flag);

      return index < 0 ? undefined : call.args[index + 1];
    };
    const output = at("--output");
    const modified = at("--modified");

    if (output !== undefined) {
      call.files.writeFile(
        output,
        `${JSON.stringify({
          schema_version: envelope.schema_version,
          scanner: envelope.scanner,
          selection: envelope.selection,
          calls: [],
          test_imports: [],
          ...document,
          modules: ((document.modules ?? []) as Record<string, unknown>[]).map(
            (module) => ({ language: "python", members: [], ...module }),
          ),
          commit: at("--commit") ?? null,
          modified: modified === undefined ? null : modified === "true",
        })}\n`,
      );
    }

    return { started: true, status: 0, stdout: "", stderr: "" };
  };
}

export function heldProgram(program: Program, gate: Gate): Program {
  return (call) => {
    if (call.args[0] !== "run") {
      return program(call);
    }

    return (async () => {
      await Promise.race([gate.wait(), call.whenKilled()]);

      if (call.killed) {
        return { started: true, status: 143, stdout: "", stderr: "" };
      }

      return program(call);
    })();
  };
}

export function failingProgram(
  program: Program,
  diagnosis?: Diagnosis,
): Program {
  return (call) => {
    if (call.args[0] !== "run") {
      return program(call);
    }

    if (diagnosis !== undefined) {
      call.stderr(
        event({
          event: "diagnosis",
          code: diagnosis.code,
          text: diagnosis.line,
          ...(diagnosis.fix === undefined ? {} : { fix: diagnosis.fix }),
        }),
      );
    }

    return { started: true, status: 1, stdout: "", stderr: "" };
  };
}

const runOf = (lines: Record<string, unknown>[]) => {
  const states = lines.filter(
    (line) => typeof line.state === "object" && line.state !== null,
  );
  const last = states[states.length - 1]?.state as
    | { run?: unknown }
    | undefined;

  return last?.run ?? null;
};

async function settled(root: Root): Promise<void> {
  for (let round = 0; round < 200; round += 1) {
    if (runOf(root.lines as Record<string, unknown>[]) === null) {
      return;
    }

    await root.service.signal(50);
  }
}

const isEvent = (line: Record<string, unknown>) => typeof line.id !== "number";

export async function lookRoot(
  scenario: LookScenario = {},
): Promise<LookRecording> {
  const commands: RecordedCommand[] = [];
  const root = await inProcessAppRoot({
    ...(scenario.config === undefined ? {} : { config: scenario.config }),
    ...(scenario.files === undefined ? {} : { files: scenario.files }),
    ...(scenario.programs === undefined ? {} : { programs: scenario.programs }),
    ...(scenario.origin === undefined ? {} : { origin: scenario.origin }),
    ...(scenario.ticks === undefined ? {} : { ticks: scenario.ticks }),
    record: (command, args, reply, lines) =>
      commands.push({
        command,
        args,
        reply: JSON.parse(JSON.stringify(reply ?? null)),
        at: lines.filter(isEvent).length,
      }),
  });

  await untilHolds(root.service, () => root.view.loaded() ?? undefined);

  await scenario.warm?.(root);
  await root.service.signal(50);
  await settled(root);

  const planArgs = {
    repository: root.repository,
    mode: "bring",
    ticks: {
      describe: false,
      analysis: false,
      ticked: [],
      armed: scenario.armed ?? ["crap"],
      onlyView: false,
      suites: {},
      folds: [],
    },
    scope: null,
    changed: (scenario.hostEvents ?? []).flatMap(
      ({ payload }) =>
        (payload as { files?: { path: string }[] }).files?.map(
          ({ path }) => path,
        ) ?? [],
    ),
  };

  commands.push({
    command: "core_call",
    args: { op: "scan.plan", args: planArgs },
    reply: JSON.parse(
      JSON.stringify(await root.service.call("scan.plan", planArgs)),
    ),
    at: root.lines.filter(isEvent).length,
  });

  for (const variant of scenario.plans ?? []) {
    const asked = {
      ...planArgs,
      ...(variant.mode === undefined ? {} : { mode: variant.mode }),
      ticks: { ...planArgs.ticks, ...variant.ticks },
      ...(variant.scope === undefined ? {} : { scope: variant.scope }),
      ...(variant.changed === undefined ? {} : { changed: variant.changed }),
    };

    commands.push({
      command: "core_call",
      args: { op: "scan.plan", args: asked },
      reply: JSON.parse(
        JSON.stringify(await root.service.call("scan.plan", asked)),
      ),
      at: root.lines.filter(isEvent).length,
    });
  }

  const marks: Record<string, number> = {};

  for (const stage of scenario.stages ?? []) {
    await stage.run(root);
    await root.service.signal(50);
    marks[stage.name] = root.lines.filter(isEvent).length;
  }

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
      .filter(isEvent)
      .map((line) => JSON.parse(JSON.stringify(line))),
    answers: scenario.answers ?? {},
    marks,
    hostEvents: scenario.hostEvents ?? [],
    produced,
  };
}

export async function lookRoots(
  scenarios: Record<string, LookScenario>,
): Promise<Record<string, LookRecording>> {
  const recordings: Record<string, LookRecording> = {};

  for (const [name, scenario] of Object.entries(scenarios)) {
    recordings[name] = await lookRoot(scenario);
  }

  return recordings;
}
