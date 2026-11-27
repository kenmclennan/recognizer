import { describe, expect, it } from "vitest";
import {
  Finding,
  gatherFindingsFiles,
  type SensorFindings,
} from "../../src/index.js";
import { createFakes } from "../fakes/container.js";
import { breaching, ROOT } from "./analysis-world.js";

function world() {
  const fakes = createFakes();
  const said: string[] = [];
  const gather = (scope: { skip: string[]; allowed: string[] }) =>
    gatherFindingsFiles(
      fakes,
      (_stream, text) => {
        said.push(text);
      },
      ROOT,
      breaching("abc"),
      scope,
    );

  return { fakes, said, gather };
}

function documentOf(
  name: string,
  overrides: Partial<SensorFindings> = {},
): SensorFindings {
  return {
    sensor: { name, version: "1" },
    commit: "abcdef0123",
    modified: false,
    settings: {},
    findings: [],
    inputs: {},
    ...overrides,
  };
}

function hiddenRecord(): Finding {
  return Finding.stored({
    id: "x",
    kind: "crap",
    severity: "warning",
    principle: "p",
    summary: "s",
    files: ["a/x.py"],
  });
}

function store(
  fakes: ReturnType<typeof createFakes>,
  name: string,
  document: SensorFindings,
) {
  fakes.findings.stored.set(name, { name, status: "read", document });
}

describe("gatherFindingsFiles", () => {
  it("returns a current registered file as read and says nothing", () => {
    const { fakes, said, gather } = world();

    store(fakes, "alpha", documentOf("alpha"));

    const outcomes = gather({ skip: [], allowed: ["alpha"] });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.status).toBe("read");
    expect(said).toEqual([]);
  });

  it("says stale for a registered file with no inputs", () => {
    const { fakes, said, gather } = world();

    store(fakes, "alpha", documentOf("alpha", { inputs: undefined }));

    const outcomes = gather({ skip: [], allowed: ["alpha"] });

    expect(outcomes).toHaveLength(1);
    expect(said).toEqual(["stale alpha\n"]);
  });

  it("says stale with the reported commit for a reported file outside allowed", () => {
    const { fakes, said, gather } = world();

    store(
      fakes,
      "old-review",
      documentOf("old-review", {
        inputs: undefined,
        reportedAt: "2026-01-01T00:00:00Z",
      } as Partial<SensorFindings>),
    );

    const outcomes = gather({ skip: [], allowed: [] });

    expect(outcomes).toHaveLength(1);
    expect(said).toEqual(["stale old-review (reported at abcdef0)\n"]);
  });

  it("says out of date and not stale for a valid file with hidden records", () => {
    const { fakes, said, gather } = world();

    store(
      fakes,
      "alpha",
      documentOf("alpha", {
        findings: [hiddenRecord()],
        inputs: { "a/x.py": "other" },
      }),
    );

    const outcomes = gather({ skip: [], allowed: ["alpha"] });

    expect(outcomes).toHaveLength(1);
    expect(said).toEqual(["out of date alpha: 1 findings\n"]);
  });

  it("says ignored unregistered and does not return it as read", () => {
    const { fakes, said, gather } = world();

    store(fakes, "gamma", documentOf("gamma"));

    const outcomes = gather({ skip: [], allowed: ["alpha"] });

    expect(outcomes).toEqual([{ name: "gamma", status: "unregistered" }]);
    expect(said).toEqual(["ignored unregistered gamma\n"]);
  });

  it("returns nothing and says nothing for a skipped file", () => {
    const { fakes, said, gather } = world();

    store(fakes, "structure", documentOf("structure"));

    const outcomes = gather({ skip: ["structure"], allowed: ["structure"] });

    expect(outcomes).toEqual([]);
    expect(said).toEqual([]);
  });

  it("says invalid with the reason for a registered invalid file", () => {
    const { fakes, said, gather } = world();

    fakes.findings.stored.set("beta", {
      name: "beta",
      status: "invalid",
      reason: "bad shape",
    });

    const outcomes = gather({ skip: [], allowed: ["beta"] });

    expect(outcomes).toEqual([
      { name: "beta", status: "invalid", reason: "bad shape" },
    ]);
    expect(said).toEqual(["invalid beta: bad shape\n"]);
  });

  it("reports a mixed set in stored order", () => {
    const { fakes, said, gather } = world();

    store(fakes, "alpha", documentOf("alpha"));
    store(fakes, "beta", documentOf("beta", { inputs: undefined }));
    fakes.findings.stored.set("delta", {
      name: "delta",
      status: "invalid",
      reason: "bad shape",
    });
    store(fakes, "gamma", documentOf("gamma"));

    const outcomes = gather({
      skip: [],
      allowed: ["alpha", "beta", "delta"],
    });

    expect(outcomes.map(({ status }) => status)).toEqual([
      "read",
      "read",
      "invalid",
      "unregistered",
    ]);
    expect(said).toEqual([
      "stale beta\n",
      "invalid delta: bad shape\n",
      "ignored unregistered gamma\n",
    ]);
  });
});
