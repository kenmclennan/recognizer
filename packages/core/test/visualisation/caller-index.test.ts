import { describe, expect, it } from "vitest";
import { CallerIndex } from "../../src/index.js";
import { repositoryWith } from "./world.js";

describe("CallerIndex", () => {
  it("reports a dispatch call through the class that holds it", () => {
    const repository = repositoryWith(
      ["impl.py", "client.py", "iface.py"],
      [],
      {
        calls: [
          {
            from: "client.py::Client.run",
            to: "iface.py::Port.go",
            how: "dispatch",
          },
          { from: "impl.py::Impl.go", to: "iface.py::Port.go", how: "direct" },
        ] as never,
      },
    );
    const found = CallerIndex.of(repository).of("iface.py", "Port.go");

    expect(found.callers.map((caller) => caller.module)).toEqual(["impl.py"]);
  });

  it("is not known for a module of a language with no call data", () => {
    const repository = repositoryWith(["a.py"]);

    expect(CallerIndex.of(repository).known("a.py")).toBe(false);
  });
});
