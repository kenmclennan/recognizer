import { describe, expect, it } from "vitest";
import { type ToolsReport, toolsNotice } from "./tools-notice";

const version = (value: string): ToolsReport => ({
  status: "version",
  version: value,
});

const TOOLS_OLDER =
  "The recognizer command (0.2.0) is older than the app (0.3.0) - run brew upgrade recognizer";
const APP_OLDER =
  "The app (0.3.0) is older than the recognizer command (0.4.0) - run brew upgrade --cask recognizer";

describe("toolsNotice", () => {
  it.each<[string, string, ToolsReport, string | null]>([
    ["same version", "0.3.0", version("0.3.0"), null],
    ["older tools", "0.3.0", version("0.2.0"), TOOLS_OLDER],
    ["older app", "0.3.0", version("0.4.0"), APP_OLDER],
    [
      "older tools compared numerically, not as text",
      "0.10.0",
      version("0.9.0"),
      "The recognizer command (0.9.0) is older than the app (0.10.0) - run brew upgrade recognizer",
    ],
    [
      "unparseable tools version",
      "0.3.0",
      version("dev"),
      "The app (0.3.0) and the recognizer command (dev) are out of step - run brew upgrade recognizer",
    ],
    [
      "unparseable app version",
      "0.3.0-rc1",
      version("0.3.0"),
      "The app (0.3.0-rc1) and the recognizer command (0.3.0) are out of step - run brew upgrade recognizer",
    ],
    ["recognizer missing", "0.3.0", { status: "command-missing" }, null],
    [
      "settings invalid",
      "0.3.0",
      { status: "config-invalid", message: "bad" },
      null,
    ],
    [
      "check failed",
      "0.3.0",
      { status: "failed", exitCode: 2, stderr: "boom" },
      null,
    ],
  ])("%s", (_name, appVersion, report, expected) => {
    expect(toolsNotice(appVersion, report)).toBe(expected);
  });
});
