import { baseName } from "../path.js";
import {
  grammarsWithoutFields,
  grammarsWithoutVocabulary,
} from "./grammar-vocabulary.js";
import { judgeProtocol, type Manifest } from "./manifest.js";
import { PlaceholderKey } from "./placeholder-key.js";
import { PlaceholderSet } from "./placeholder-set.js";
import { sentenceProblems } from "./sentence.js";

interface LimitSetting {
  key: string;
  type?: string;
  labels?: unknown;
  units?: unknown;
  limit?: { metric: string; severity?: string };
}

export interface ProtocolProblem {
  severity: "warn" | "fail";
  reason: string;
}

export class PluginManifest {
  private static readonly VERBS = {
    scanner: "scan",
    sensor: "sense",
    describer: "describe",
  };

  constructor(private readonly manifest: Manifest) {}

  namingProblem(command: string): string | null {
    const { kind, name } = this.manifest;
    const expected = `recognizer-${PluginManifest.VERBS[kind]}-${name}`;
    const actual = baseName(command);

    return actual === expected
      ? null
      : `the command is named ${actual}, but a ${kind} called ${name} must be named ${expected}`;
  }

  protocolProblem(current: number): ProtocolProblem | null {
    const { name, protocol, install } = this.manifest;
    const judged = judgeProtocol(this.manifest, current);

    if (judged === "current") {
      return null;
    }

    if (judged === "previous") {
      return {
        severity: "warn",
        reason: `${name} speaks protocol ${protocol}, the previous one (current is ${current}); upgrade it: ${install}`,
      };
    }

    return {
      severity: "fail",
      reason: `${name} speaks protocol ${protocol}, which this recognizer (protocol ${current}) does not support; fix: ${install}`,
    };
  }

  sentenceProblems(): string[] {
    return (this.manifest.findings ?? []).flatMap((entry) =>
      sentenceProblems(entry.sentence).map((text) => `${entry.kind}: ${text}`),
    );
  }

  grammarProblems(): string[] {
    const missing = grammarsWithoutVocabulary(this.manifest);
    const fieldless = grammarsWithoutFields(this.manifest);

    return [
      ...(missing.length === 0
        ? []
        : [
            `grammar ${missing.join(", ")} publishes no vocabulary, so its comments and literals enter fingerprints and no function shape is trivial`,
          ]),
      ...(fieldless.length === 0
        ? []
        : [
            `grammar ${fieldless.join(", ")} publishes no fields declaration, so it is unknown whether a function can be named or operator-based complexity counted`,
          ]),
    ];
  }

  limitProblems(): string[] {
    const { manifest } = this;
    const settings = this.limitSettings();
    const metrics = ((manifest.metrics ?? []) as { name: string }[]).map(
      (entry) => entry.name,
    );

    return settings.flatMap((setting) => {
      const placeholder = new PlaceholderKey(setting.key).firstToken();
      const found: string[] = [];

      if (placeholder === undefined) {
        for (const field of ["labels", "units"] as const) {
          if (setting[field] !== undefined) {
            found.push(
              `${setting.key}: ${field} needs a key with a placeholder`,
            );
          }
        }
      }

      const { limit } = setting;

      if (limit === undefined) {
        return found;
      }

      if (manifest.kind !== "sensor") {
        found.push(`${setting.key}: only a sensor may declare a limit`);
      } else if (PlaceholderKey.looksLikePlaceholder(limit.metric)) {
        if (limit.metric !== placeholder) {
          found.push(
            `${setting.key}: limit metric ${limit.metric} is not the key's own placeholder`,
          );
        }
      } else if (!metrics.includes(limit.metric)) {
        found.push(
          `${setting.key}: limit metric ${limit.metric} is not a metric of ${manifest.name}`,
        );
      }

      if (
        limit.severity !== undefined &&
        !settings.some(
          (other) => other.key === limit.severity && other.type === "enum",
        )
      ) {
        found.push(
          `${setting.key}: limit severity ${limit.severity} is not an enum setting of ${manifest.name}`,
        );
      }

      return found;
    });
  }

  placeholderProblems(): string[] {
    const { manifest } = this;
    const declared = new PlaceholderSet(manifest.placeholders ?? {});
    const problems: string[] = [];
    const used = new Set<string>();

    for (const name of declared.uncompilable()) {
      problems.push(`${name}: pattern does not compile`);
    }

    for (const key of this.keys()) {
      for (const name of new PlaceholderKey(key).names()) {
        used.add(name);

        if (!declared.has(name)) {
          problems.push(
            `${key}: uses the placeholder <${name}> that the manifest does not declare`,
          );
        }
      }
    }

    for (const name of declared.names()) {
      if (!used.has(name)) {
        problems.push(`${name}: declared but no key uses it`);
      }
    }

    const published = manifest.settings as Record<string, unknown>[];

    if (
      manifest.kind === "sensor" &&
      published.length > 0 &&
      published.every(
        (setting) =>
          setting.label === undefined && setting.labels === undefined,
      )
    ) {
      problems.push(
        `${manifest.name}: publishes settings but none has a label or labels, so it gets no Settings pane`,
      );
    }

    for (const setting of published) {
      const first = new PlaceholderKey(String(setting.key)).first();
      const pattern = first === undefined ? null : declared.pattern(first);

      if (first === undefined || pattern === null) {
        continue;
      }

      for (const field of ["labels", "units", "defaults"]) {
        const entries = setting[field];

        if (entries === undefined || entries === null) {
          continue;
        }

        for (const value of Object.keys(entries as object)) {
          if (!pattern.test(value)) {
            problems.push(
              `${String(setting.key)}: ${field} entry ${value} does not match <${first}>`,
            );
          }
        }
      }
    }

    return problems;
  }

  private limitSettings(): LimitSetting[] {
    return this.manifest.settings as LimitSetting[];
  }

  private keys(): string[] {
    const suite = this.manifest.suite_keys;

    return [
      ...(this.manifest.settings as { key: string }[]).map(
        (entry) => entry.key,
      ),
      ...(suite === undefined
        ? []
        : [
            (suite.section as { key: string }).key,
            ...(suite.keys as { key: string }[]).map((entry) => entry.key),
          ]),
    ];
  }
}
