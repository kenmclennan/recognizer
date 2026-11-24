import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRepositoryState } from "../../src/repository-state-fake";
import { createRepositoryStateHolder } from "../../src/repository-state-holder";
import { createSensorsSource } from "../../src/sensors-source";
import { snapshotOf } from "./repository-state-snapshot";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const HASH = "a".repeat(64);
const KNOWN = { "tests/a.py": "h" };

function sourceOver(state = snapshotOf(1, ["crap", "mutation"])) {
  const results = fakeRepositoryState(state);
  const source = createSensorsSource({
    state: createRepositoryStateHolder(results),
    results,
  });

  return { results, source };
}

describe("sensorsSource", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("readTestsHash calls core with tests.hash and the known hashes", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ok: HASH });

    const { source } = sourceOver();
    const hash = await source.readTestsHash(KNOWN);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("core_call", {
      op: "tests.hash",
      args: { known: KNOWN },
    });
    expect(hash).toBe(HASH);

    vi.mocked(invoke).mockResolvedValueOnce({ ok: null });

    expect(await source.readTestsHash(KNOWN)).toBeNull();

    vi.mocked(invoke).mockResolvedValueOnce({ error: "x" });

    await expect(source.readTestsHash(KNOWN)).rejects.toThrow("x");
  });

  it("lists the registry's manifests as the installed sensors with no spawn", async () => {
    const { source } = sourceOver();
    const list = await source.sensorList();

    expect(list.status).toBe("ok");
    expect(
      list.status === "ok" ? list.sensors.map(({ name }) => name) : [],
    ).toEqual(["crap", "mutation"]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("reads findings and overlay texts through the service and keeps an unreadable file", async () => {
    const { source, results } = sourceOver();

    results.setTexts("crap", { findings: "{}", overlay: "{}" });
    results.setTexts("mutation", { findingsProblem: "bad json" });

    const stored = await source.readResults();

    expect(stored.findings.files.map(({ name }) => name)).toEqual(["crap"]);
    expect(stored.findings.refused).toEqual(["mutation"]);
    expect(stored.overlays.files.map(({ name }) => name)).toEqual(["crap"]);
    expect(results.cleared).toEqual([]);
  });

  it("clears one plugin's results through the service", async () => {
    const { source, results } = sourceOver();

    await source.clearResults("crap");

    expect(results.cleared).toEqual(["crap"]);
  });
});
