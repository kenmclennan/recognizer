import { InvalidRequest } from "../../domain/invalid-request.js";
import { joinPath } from "../../domain/path.js";
import {
  buildReport,
  type DoctorFacts,
  type DoctorReport,
  type PluginFact,
  type PluginSpec,
} from "../../domain/plugins/doctor-report.js";
import { KINDS, PREFIXES } from "../../domain/plugins/installed-plugin.js";
import {
  interpretManifest,
  judgeProtocol,
  MANIFEST_TIMEOUT_MS,
  type ManifestRead,
} from "../../domain/plugins/manifest.js";
import { checkSensor } from "./check-sensor.js";
import { discoverPlugins } from "./discover-plugins.js";
import {
  readInstalledSensors,
  readRegisteredSensors,
  runsTests,
  withRegistered,
  withSuiteSettings,
} from "./installed-sensors.js";
import type { PluginPorts } from "./internal/plugin-ports.js";
import { NO_RUN_LINE, probeDescriberCheck } from "./probe-describer-check.js";
import { readConfigArea } from "./read-config-area.js";
import { readManifest, readManifestCommand } from "./read-manifest.js";
import { readPolicyArea } from "./read-policy-area.js";

type DiagnosePorts = Pick<
  PluginPorts,
  "programs" | "validators" | "repository" | "registrations"
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

function filled(words: readonly string[], root: string): string[] {
  return words.map((word) => word.split("{repository}").join(root));
}

function sensorFact(
  ports: DiagnosePorts,
  root: string,
  spec: PluginSpec,
  suites: readonly unknown[] | undefined,
): PluginFact {
  const words = filled(spec.manifest ?? [], root);
  const [program, ...rest] = words as [string, ...string[]];
  const run = ports.programs.run(program, rest, {
    timeoutMs: MANIFEST_TIMEOUT_MS,
  });

  if (!run.started) {
    return { ...spec, state: { status: "missing" } };
  }

  const read: ManifestRead = interpretManifest(words.join(" "), run, (value) =>
    ports.validators.manifest(value),
  );

  if (!read.ok) {
    return { ...spec, state: { status: "unreadable", reason: read.reason } };
  }

  const { manifest } = read;
  const judgement = judgeProtocol(manifest, ports.validators.facts.protocol);
  const wantsCheck = manifest.check && judgement !== "unsupported";
  const report = wantsCheck
    ? checkSensor(
        ports,
        root,
        {
          name: spec.subject,
          command: withSuiteSettings(
            spec.command,
            withRegistered(
              { sensors: [], unreadable: [] },
              readRegisteredSensors(
                [
                  {
                    name: spec.subject,
                    command: spec.command,
                    manifest: spec.manifest,
                  },
                ],
                () => read,
              ),
            ),
            suites,
          ),
          manifest: spec.manifest,
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
          : [],
    },
  };
}

function pluginFact(
  ports: DiagnosePorts,
  root: string,
  spec: PluginSpec,
  suites: readonly unknown[] | undefined,
): PluginFact {
  if (spec.kind === "sensor") {
    return sensorFact(ports, root, spec, suites);
  }

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

  return {
    ...spec,
    state: {
      status: "read",
      manifest,
      judgement,
      gaps: !wantsCheck
        ? null
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

  const installed = withRegistered(
    readInstalledSensors(ports),
    readRegisteredSensors(
      registered.specs
        .filter((spec) => spec.kind === "sensor")
        .map((spec) => ({
          name: spec.subject,
          command: spec.command,
          manifest: spec.manifest,
        })),
      (words) => readManifestCommand(ports, words),
    ),
  );

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

function unregisteredPrograms(
  ports: DiagnosePorts,
): DoctorFacts["unregisteredPrograms"] {
  const registered = new Set(
    ports.registrations
      .entries()
      .plugins.map((entry) => `${PREFIXES[entry.kind]}${entry.name}`),
  );
  const found: DoctorFacts["unregisteredPrograms"] = [];

  for (const entry of ports.programs.listOnPath(
    KINDS.map((kind) => PREFIXES[kind]),
  )) {
    const kind = KINDS.find(
      (one) =>
        entry.name.startsWith(PREFIXES[one]) &&
        entry.name.length > PREFIXES[one].length,
    );

    if (kind === undefined || registered.has(entry.name)) {
      continue;
    }

    const path = joinPath(entry.directory, entry.name);
    const read = readManifest(ports, path);

    found.push({
      kind,
      program: entry.name,
      path,
      installLine: read.ok ? read.manifest.install : null,
    });
  }

  return found;
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
  const config = readConfigArea(ports.repository, root, named);
  const facts: DoctorFacts = {
    repository: root,
    configProblems: config.problems,
    registered: config.registered,
    policyProblems: readPolicyArea(ports.repository, root, named, languages),
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
    unregisteredPrograms: unregisteredPrograms(ports),
    protocol: ports.validators.facts,
  };

  return buildReport(facts);
}
