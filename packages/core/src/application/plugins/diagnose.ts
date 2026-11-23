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
import type { PluginPorts } from "./internal/plugin-ports.js";
import { readManifest, readManifestOf } from "./read-manifest.js";
import {
  readShippedSensors,
  shippedSensorOf,
  withSuiteSettings,
} from "./shipped-plugins.js";

type DiagnosePorts = Pick<
  PluginPorts,
  "programs" | "validators" | "shipped" | "repository"
>;

function describerGaps(
  ports: DiagnosePorts,
  root: string,
  program: string,
): string[] {
  const result = ports.programs.run(program, ["check"], { cwd: root });

  if (result.started && result.status === 0) {
    return [];
  }

  return [
    result.started
      ? `${program} check exited ${result.status ?? "without a status"}`
      : `${program} check could not be started`,
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
                readShippedSensors(
                  ports,
                  () => read,
                  [
                    shippedSensorOf(spec.command, ports.shipped.sensors()),
                  ].filter((name): name is string => name !== undefined),
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
          : describerGaps(ports, root, found),
    },
  };
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
  const describerName = ports.shipped.describers()[0] ?? "";
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
    shipped: {
      sensors: ports.shipped
        .sensors()
        .filter(
          (name) => ports.programs.find(`recognizer-sense-${name}`) !== null,
        ),
      describer: ports.repository.describerShipped(root),
      describerName,
    },
    shippedDisplay: (kind, name) => {
      const program =
        kind === "sensor"
          ? `recognizer-sense-${name}`
          : `recognizer-describe-${name}`;
      const read = readManifestOf(ports, [program]);

      return read.ok ? read.manifest.display : undefined;
    },
    protocol: ports.validators.facts,
  };

  return buildReport(facts);
}
