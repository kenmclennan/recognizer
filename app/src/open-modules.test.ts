import { describe, expect, it } from "vitest";
import { createOpenModules } from "./open-modules";

describe("open modules", () => {
  it("opens, counts and closes modules in the order opened", () => {
    const modules = createOpenModules(["a.py", "b.py", "c.py"]);

    modules.open("b.py");
    modules.open("a.py");
    modules.open("b.py");

    expect(modules.opened()).toEqual(["b.py", "a.py"]);
    expect(modules.count()).toBe(2);
    expect(modules.total()).toBe(3);
    expect(modules.isOpen("a.py")).toBe(true);

    modules.close("b.py");

    expect(modules.opened()).toEqual(["a.py"]);
    expect(modules.isOpen("b.py")).toBe(false);
  });

  it("clears the selection when the selected module is closed", () => {
    const modules = createOpenModules(["a.py", "b.py"]);

    modules.open("a.py");
    modules.open("b.py");
    modules.select("a.py");
    modules.close("b.py");

    expect(modules.selected()).toBe("a.py");

    modules.close("a.py");

    expect(modules.selected()).toBeNull();
  });

  it("ignores an id that is not a repository module", () => {
    const modules = createOpenModules(["a.py"]);

    modules.open("ghost.py");
    modules.select("ghost.py");

    expect(modules.count()).toBe(0);
    expect(modules.selected()).toBeNull();
  });

  it("counts distinct module ids as the total", () => {
    expect(createOpenModules(["a.py", "a.py", "b.py"]).total()).toBe(2);
  });
});
