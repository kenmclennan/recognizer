import { describe, expect, it } from "vitest";
import {
  claudeArgs,
  parseStreamLine,
} from "../src/adapters/system/assistant-adapter.js";

const ALLOW = {
  tools: ["Read", "Glob", "Grep"],
  commands: [
    { command: "recognizer help", anyArguments: true },
    { command: "recognizer plugins", anyArguments: true },
    { command: "recognizer doctor", anyArguments: true },
    { command: "recognizer scan --extract", anyArguments: false },
    { command: "recognizer uses", anyArguments: true },
    { command: "recognizer used-by", anyArguments: true },
  ],
};

describe("assistant adapter", () => {
  it("builds exactly the bound flag set", () => {
    const args = claudeArgs("sonnet", "{}", ALLOW);
    const at = args.indexOf("--allowedTools");

    expect(args.slice(at + 1, at + 10)).toEqual([
      "Read",
      "Glob",
      "Grep",
      "Bash(recognizer help:*)",
      "Bash(recognizer plugins:*)",
      "Bash(recognizer doctor:*)",
      "Bash(recognizer scan --extract)",
      "Bash(recognizer uses:*)",
      "Bash(recognizer used-by:*)",
    ]);
    expect(args[at + 10]).toBe("--setting-sources");
    expect(args[at + 11]).toBe("");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("dontAsk");
    expect(args[args.indexOf("--model") + 1]).toBe("sonnet");

    for (const forbidden of ["Write", "Edit", "NotebookEdit", "sensors"]) {
      expect(args).not.toContain(forbidden);
    }

    expect(args.some((arg) => arg.includes("--dangerously"))).toBe(false);
    expect(args.some((arg) => arg.includes("sensors check"))).toBe(false);
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--disable-slash-commands");
    expect(args).toContain("--no-session-persistence");
  });

  it("holds the read-only allowlist", () => {
    const args = claudeArgs("sonnet", '{"type":"object"}', ALLOW);

    expect(args).toContain("Bash(recognizer uses:*)");
    expect(args).toContain("Bash(recognizer used-by:*)");
    expect(args).not.toContain("--max-budget-usd");
    expect(args[args.indexOf("--json-schema") + 1]).toBe('{"type":"object"}');
  });

  it("yields progress and result facts from the stream", () => {
    const tool =
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":".recognizer/policy.yaml"}}]}}';
    const bash =
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"recognizer doctor"}}]}}';
    const text =
      '{"type":"assistant","message":{"content":[{"type":"text","text":"hello"}]}}';
    const good =
      '{"type":"result","subtype":"success","is_error":false,"duration_ms":1200,"total_cost_usd":0.42,"structured_output":{"changes":[]},"permission_denials":[1,2]}';
    const bad =
      '{"type":"result","subtype":"error_max_budget_usd","is_error":true,"total_cost_usd":2.1,"duration_ms":5}';

    expect(parseStreamLine(tool).progress).toEqual([
      "Read .recognizer/policy.yaml",
    ]);
    expect(parseStreamLine(bash).progress).toEqual(["Bash recognizer doctor"]);
    expect(parseStreamLine(text)).toEqual({ progress: [], answer: null });
    expect(parseStreamLine(good).answer).toEqual({
      structured: { changes: [] },
      costUsd: 0.42,
      durationMs: 1200,
      isError: false,
      subtype: "success",
      text: null,
      denials: 2,
    });

    const failed = parseStreamLine(bad).answer;

    expect(failed?.isError).toBe(true);
    expect(failed?.subtype).toBe("error_max_budget_usd");
    expect(failed?.structured).toBeNull();
    expect(parseStreamLine(good.slice(0, 40))).toEqual({
      progress: [],
      answer: null,
    });
    expect(parseStreamLine("")).toEqual({ progress: [], answer: null });
  });
});
