import {
  documentFreshness,
  identityKey,
  Repository,
  splitDocument,
  suiteStandings,
} from "@recognizer/core";
import {
  describerOfConfigText,
  InputError,
  parseBaseline,
  parseConfig,
  parsePolicy,
  readFindingsText,
  readOverlayText,
  registeredSensorNamesIn,
} from "recognizer";
import type { PlannedWork } from "./estimate-text";
import {
  type InstalledSensor,
  type InstalledSensors,
  NO_INPUTS,
  type Refusal,
  type SensorInputs,
  type SensorsPort,
  type StoredResults,
  type WorkRequest,
} from "./sensor-run";

export type FakeInputs = {
  policy: string | null;
  config: string | null;
  baseline: string | null;
  refused: string[];
};

export type FakeSensors = SensorsPort & {
  files: Map<string, string>;
  texts: FakeInputs;
  structure: Repository | null;
  lastRun: string | null;
  refused: string[];
  overlays: Map<string, string>;
  modifiedOverlays: Map<string, number>;
  overlaysRefused: string[];
  refusals: Record<string, Refusal>;
  testsHash: string | null;
  removed: string[];
  list: InstalledSensors;
  modified: Map<string, number>;
  work: Map<string, PlannedWork | null>;
  workRequests: WorkRequest[];
  holdWork: boolean;
  releaseWork(): void;
  editInputs(inputs: Partial<FakeInputs>): void;
};

function problemOf(error: unknown): string {
  return error instanceof InputError
    ? [...new Set(error.messages)].join("; ")
    : (error as Error).message;
}

export function typedInputs(given: Partial<FakeInputs>): SensorInputs {
  const texts: FakeInputs = {
    policy: null,
    config: null,
    baseline: null,
    refused: [],
    ...given,
  };

  const attempt = <T>(text: string | null, parse: (text: string) => T) => {
    if (text === null) {
      return { value: null, problem: null };
    }

    try {
      return { value: parse(text), problem: null };
    } catch (error) {
      return { value: null, problem: problemOf(error) };
    }
  };
  const config = attempt(texts.config, (text) => parseConfig(text));
  const policy = attempt(texts.policy, parsePolicy);
  const baseline = attempt(texts.baseline, (text) =>
    parseBaseline(text).map(identityKey),
  );

  return {
    ...NO_INPUTS,
    configText: texts.config,
    config: config.value,
    configProblem: config.problem,
    registeredSensors:
      texts.config === null ? [] : registeredSensorNamesIn(texts.config),
    policy: policy.value,
    policyProblem: policy.problem,
    baseline: baseline.value,
    baselineProblem: baseline.problem,
    refused: texts.refused,
  };
}

export function fakeSensors(
  files: Record<string, string> = {},
  inputs: Partial<FakeInputs> = {},
  overlays: Record<string, string> = {},
  installed: InstalledSensors | InstalledSensor[] = [],
): FakeSensors {
  const listed: InstalledSensor[] = Array.isArray(installed)
    ? installed
    : installed.status === "ok"
      ? installed.sensors
      : [];
  const registersEverything = [
    "describer:\n  command: [describer]\n  version: v1",
    "sensors:",
    ...listed.map(({ name }) => `  ${name}: {}`),
  ].join("\n");
  const held: (() => void)[] = [];
  const fake: FakeSensors = {
    files: new Map(Object.entries(files)),
    texts: {
      policy: null,
      config: listed.length === 0 ? null : `${registersEverything}\n`,
      baseline: null,
      refused: [],
      ...inputs,
    },
    structure: null,
    lastRun: null,
    refused: [],
    overlays: new Map(Object.entries(overlays)),
    modifiedOverlays: new Map(),
    overlaysRefused: [],
    refusals: {},
    testsHash: null,
    removed: [],
    list: Array.isArray(installed)
      ? { status: "ok", sensors: installed }
      : installed,
    modified: new Map(),
    work: new Map(),
    workRequests: [],
    holdWork: false,
    releaseWork() {
      fake.holdWork = false;

      for (const release of held.splice(0)) {
        release();
      }
    },
    async plannedWork(request) {
      fake.workRequests.push(request);

      if (fake.holdWork) {
        await new Promise<void>((release) => held.push(release));
      }

      return fake.work.get(request.sensor) ?? null;
    },
    async describer() {
      const configured = describerOfConfigText(fake.texts.config);

      return configured === undefined
        ? { status: "unavailable", reason: "no describer is registered" }
        : { status: "ok", ...configured };
    },
    async sensorList() {
      return fake.list;
    },
    async readResults(tests = null): Promise<StoredResults> {
      const findings: StoredResults["findings"] = {
        files: [],
        refused: [...fake.refused],
      };
      const overlays: StoredResults["overlays"] = {
        files: [],
        refused: [...fake.overlaysRefused],
      };
      const freshness: StoredResults["freshness"] = {};

      for (const [name, text] of fake.files) {
        try {
          const document = readFindingsText(text, name);

          const { findings: _records, ...header } = document;
          const split = splitDocument(
            fake.structure ?? Repository.empty,
            document,
            tests,
          );

          findings.files.push({
            name,
            document: header,
            modifiedMs: fake.modified.get(name) ?? null,
            shown: split.shown,
            hidden: split.hidden,
            suites: suiteStandings(document.suites),
          });

          if (fake.structure !== null) {
            freshness[name] = documentFreshness(
              fake.structure,
              {
                ...(document.inputs === undefined
                  ? {}
                  : { inputs: document.inputs }),
                ...(document.tests === undefined
                  ? {}
                  : { tests: document.tests }),
              },
              tests,
            );
          }
        } catch {
          findings.refused.push(name);
        }
      }

      for (const [name, text] of fake.overlays) {
        try {
          overlays.files.push({
            name,
            overlay: readOverlayText(text),
            modifiedMs: fake.modifiedOverlays.get(name) ?? null,
          });
        } catch {
          overlays.refused.push(name);
        }
      }

      return {
        findings,
        overlays,
        refusals: fake.refusals,
        freshness,
        lastRun: fake.lastRun,
      };
    },
    async readTestsHash() {
      return fake.testsHash;
    },
    async clearResults(name) {
      fake.removed.push(name);
      fake.files.delete(name);
      fake.overlays.delete(name);
    },
    async inputs() {
      return typedInputs(fake.texts);
    },
    editInputs(next) {
      fake.texts = { ...fake.texts, ...next };
    },
  };

  return fake;
}
