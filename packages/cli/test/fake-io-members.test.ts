import { describe, expect, it } from "vitest";
import { FakeIo } from "./support/index.js";

const settled = async (running: { result: Promise<unknown> }) => {
  let done = false;

  void running.result.then(() => {
    done = true;
  });

  await new Promise((resolve) => setImmediate(resolve));

  return done;
};

describe("FakeFiles list and modeOf", () => {
  it("lists written and seeded files under the prefix and none outside it", () => {
    const io = new FakeIo();

    io.files.writeFile("/out/b.txt", "b");
    io.files.writeFile("/out/a/c.txt", "c");
    io.files.writeFile("/outside/d.txt", "d");
    io.files.writeFile("/out2/e.txt", "e");

    expect(io.files.list("/out")).toEqual(["/out/a/c.txt", "/out/b.txt"]);
    expect(io.files.list("/nothing")).toEqual([]);
  });

  it("returns the mode a write stored and undefined for an unwritten path", () => {
    const io = new FakeIo();

    io.files.writeFile("/out/run", "x", 0o755);
    io.files.writeFile("/out/plain", "x");

    expect(io.files.modeOf("/out/run")).toBe(0o755);
    expect(io.files.modeOf("/out/plain")).toBeUndefined();
    expect(io.files.modeOf("/out/missing")).toBeUndefined();
  });
});

describe("FakeProcesses survivesKill", () => {
  it("leaves a killed call unsettled when the program sets survivesKill", async () => {
    const io = new FakeIo({
      programs: {
        stubborn: async (call) => {
          call.survivesKill = true;
          await new Promise(() => {});

          return { started: true, status: 0, stdout: "", stderr: "" };
        },
      },
    });
    const running = io.runAsync("stubborn", []);

    await new Promise((resolve) => setImmediate(resolve));
    running.kill();

    expect(await settled(running)).toBe(false);
  });

  it("settles a killed call with status 128 when the program does not set it", async () => {
    const io = new FakeIo({
      programs: {
        obedient: () => new Promise(() => {}),
      },
    });
    const running = io.runAsync("obedient", []);

    running.kill();

    expect(await settled(running)).toBe(true);
    expect(await running.result).toMatchObject({ status: 128 });
  });
});
