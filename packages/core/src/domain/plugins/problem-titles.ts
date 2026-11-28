import type { ProblemCode } from "./doctor-report.js";

export type DisplayName = (id: string) => string;

const PLAIN: DisplayName = (id) => id;

export const PROBLEM_TITLES: Record<
  ProblemCode,
  (name: string, display?: DisplayName) => string
> = {
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
  "scanner-missing": (name, display = PLAIN) =>
    name === "scanners"
      ? "No scanner is installed"
      : `No scanner for ${display(name)}`,
  "scanner-ambiguous": (name, display = PLAIN) =>
    `Two scanners claim ${display(name)}`,
  "scanner-choice": (name, display = PLAIN) =>
    `The scanner chosen for ${display(name)} is not usable`,
  "sensor-gap": (name) => `${name} cannot run as set up`,
  "plugin-missing": (name) => `The ${name} plugin is not installed`,
  "plugin-manifest": (name) => `The ${name} plugin cannot be read`,
  "plugin-protocol": (name) =>
    `The ${name} plugin speaks another protocol version`,
  "plugin-scan-schema": (name, display = PLAIN) =>
    `The ${display(name)} scanner's output is invalid`,
  "plugin-tests-report": (name, display = PLAIN) =>
    `The ${display(name)} scanner cannot report its tests`,
  "plugin-grammar-vocabulary": (name, display = PLAIN) =>
    `The ${display(name)} scanner publishes a grammar with no vocabulary`,
  "plugin-grammar-fields": (name, display = PLAIN) =>
    `The ${display(name)} scanner publishes a grammar with no fields declaration`,
  "plugin-settings": (name) => `A ${name} setting is wrong`,
  "describer-gap": (name) => `The ${name} describer is not ready`,
  "unregistered-plugin": (name) => `The ${name} plugin is not registered`,
  "unregistered-program": (name) => `${name} is installed but not registered`,
  "sensor-manifest-missing": () => "Sensor names no manifest command",
};
