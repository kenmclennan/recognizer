import { createHash } from "node:crypto";
import { vi } from "vitest";
import {
  type Program,
  type Line as ServeLine,
  sensorManifest,
  sensorProgram,
  serveRoot,
  typescriptScanner,
} from "../../cli/test/support/index";
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
  record?: (
    command: string,
    args: Record<string, unknown>,
    reply: unknown,
    lines: readonly Line[],
  ) => void;
};

const DEFAULT_CONFIG =
  "sensors:\n  crap:\n    manifest: [recognizer-sense-crap, manifest]\n  mutation:\n    manifest: [recognizer-sense-mutation, manifest]\n";

function sha256(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}

function appSensor(
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
  root.repositories.commitAll(REPOSITORY, "initial");

  const started: Line[] = [];
  let forwarded = 0;

  const flush = () => {
    for (; forwarded < root.lines.length; forwarded += 1) {
      const line = root.lines[forwarded] as ServeLine;

      if (typeof line.id !== "number") {
        for (const handler of bridge.listeners.get("core-event") ?? []) {
          handler({ payload: line });
        }
      }
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

  const answer = async (command: string, args: Record<string, unknown>) => {
    switch (command) {
      case "core_call": {
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
        return { branch: "main", commit: "abc" };
      case "read_scan_ticks":
        return {
          describe: false,
          analysis: false,
          sensors: false,
          ticked: ["crap", "mutation"],
          remembered: true,
          suites: {},
          folds: [],
        };
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
    repository: REPOSITORY,
    io: root.io,
    lines: root.lines,
    testFile: `${REPOSITORY}/api/tests/a.test.ts`,
  };
}
