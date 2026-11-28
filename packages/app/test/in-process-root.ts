import { createHash } from "node:crypto";
import { vi } from "vitest";
import {
  type Gate,
  type Program,
  type Line as ServeLine,
  sensorManifest,
  sensorProgram,
  serveRoot,
  typescriptScanner,
} from "../../cli/test/support/index";
import type { StoredTicks } from "../src/scan-port";
import {
  bridge,
  cleanups,
  type Line,
  type RecordingView,
  recordingView,
} from "./app-harness";

export const REPOSITORY = "/app-root-repository";

export type InProcessRootOptions = {
  stamped?: boolean;
  config?: string;
  folderKnown?: boolean;
  files?: Record<string, string | ((commit: string) => string)>;
  programs?: Record<string, Program>;
  origin?: { branch: string; commit: string };
  failing?: string[];
  rejects?: Record<string, string>;
  holds?: Record<string, Gate>;
  ticks?: Record<string, unknown>;
  describing?: {
    model: string | null;
    batchSize: number;
    confirmAboveUsd: number;
  };
  uncommitted?: boolean;
  record?: (
    command: string,
    args: Record<string, unknown>,
    reply: unknown,
    lines: readonly Line[],
  ) => void;
};

const FIXED_TICKS: StoredTicks = {
  describe: false,
  analysis: false,
  sensors: false,
  ticked: ["crap", "mutation"],
  remembered: true,
  suites: {},
  folds: [],
};

const DEFAULT_CONFIG =
  "sensors:\n  crap:\n    manifest: [recognizer-sense-crap, manifest]\n  mutation:\n    manifest: [recognizer-sense-mutation, manifest]\n";

function sha256(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}

export function appSensor(
  name: string,
  runsTests: boolean,
  stamped: boolean,
  hashOf: (path: string) => string,
): Program {
  const base = sensorProgram(name);

  return (call) => {
    const [verb] = call.args;
    const done = { started: true, status: 0, stderr: "" };

    if (verb === "manifest") {
      const manifest = JSON.parse(sensorManifest(name));

      manifest.display = name === "crap" ? "C.R.A.P." : "Mutation";
      manifest.runs_tests = runsTests;

      if (runsTests) {
        manifest.planned_work = { verb: "mutate" };
      }

      return { ...done, stdout: JSON.stringify(manifest) };
    }

    if (verb === "check") {
      return {
        ...done,
        stdout: call.args.includes("--work")
          ? '{"gaps":[],"work":{"unit":"functions","to_perform":3,"reusable":0}}'
          : '{"gaps":[]}',
      };
    }

    if (verb === "run" && stamped) {
      const at = (flag: string) => call.args[call.args.indexOf(flag) + 1] ?? "";
      const tests = `api/tests/a.test.ts\t${hashOf("api/tests/a.test.ts")}\n`;

      call.files.writeFile(
        at("--output"),
        JSON.stringify({
          findings_version: 2,
          sensor: { name, version: "1" },
          commit: at("--commit"),
          modified: false,
          settings: {},
          findings: [],
          inputs: { "api/src/a.ts": hashOf("api/src/a.ts") },
          tests: sha256(tests),
        }),
      );

      return { ...done, stdout: "" };
    }

    return base(call);
  };
}

export async function inProcessAppRoot(options: InProcessRootOptions = {}) {
  const stamped = options.stamped ?? false;
  const hashOf = (path: string): string =>
    sha256(root.io.files.readBytes(`${REPOSITORY}/${path}`));
  const root = serveRoot({
    programs: {
      "recognizer-scan-typescript": typescriptScanner(),
      "recognizer-sense-crap": appSensor("crap", false, stamped, hashOf),
      "recognizer-sense-mutation": appSensor("mutation", true, stamped, hashOf),
      ...options.programs,
    },
  });
  const files = root.io.files;

  files.writeFile(`${REPOSITORY}/api/src/a.ts`, "export const a = 1;\n");
  files.writeFile(`${REPOSITORY}/api/tests/a.test.ts`, "export const t = 1;\n");
  files.writeFile(
    `${REPOSITORY}/package.json`,
    JSON.stringify({ private: true, workspaces: ["api"] }),
  );
  files.writeFile(
    `${REPOSITORY}/api/package.json`,
    JSON.stringify({ name: "@sample/api", type: "module" }),
  );
  files.writeFile(
    `${REPOSITORY}/.recognizer/config.yaml`,
    options.config ?? DEFAULT_CONFIG,
  );
  files.writeFile(
    `${REPOSITORY}/.gitignore`,
    ".recognizer/cache/\nnode_modules/\n",
  );

  const written = (path: string) =>
    path.startsWith("/") ? path : `${REPOSITORY}/${path}`;
  const given = Object.entries(options.files ?? {});

  for (const [path, text] of given) {
    if (typeof text === "string") {
      files.writeFile(written(path), text);
    }
  }

  const head = options.uncommitted
    ? ""
    : root.repositories.commitAll(REPOSITORY, "initial");

  for (const [path, text] of given) {
    if (typeof text !== "string") {
      files.writeFile(written(path), text(head));
    }
  }

  const started: Line[] = [];
  const batches: number[] = [];
  let forwarded = 0;
  let delivered = 0;

  const flush = () => {
    const before = delivered;

    for (; forwarded < root.lines.length; forwarded += 1) {
      const line = root.lines[forwarded] as ServeLine;

      if (typeof line.id !== "number") {
        delivered += 1;

        for (const handler of bridge.listeners.get("core-event") ?? []) {
          handler({ payload: line });
        }
      }
    }

    if (delivered > before) {
      batches.push(delivered);
    }
  };

  const service = {
    started,
    call: async (op: string, args: Record<string, unknown>) => {
      if (op === "scan.start") {
        started.push(args);
      }

      const reply = await root.call(op, args);

      flush();

      return reply as Line;
    },
    signal: async (ms: number) => {
      await root.advance(ms);
      flush();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    },
  };

  cleanups.push(() => {
    void root.close();
  });

  const folder = { known: options.folderKnown ?? true };

  let stored: StoredTicks = { ...FIXED_TICKS, ...options.ticks };
  const ticksWritten: Record<string, unknown>[] = [];

  const answer = async (command: string, args: Record<string, unknown>) => {
    const held = options.holds?.[command];

    if (held !== undefined) {
      await held.wait();
    }

    if (command !== "core_call" && options.failing?.includes(command)) {
      throw new Error(`${command} failed`);
    }

    switch (command) {
      case "core_call": {
        if (options.failing?.includes(String(args.op))) {
          throw new Error(`${String(args.op)} failed`);
        }

        const rejected = options.rejects?.[String(args.op)];

        if (rejected !== undefined) {
          throw rejected;
        }

        const heldOp = options.holds?.[String(args.op)];

        if (heldOp !== undefined) {
          await heldOp.wait();
        }

        const request = { ...(args.args as Record<string, unknown>) };

        delete request.repository;

        return service.call(
          String(args.op),
          folder.known ? { ...request, repository: REPOSITORY } : request,
        );
      }
      case "window_folder":
        return folder.known ? REPOSITORY : null;
      case "adopt_scan":
        return options.origin ?? { branch: "main", commit: "abc" };
      case "read_scan_ticks":
        return stored;
      case "write_scan_ticks":
        ticksWritten.push(args);
        stored = {
          ...stored,
          describe: Boolean(args.describe),
          analysis: Boolean(args.analysis),
          ticked: args.ticked as string[],
          onlyView: Boolean(args.onlyView),
          suites: args.suites as StoredTicks["suites"],
          folds: args.folds as string[],
          remembered: true,
        };

        return undefined;
      case "read_describing":
        return (
          options.describing ?? {
            model: null,
            batchSize: 3,
            confirmAboveUsd: 0,
          }
        );
      default:
        return undefined;
    }
  };

  bridge.invoke = async (command, args = {}) => {
    const reply = await answer(command, args);

    options.record?.(command, args, reply, root.lines);

    return reply;
  };

  vi.resetModules();

  const { composeApp } = await import("../src/app-root");
  const view: RecordingView = recordingView();
  const app = composeApp(view);

  const assignFolder = () => {
    folder.known = true;

    for (const handler of bridge.listeners.get("folder-assigned") ?? []) {
      handler({ payload: null });
    }
  };

  return {
    app,
    view,
    assignFolder,
    service,
    ticksWritten,
    repository: REPOSITORY,
    io: root.io,
    repositories: root.repositories,
    second: () =>
      serveRoot({
        files: root.io.files,
        repositories: root.repositories,
        programs: {
          "recognizer-scan-typescript": typescriptScanner(),
          ...options.programs,
        },
      }),
    lines: root.lines,
    batches,
    testFile: `${REPOSITORY}/api/tests/a.test.ts`,
  };
}
