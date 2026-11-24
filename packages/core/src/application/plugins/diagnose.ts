import { InvalidRequest } from "../../domain/invalid-request.js";
import {
  buildReport,
  type DoctorFacts,
  type DoctorReport,
  type PluginFact,
  type PluginSpec,
} from "../../domain/plugins/doctor-report.js";
import { judgeProtocol } from "../../domain/plugins/manifest.js";
import { checkSensor } from "./check-sensor.js";
import { discoverPlugins } from "./discover-plugins.js";
import {
  readInstalledSensors,
  runsTests,
  sensorNameOf,
  withSuiteSettings,
} from "./installed-sensors.js";
import type { PluginPorts } from "./internal/plugin-ports.js";
import { NO_RUN_LINE, probeDescriberCheck } from "./probe-describer-check.js";
import { readManifest } from "./read-manifest.js";

type DiagnosePorts = Pick<
  PluginPorts,
  "programs" | "validators" | "repository"
>;

function describerCheckLines(
  ports: DiagnosePorts,
  root: string,
  command: readonly string[],
): string[] {
  const check = probeDescriberCheck(
    (program, args, cwd) => ports.programs.run(program, args, { cwd }),
    root,
    command,
  );

  if (check.kind === "passed") {
    return [];
  }

  if (check.kind === "no-run") {
    return [NO_RUN_LINE];
  }

  return [
    check.started
      ? `${check.program} check exited ${check.status ?? "without a status"}`
      : `${check.program} check could not be started`,
  ];
}

function pluginFact(
  ports: DiagnosePorts,
  root: string,
  spec: PluginSpec,
  suites: readonly unknown[] | undefined,
): PluginFact {
  const found = ports.programs.find(spec.program);

  if (found === null) {
    return { ...spec, state: { status: "missing" } };
  }

  const read = readManifest(ports, found);

  if (!read.ok) {
    return { ...spec, state: { status: "unreadable", reason: read.reason } };
  }

  const { manifest } = read;
  const judgement = judgeProtocol(manifest, ports.validators.facts.protocol);
  const wantsCheck = manifest.check && judgement !== "unsupported";
  const report =
    wantsCheck && spec.kind === "sensor"
      ? checkSensor(
          ports,
          root,
          {
            name: spec.subject,
            command: [
              found,
              ...withSuiteSettings(
                spec.command,
                readInstalledSensors(
                  ports,
                  () => read,
                  [sensorNameOf(spec.command)].filter(
                    (name): name is string => name !== undefined,
                  ),
                ),
                suites,
              ).slice(1),
            ],
          },
          {},
          () => read,
        )
      : null;

  return {
    ...spec,
    state: {
      status: "read",
      manifest,
      judgement,
      gaps: !wantsCheck
        ? null
        : report !== null
          ? report.gaps.map((gap) => gap.line)
          : describerCheckLines(ports, root, [found, ...spec.command.slice(1)]),
    },
  };
}

function testsUnrun(
  ports: DiagnosePorts,
  registered: DoctorFacts["registered"],
  suites: readonly unknown[] | undefined,
): DoctorFacts["testsUnrun"] {
  if (suites === undefined || "skipped" in registered) {
    return [];
  }

  const installed = readInstalledSensors(ports);

  const running = registered.specs.some(
    (spec) => spec.kind === "sensor" && runsTests(spec.command, installed),
  );

  if (running) {
    return [];
  }

  return installed.sensors
    .filter(
      (entry) => entry.runs_tests && !registered.sensors.includes(entry.name),
    )
    .map((entry) => ({ name: entry.name, display: entry.display }));
}

export function diagnose(
  ports: DiagnosePorts,
  root: string,
  named: boolean,
): DoctorReport {
  if (!ports.repository.isDirectory(root)) {
    throw new InvalidRequest([`repository is not a directory: ${root}`]);
  }

  const scanners = discoverPlugins(ports, ["scanner"]).plugins;
  const languages = ports.repository.languages(root, scanners);
  const config = ports.repository.config(root, named);
  const facts: DoctorFacts = {
    repository: root,
    configProblems: config.problems,
    registered: config.registered,
    policyProblems: ports.repository.policy(root, named, languages),
    languages,
    scanners,
    plugins: (specs) => {
      const suites = ports.repository.suites(root);

      return specs.map((spec) => pluginFact(ports, root, spec, suites));
    },
    testsUnrun: testsUnrun(
      ports,
      config.registered,
      ports.repository.suites(root),
    ),
    protocol: ports.validators.facts,
  };

  return buildReport(facts);
}
