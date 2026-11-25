import { describe, expect, expectTypeOf, it } from "vitest";
import type { Io } from "../src/cli.js";
import { answeringOnlyGit, type CliRootFakes, cliRoot } from "./roots.js";

describe("the CLI root", () => {
  it("cliRoot only takes the outermost-port members", () => {
    expectTypeOf<CliRootFakes>().toHaveProperty("run");
    expectTypeOf<CliRootFakes>().toHaveProperty("now");
    expectTypeOf<CliRootFakes>().toHaveProperty("readFile");

    // @ts-expect-error env is not an outermost port
    const refused: CliRootFakes = { env: () => undefined };
    // @ts-expect-error stdout is owned by the root
    const owned: CliRootFakes = { stdout: () => {} };

    expectTypeOf<CliRootFakes>().not.toHaveProperty("env");
    expectTypeOf<CliRootFakes>().not.toHaveProperty("stdout");
    expect([refused, owned]).toHaveLength(2);
  });

  it("cliRoot returns the output and exit code of run", async () => {
    const calls: string[][] = [];
    const root = cliRoot({
      now: () => 42,
      run: answeringOnlyGit((args) => {
        calls.push(args);

        return { started: true, status: 0, stdout: "fake\n", stderr: "" };
      }),
    });
    const exit = await root.run(["help"]);

    expect(exit).toBe(0);
    expect(root.out()).toContain("recognizer");
    expect(root.err()).toBe("");
    expect(calls).toEqual([]);
  });

  it("a git fake answers only for git and every other command reaches the next layer", () => {
    const run: Io["run"] = answeringOnlyGit(() => ({
      started: true,
      status: 0,
      stdout: "from the fake\n",
      stderr: "",
    }));

    expect(run("git", ["status"]).stdout).toBe("from the fake\n");

    const other = run(process.execPath, ["-e", "process.stdout.write('real')"]);

    expect(other.stdout).toBe("real");
  });
});
