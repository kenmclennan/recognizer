import { describe, expect, it } from "vitest";
import {
  type DescribeProjection,
  DescribeRequest,
  describeModules,
  InvalidRequest,
  projectDescribe,
} from "../../src/index.js";
import { PRICES } from "../fakes/prices.js";
import { DescribingWorld } from "./describing-world.js";

const IDS = ["a.py", "b.py", "c.py", "d.py"];

function failing(world: DescribingWorld, ...ids: string[]): void {
  for (const id of ids) {
    world.describer.results.set(id, { status: 1, stdout: "" });
  }
}

describe("describeModules selection", () => {
  it("stale picks the missing, out-of-date and unreadable files", async () => {
    const world = new DescribingWorld();
    const repository = world.repository(...IDS);

    world.line("a.py");
    world.line("b.py", { sourceHash: "old" });
    world.describer.unreadable.add("d.py");

    const result = await describeModules(
      world.ports,
      world.request(repository),
    );

    expect(result.described).toEqual(["b.py", "c.py"]);
    expect(result.failed).toEqual([
      { module: "d.py", reason: "source could not be read" },
    ]);
    expect(result.current).toBe(1);
  });

  it("all describes every file, current ones too", async () => {
    const world = new DescribingWorld();

    world.line("a.py");

    const result = await describeModules(
      world.ports,
      world.request(world.repository("a.py", "b.py"), {
        selection: { kind: "all" },
      }),
    );

    expect(result.described).toEqual(["a.py", "b.py"]);
    expect(result.current).toBe(0);
  });

  it("names describes only the named files", async () => {
    const world = new DescribingWorld();
    const result = await describeModules(
      world.ports,
      world.request(world.repository(...IDS), {
        selection: { kind: "names", names: ["c.py"] },
      }),
    );

    expect(result.described).toEqual(["c.py"]);
  });

  it("refuses unknown names one by one before any call", async () => {
    const world = new DescribingWorld();
    const run = describeModules(
      world.ports,
      world.request(world.repository("a.py"), {
        selection: { kind: "names", names: ["x.py", "a.py", "y.py"] },
      }),
    );

    await expect(run).rejects.toBeInstanceOf(InvalidRequest);
    await expect(run).rejects.toMatchObject({
      messages: ["no such file: x.py", "no such file: y.py"],
    });
    expect(world.describer.started).toEqual([]);
    expect(world.describer.described).toEqual([]);
  });

  it("notes a within name no file has and skips it", async () => {
    const world = new DescribingWorld();
    const result = await describeModules(
      world.ports,
      world.request(world.repository("a.py", "b.py"), {
        selection: { kind: "stale", within: ["a.py", "gone.py"] },
      }),
    );

    expect(world.said).toContain("skipped: no such file gone.py\n");
    expect(result.described).toEqual(["a.py"]);
  });
});

describe("describeModules projection and confirmation", () => {
  it("projects over the serialised request documents", async () => {
    const world = new DescribingWorld();
    const repository = world.repository("a.py", "b.py");
    const seen: DescribeProjection[] = [];
    const documents = ["a.py", "b.py"].map(
      (id) =>
        new DescribeRequest(id, "source", [id], `source of ${id}`, [], [], []),
    );

    await describeModules(
      world.ports,
      world.request(repository, { onProjection: (one) => seen.push(one) }),
    );

    expect(seen).toEqual([projectDescribe(documents, "opus", PRICES)]);
  });

  it("a refusal selects nothing and reports a start of 0", async () => {
    const world = new DescribingWorld();
    const starts: number[] = [];
    const result = await describeModules(
      world.ports,
      world.request(world.repository("a.py", "b.py"), {
        confirm: () => Promise.resolve(false),
        onStart: (total) => starts.push(total),
      }),
    );

    expect(starts).toEqual([0]);
    expect(result.described).toEqual([]);
    expect(world.describer.started).toEqual([]);
  });

  it("closes the session even when the run throws", async () => {
    const world = new DescribingWorld();

    await expect(
      describeModules(
        world.ports,
        world.request(world.repository("a.py"), {
          confirm: () => Promise.reject(new Error("boom")),
        }),
      ),
    ).rejects.toThrow("boom");
    expect(world.describer.opened).toBe(1);
    expect(world.describer.closed).toBe(1);
  });
});

describe("describeModules writing", () => {
  it("saves each line before the next completion and keeps them after a stop", async () => {
    const world = new DescribingWorld();

    failing(world, "c.py", "d.py");

    const result = await describeModules(
      world.ports,
      world.request(world.repository(...IDS)),
    );

    expect(result.stopped?.cause).toBe("failures");
    expect(world.lines().ids()).toEqual(["a.py", "b.py"]);
    expect(world.lines().get("a.py")).toEqual({
      line: "line for a.py",
      sourceHash: "hash-a.py",
      describer: world.describer.command,
      version: "v1",
    });
    expect(world.responsibilities.writes).toBe(2);
  });

  it("prunes lines for files no longer scanned and writes only then", async () => {
    const world = new DescribingWorld();

    world.line("a.py");
    world.line("gone.py");

    const before = world.responsibilities.writes;
    const result = await describeModules(
      world.ports,
      world.request(world.repository("a.py")),
    );

    expect(result.pruned).toEqual(["gone.py"]);
    expect(world.responsibilities.writes).toBe(before + 1);
    expect(world.lines().ids()).toEqual(["a.py"]);

    const quiet = world.responsibilities.writes;

    await describeModules(world.ports, world.request(world.repository("a.py")));

    expect(world.responsibilities.writes).toBe(quiet);
  });

  it("reports the reason for each way a call fails", async () => {
    const world = new DescribingWorld();

    world.describer.results.set("a.py", {
      status: 0,
      stdout: "",
      started: false,
    });
    world.describer.results.set("b.py", { status: 2, stdout: "" });
    world.describer.results.set("c.py", { status: 0, stdout: "" });
    world.describer.results.set("d.py", { status: 0, stdout: "one\ntwo\n" });

    const result = await describeModules(
      world.ports,
      world.request(world.repository(...IDS), { batchSize: 4 }),
    );

    expect(result.failed).toEqual([
      { module: "a.py", reason: "describer did not start: quill" },
      { module: "b.py", reason: "describer exited with status 2" },
      { module: "c.py", reason: "describer printed nothing" },
      { module: "d.py", reason: "describer printed more than one line" },
    ]);
  });
});

describe("describeModules stop rules", () => {
  it("stops a batch of 1 on the second failure in a row, not the first", async () => {
    const world = new DescribingWorld();

    failing(world, "a.py");

    const one = await describeModules(
      world.ports,
      world.request(world.repository("a.py", "b.py")),
    );

    expect(one.stopped).toBeNull();
    expect(one.described).toEqual(["b.py"]);

    const second = new DescribingWorld();

    failing(second, "a.py", "b.py");

    const two = await describeModules(
      second.ports,
      second.request(second.repository(...IDS)),
    );

    expect(two.stopped).toMatchObject({
      cause: "failures",
      module: "b.py",
      threshold: 2,
      described: 0,
      not_described: ["c.py", "d.py"],
    });
  });

  it("stops a batch of 4 on the fourth failure, not the third", async () => {
    const ids = ["a.py", "b.py", "c.py", "d.py", "e.py", "f.py"];
    const third = new DescribingWorld();

    failing(third, "a.py", "b.py", "c.py");

    const spared = await describeModules(
      third.ports,
      third.request(third.repository(...ids), { batchSize: 4 }),
    );

    expect(spared.stopped).toBeNull();
    expect(spared.failed).toHaveLength(3);

    const fourth = new DescribingWorld();

    failing(fourth, "a.py", "b.py", "c.py", "d.py");

    const stopped = await describeModules(
      fourth.ports,
      fourth.request(fourth.repository(...ids), { batchSize: 4 }),
    );

    expect(stopped.stopped).toMatchObject({
      cause: "failures",
      module: "d.py",
      threshold: 4,
    });
  });

  it("a success between failures resets the count", async () => {
    const world = new DescribingWorld();

    failing(world, "a.py", "c.py");

    const result = await describeModules(
      world.ports,
      world.request(world.repository(...IDS)),
    );

    expect(result.stopped).toBeNull();
    expect(result.described).toEqual(["b.py", "d.py"]);
  });

  it("status 75 on the first started call stops with cause limit", async () => {
    const world = new DescribingWorld();

    world.describer.results.set("a.py", { status: 75, stdout: "" });

    const result = await describeModules(
      world.ports,
      world.request(world.repository(...IDS)),
    );

    expect(result.stopped).toMatchObject({ cause: "limit", module: "a.py" });
    expect(world.describer.started).toHaveLength(1);
  });

  it("kills the running calls on a stop and does not count them", async () => {
    const world = new DescribingWorld();

    world.describer.held.add("a.py");
    world.describer.results.set("b.py", { status: 75, stdout: "" });

    const result = await describeModules(
      world.ports,
      world.request(world.repository("a.py", "b.py", "c.py"), {
        batchSize: 2,
      }),
    );

    expect(world.describer.killed).toEqual(["a.py"]);
    expect(result.failed).toEqual([
      { module: "b.py", reason: "describer exited with status 75" },
    ]);
    expect(result.stopped).toMatchObject({
      cause: "limit",
      not_described: ["a.py", "c.py"],
    });
  });
});

describe("describeModules entries", () => {
  it("streams one entry per file with the filled command and awake time", async () => {
    const world = new DescribingWorld();

    await describeModules(world.ports, world.request(world.repository("a.py")));

    expect(world.entries).toHaveLength(1);
    expect(world.entries[0]).toMatchObject({
      name: "a.py",
      command: ["quill", "run", "a.py"],
      status: 0,
      outcome: "ok",
    });
  });
});
