import type { ProblemCode } from "./doctor-report.js";

export const LANGUAGE_NAMES: Record<string, string> = {
  typescript: "TypeScript",
  rust: "Rust",
  python: "Python",
  kotlin: "Kotlin",
  csharp: "C#",
};

function language(id: string): string {
  return LANGUAGE_NAMES[id] ?? id;
}

export const PROBLEM_TITLES: Record<ProblemCode, (name: string) => string> = {
  "config-yaml": () => "Configuration file cannot be read",
  "config-retired": () => "Settings moved to new places",
  "config-empty": () => "Empty settings section",
  "config-duplicate-suite": (name) => `Two test suites are named ${name}`,
  "config-invalid": () => "A setting has a wrong value",
  "policy-invalid": () => "Policy file has an error",
  "scan-missing": () => "No scan yet",
  "scan-stale": () => "Scan is out of date",
  "policy-entry": () => "Policy entry matches no file",
  "policy-forbid": () => "Policy rule matches no file",
  "policy-retired": () => "Policy format changed",
  "scanner-missing": (name) =>
    name === "scanners"
      ? "No scanner is installed"
      : `No scanner for ${language(name)}`,
  "scanner-ambiguous": (name) => `Two scanners claim ${language(name)}`,
  "scanner-choice": (name) =>
    `The scanner chosen for ${language(name)} is not usable`,
  "sensor-gap": (name) => `${name} cannot run as set up`,
  "plugin-missing": (name) => `The ${name} plugin is not installed`,
  "plugin-manifest": (name) => `The ${name} plugin cannot be read`,
  "plugin-protocol": (name) =>
    `The ${name} plugin speaks another protocol version`,
  "plugin-scan-schema": (name) =>
    `The ${language(name)} scanner's output is invalid`,
  "plugin-settings": (name) => `A ${name} setting is wrong`,
  "describer-gap": (name) => `The ${name} describer is not ready`,
  "unregistered-plugin": (name) => `The ${name} plugin is not registered`,
};
