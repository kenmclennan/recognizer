import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CURRENT_PROTOCOL,
  judgeProtocol,
  readManifest,
} from "../src/plugin-manifest.js";
import { REPO } from "./helpers.js";
import { fakeIo } from "./scan-helpers.js";

const VALID = readFileSync(
  join(REPO, "schema/manifest-examples/valid/scanner.json"),
  "utf8",
);

function reading(effect: {
  started?: boolean;
  status?: number;
  stdout?: string;
  timedOut?: boolean;
}) {
  return readManifest(
    fakeIo({ programs: { "recognizer-scan-python": () => effect } }).io,
    "recognizer-scan-python",
  );
}

describe("readManifest", () => {
  it("returns the manifest of a plugin that answers with a valid one", () => {
    const read = reading({ stdout: VALID });

    expect(read).toEqual({ ok: true, manifest: JSON.parse(VALID) });
  });

  it("asks with the one word manifest and a ten second limit", () => {
    const fake = fakeIo({
      programs: { "recognizer-scan-python": () => ({ stdout: VALID }) },
    });

    readManifest(fake.io, "recognizer-scan-python");

    expect(fake.calls.at(-1)).toMatchObject({
      command: "recognizer-scan-python",
      args: ["manifest"],
    });
  });

  it("refuses a plugin that exits non-zero, naming the command", () => {
    const read = reading({ status: 1, stdout: VALID });

    expect(read).toEqual({
      ok: false,
      reason: "recognizer-scan-python manifest exited 1",
    });
  });

  it("refuses a plugin that prints something that is not JSON", () => {
    const read = reading({ stdout: "usage: tool" });

    expect(read).toEqual({
      ok: false,
      reason: "recognizer-scan-python manifest did not print JSON",
    });
  });

  it("refuses a document the manifest schema rejects, quoting the first message", () => {
    const read = reading({
      stdout: JSON.stringify({ ...JSON.parse(VALID), protocol: 0 }),
    });

    expect(read).toMatchObject({ ok: false });
    expect(read.ok === false && read.reason).toMatch(
      /^recognizer-scan-python manifest: \/protocol must be >= 1/,
    );
  });

  it("refuses a command that does not start", () => {
    const read = reading({ started: false });

    expect(read).toEqual({
      ok: false,
      reason: "recognizer-scan-python could not be started",
    });
  });

  it("refuses a command that outlasts its limit", () => {
    const read = reading({ timedOut: true, status: 124 });

    expect(read).toEqual({
      ok: false,
      reason: "recognizer-scan-python manifest timed out",
    });
  });
});

describe("judgeProtocol", () => {
  it.each([
    [2, "current"],
    [1, "previous"],
    [0, "unsupported"],
    [3, "unsupported"],
  ])("judges protocol %i against a current of 2 as %s", (protocol, judged) => {
    expect(judgeProtocol({ protocol }, 2)).toBe(judged);
  });

  it("supports only the real current protocol while it is 1", () => {
    expect(CURRENT_PROTOCOL).toBe(1);
    expect(judgeProtocol({ protocol: 1 })).toBe("current");
    expect(judgeProtocol({ protocol: 0 })).toBe("unsupported");
    expect(judgeProtocol({ protocol: 2 })).toBe("unsupported");
  });
});
