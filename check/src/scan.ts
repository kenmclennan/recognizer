import { Ajv2020 } from "ajv/dist/2020.js";
import { InputError } from "./errors.js";
import schema from "./generated/scan.schema.json" with { type: "json" };

export interface ScanEdge {
  from: string;
  to: string;
  kind: "depends" | "inherits" | "implements";
  line: number;
  names?: string[];
  via?: string[];
  inferred?: {
    parameter: string;
    methods: string[];
    class: string;
    implementations: string[];
  };
}

export interface Scan {
  modules: { id: string; kind: "module" | "package" | "interface" }[];
  edges: ScanEdge[];
  foreign: { id: string; name: string }[];
}

export const SCAN_SCHEMA_VERSION: number =
  schema.properties.schema_version.const;

const validate = new Ajv2020({ allErrors: true }).compile(schema);

export function validateScan(value: unknown): Scan {
  if (validate(value)) {
    return value as unknown as Scan;
  }

  const messages = (validate.errors ?? []).map(
    (error) => `scan${error.instancePath} ${error.message ?? "is invalid"}`,
  );

  throw new InputError(messages.length > 0 ? messages : ["scan is invalid"]);
}
