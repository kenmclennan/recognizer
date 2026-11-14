import findingsSchema from "./generated/findings.schema.json" with {
  type: "json",
};
import templates from "./generated/templates.json" with { type: "json" };
import { CURRENT_PROTOCOL } from "./plugin-manifest.js";
import { SCAN_SCHEMA_VERSION } from "./scan.js";

export const KINDS = ["scanner", "sensor", "describer"] as const;

export const LANGUAGES = ["python", "typescript", "rust"] as const;

export type TemplateKind = (typeof KINDS)[number];

export type TemplateLanguage = (typeof LANGUAGES)[number];

export const PROGRAM_VERBS: Record<TemplateKind, string> = {
  scanner: "scan",
  sensor: "sense",
  describer: "describe",
};

export const PROGRAM_FILE = "{{program}}";

export const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

export const NAME_MAX = 64;

export interface TemplateValues {
  name: string;
  program: string;
  kind: string;
  protocol: string;
  scan_schema_version: string;
  findings_version: string;
}

export interface RenderedFile {
  path: string;
  content: string;
  executable: boolean;
}

export type TemplateSet = Record<string, string>;

export function programName(kind: TemplateKind, name: string): string {
  return `recognizer-${PROGRAM_VERBS[kind]}-${name}`;
}

export function templateValues(
  kind: TemplateKind,
  name: string,
): TemplateValues {
  return {
    name,
    program: programName(kind, name),
    kind,
    protocol: String(CURRENT_PROTOCOL),
    scan_schema_version: String(SCAN_SCHEMA_VERSION),
    findings_version: String(
      Math.max(...findingsSchema.properties.findings_version.enum),
    ),
  };
}

function substitute(text: string, values: TemplateValues, where: string) {
  const known = new Set(Object.keys(values));
  const replaced = text.replace(/\{\{([^{}]*)\}\}/g, (whole, placeholder) => {
    if (!known.has(placeholder)) {
      throw new Error(`${where} names an unknown placeholder ${whole}`);
    }

    return values[placeholder as keyof TemplateValues];
  });

  if (replaced.includes("{{")) {
    throw new Error(`${where} still holds {{ after rendering`);
  }

  return replaced;
}

export function renderTemplates(
  set: TemplateSet,
  language: TemplateLanguage,
  kind: TemplateKind,
  values: TemplateValues,
): RenderedFile[] {
  const prefix = `${language}/${kind}/`;

  return Object.keys(set)
    .filter((key) => key.startsWith(prefix))
    .sort()
    .map((key) => {
      const relative = key.slice(prefix.length);

      return {
        path: substitute(relative, values, key),
        content: substitute(set[key] as string, values, key),
        executable: relative === PROGRAM_FILE,
      };
    });
}

export function bundledTemplates(): TemplateSet {
  return templates as TemplateSet;
}
