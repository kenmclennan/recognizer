import { describe, expect, it } from "vitest";
import {
  parseBranchTip,
  parseCommitDetail,
  parsePullDetail,
} from "./change-detail-parse";

const US = "\u001f";
const reply = (value: unknown, status = "ok") => ({
  status: status as "ok",
  detail: "",
  text: JSON.stringify(value),
});

describe("parseCommitDetail", () => {
  it("reads the author, time, subject and body", () => {
    expect(
      parseCommitDetail(
        `Ken${US}1794933540${US}subject\n\nbody one\n\nbody two\n`,
      ),
    ).toEqual({
      author: "Ken",
      time: 1794933540,
      subject: "subject",
      body: "body one\n\nbody two",
    });
  });

  it("reads a commit with no body", () => {
    expect(parseCommitDetail(`Ken${US}1${US}subject\n`)).toEqual({
      author: "Ken",
      time: 1,
      subject: "subject",
      body: "",
    });
  });

  it("treats a malformed reply as unknown", () => {
    expect(parseCommitDetail(`Ken${US}subject`)).toBeNull();
    expect(parseCommitDetail(`Ken${US}soon${US}subject`)).toBeNull();
    expect(parseCommitDetail("")).toBeNull();
    expect(parseCommitDetail(null)).toBeNull();
  });
});

describe("parseBranchTip", () => {
  it("reads the tip", () => {
    expect(parseBranchTip(`Ken${US}5${US}tip subject\n`)).toEqual({
      author: "Ken",
      time: 5,
      subject: "tip subject",
    });
    expect(parseBranchTip("nothing")).toBeNull();
  });
});

describe("parsePullDetail", () => {
  const base = {
    number: 7,
    title: "title",
    body: "body",
    author: { login: "ken" },
    statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }],
  };

  it("reads the state of an open, merged, closed and draft pull request", () => {
    const state = (extra: object) =>
      parsePullDetail(reply({ ...base, ...extra }))?.state;

    expect(state({ state: "OPEN", isDraft: false })).toBe("open");
    expect(state({ state: "MERGED", isDraft: false })).toBe("merged");
    expect(state({ state: "CLOSED", isDraft: false })).toBe("closed");
    expect(state({ state: "OPEN", isDraft: true })).toBe("draft");
  });

  it("reads the fields", () => {
    expect(parsePullDetail(reply({ ...base, state: "OPEN" }))).toEqual({
      number: 7,
      title: "title",
      body: "body",
      state: "open",
      author: "ken",
      checks: "passing",
    });
  });

  it("reads the first entry of a branch's list, which has no state", () => {
    expect(parsePullDetail(reply([{ ...base, isDraft: false }]))?.state).toBe(
      "open",
    );
    expect(parsePullDetail(reply([]))).toBeNull();
  });

  it("treats an unparsable, failed or malformed reply as unknown", () => {
    expect(
      parsePullDetail({ status: "ok", detail: "", text: "not json" }),
    ).toBeNull();
    expect(
      parsePullDetail(reply({ ...base, state: "OPEN" }, "failed")),
    ).toBeNull();
    expect(parsePullDetail(reply({ title: "x", state: "OPEN" }))).toBeNull();
    expect(parsePullDetail(reply({ ...base, state: "WEIRD" }))).toBeNull();
    expect(parsePullDetail(null)).toBeNull();
  });
});
