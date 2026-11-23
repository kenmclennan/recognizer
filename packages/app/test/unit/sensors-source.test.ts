import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sensorsSource } from "../../src/sensors-source";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const HASH = "a".repeat(64);
const KNOWN = { "tests/a.py": "h" };

describe("sensorsSource", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("readTestsHash calls core with tests.hash and the known hashes", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ok: HASH });

    const hash = await sensorsSource.readTestsHash(KNOWN);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("core_call", {
      op: "tests.hash",
      args: { known: KNOWN },
    });
    expect(hash).toBe(HASH);

    vi.mocked(invoke).mockResolvedValueOnce({ ok: null });

    expect(await sensorsSource.readTestsHash(KNOWN)).toBeNull();

    vi.mocked(invoke).mockResolvedValueOnce({ error: "x" });

    await expect(sensorsSource.readTestsHash(KNOWN)).rejects.toThrow("x");
  });
});
