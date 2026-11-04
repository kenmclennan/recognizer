import { describe, expect, it } from "vitest";
import type { MessageInput } from "./message-tray";
import {
  postToolsMessage,
  type ToolsReport,
  toolsNotice,
} from "./tools-notice";

const version = (value: string): ToolsReport => ({
  status: "version",
  version: value,
});

const TOOLS_OLDER =
  "The recognizer command (0.2.0) is older than the app (0.3.0)";
const APP_OLDER =
  "The app (0.3.0) is older than the recognizer command (0.4.0)";

describe("toolsNotice", () => {
  it.each<[string, string, ToolsReport, string | null]>([
    ["same version", "0.3.0", version("0.3.0"), null],
    ["older tools", "0.3.0", version("0.2.0"), TOOLS_OLDER],
    ["older app", "0.3.0", version("0.4.0"), APP_OLDER],
    [
      "older tools compared numerically, not as text",
      "0.10.0",
      version("0.9.0"),
      "The recognizer command (0.9.0) is older than the app (0.10.0)",
    ],
    [
      "unparseable tools version",
      "0.3.0",
      version("dev"),
      "The app (0.3.0) and the recognizer command (dev) are out of step",
    ],
    [
      "unparseable app version",
      "0.3.0-rc1",
      version("0.3.0"),
      "The app (0.3.0-rc1) and the recognizer command (0.3.0) are out of step",
    ],
    ["recognizer missing", "0.3.0", { status: "command-missing" }, null],
    [
      "check failed",
      "0.3.0",
      { status: "failed", exitCode: 2, stderr: "boom" },
      null,
    ],
  ])("%s", (_name, appVersion, report, expected) => {
    expect(toolsNotice(appVersion, report)?.text ?? null).toBe(expected);
  });
});

describe("toolsNotice command", () => {
  it.each<[string, string, string, string | null]>([
    [
      "older tools",
      "0.3.0",
      "0.2.0",
      "brew upgrade --formula kenmclennan/tap/recognizer",
    ],
    [
      "older app",
      "0.3.0",
      "0.4.0",
      "brew upgrade --cask kenmclennan/tap/recognizer",
    ],
    [
      "incomparable",
      "0.3.0",
      "dev",
      "brew upgrade --formula kenmclennan/tap/recognizer && brew upgrade --cask kenmclennan/tap/recognizer",
    ],
    ["same", "0.3.0", "0.3.0", null],
  ])("%s", (_name, appVersion, tools, command) => {
    expect(toolsNotice(appVersion, version(tools))?.command ?? null).toBe(
      command,
    );
  });
});

describe("postToolsMessage", () => {
  function sink() {
    const posted: MessageInput[] = [];
    const labels: [number, string][] = [];

    return {
      posted,
      labels,
      post: (input: MessageInput) => {
        posted.push(input);

        return 7;
      },
      relabel: (id: number, label: string) => labels.push([id, label]),
    };
  }

  it.each([
    [
      "older tools",
      "0.2.0",
      "brew upgrade --formula kenmclennan/tap/recognizer",
    ],
    ["older app", "0.4.0", "brew upgrade --cask kenmclennan/tap/recognizer"],
  ])(
    "posts a keyed warning that copies the right command for %s",
    async (_name, tools, command) => {
      const out = sink();
      const copied: string[] = [];
      const notice = toolsNotice("0.3.0", version(tools));

      postToolsMessage(
        notice as NonNullable<typeof notice>,
        out,
        async (text) => {
          copied.push(text);
        },
      );

      const [message] = out.posted;

      expect(message).toMatchObject({
        kind: "warning",
        key: "tools-version",
        onOpen: true,
      });
      expect(message?.action?.label).toBe("Upgrade");

      message?.action?.run();
      await Promise.resolve();
      await Promise.resolve();

      expect(copied).toEqual([command]);
      expect(out.labels).toEqual([[7, "Copied"]]);
    },
  );

  it("does not relabel when the copy fails", async () => {
    const out = sink();
    const notice = toolsNotice("0.3.0", version("0.2.0"));

    postToolsMessage(notice as NonNullable<typeof notice>, out, async () => {
      throw new Error("denied");
    });
    out.posted[0]?.action?.run();
    await Promise.resolve();
    await Promise.resolve();

    expect(out.labels).toEqual([]);
  });
});
