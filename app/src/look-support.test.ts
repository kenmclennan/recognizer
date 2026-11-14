import { describe, expect, it, vi } from "vitest";
import { inertScanHost, showExplorer } from "./explorer";
import {
  loadedOf,
  mountExplorer,
  registeredOf,
  scanHostOf,
} from "./look-support";

vi.mock("./explorer", async () => {
  const actual =
    await vi.importActual<typeof import("./explorer")>("./explorer");
  return { ...actual, showExplorer: vi.fn() };
});

describe("look-support", () => {
  it("loadedOf carries every key of a Loaded", () => {
    expect(Object.keys(loadedOf()).sort()).toEqual(
      [
        "baseline",
        "blocking",
        "findings",
        "modules",
        "notices",
        "policy",
        "scans",
        "sensors",
      ].sort(),
    );
  });

  it("loadedOf lets an override win over the base", () => {
    const loaded = loadedOf({ modules: ["a.py"], blocking: "stop" });

    expect(loaded.modules).toEqual(["a.py"]);
    expect(loaded.blocking).toBe("stop");
    expect(loaded.notices).toEqual([]);
  });

  it("scanHostOf equals the inert scan host shape", () => {
    expect(Object.keys(scanHostOf()).sort()).toEqual(
      Object.keys(inertScanHost).sort(),
    );
  });

  it("scanHostOf lets an override win", () => {
    const run = () => {};

    expect(scanHostOf({ run }).run).toBe(run);
    expect(scanHostOf({ run }).stop).toBe(inertScanHost.stop);
  });

  it("registeredOf keeps the display and drops the title", () => {
    expect(
      registeredOf([
        {
          name: "crap",
          display: "CRAP",
          title: "t",
          runsTests: true,
          scoped: false,
          registered: true,
        },
      ]),
    ).toEqual({
      sensors: [
        {
          name: "crap",
          display: "CRAP",
          runsTests: true,
          registered: true,
        },
      ],
      describerRegistered: true,
    });
  });

  it("mountExplorer forwards every option to showExplorer in positional order", () => {
    const returned = { handle: true };
    const mock = vi.mocked(showExplorer);
    mock.mockReset();
    mock.mockReturnValue(returned as never);
    const keys = [
      "container",
      "loaded",
      "title",
      "onCount",
      "views",
      "post",
      "carried",
      "scheduler",
      "storage",
      "editor",
      "responsibilities",
      "windowPort",
      "scanHost",
      "withdraw",
      "reconcileMessages",
      "comparisons",
      "commits",
    ];
    const options = Object.fromEntries(
      keys.map((key) => [key, { sentinel: key }]),
    );

    const result = mountExplorer(options as never);

    expect(result).toBe(returned);
    expect(mock.mock.calls[0]).toEqual(keys.map((key) => ({ sentinel: key })));
  });

  it("mountExplorer leaves unset options undefined so defaults apply", () => {
    const mock = vi.mocked(showExplorer);
    mock.mockReset();
    const container = { sentinel: "container" };
    const loaded = { sentinel: "loaded" };

    mountExplorer({ container, loaded, title: "demo" } as never);

    const args = mock.mock.calls[0];
    expect(args.slice(0, 3)).toEqual([container, loaded, "demo"]);
    expect(args.length).toBe(17);
    expect(args.slice(3)).toEqual(new Array(14).fill(undefined));
  });
});
