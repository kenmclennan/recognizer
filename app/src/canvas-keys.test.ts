import { describe, expect, it } from "vitest";
import { type KeyInput, keyAction } from "./canvas-keys";

const press = (key: string, extra: Partial<KeyInput> = {}): KeyInput => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  targetEditable: false,
  ...extra,
});

const folder = { kind: "folder", id: "a" } as const;
const module = { kind: "module", id: "a/x.py" } as const;

describe("canvas keys", () => {
  it("maps F and Z on a folder, in either case", () => {
    expect(keyAction(press("f"), folder)).toBe("focus");
    expect(keyAction(press("F", {}), folder)).toBe("focus");
    expect(keyAction(press("z"), folder)).toBe("fold");
  });

  it("ignores F and Z on a module and with nothing selected", () => {
    expect(keyAction(press("f"), module)).toBeNull();
    expect(keyAction(press("z"), null)).toBeNull();
  });

  it("takes off a module or folder but not an edge", () => {
    expect(keyAction(press("Backspace"), module)).toBe("take-off");
    expect(keyAction(press("Backspace"), folder)).toBe("take-off");
    expect(keyAction(press("Backspace"), { kind: "edge", id: "e" })).toBeNull();
  });

  it("escapes with or without a selection", () => {
    expect(keyAction(press("Escape"), null)).toBe("escape");
    expect(keyAction(press("Escape"), module)).toBe("escape");
  });

  it("leaves U, D and I unbound", () => {
    for (const key of ["u", "d", "i"]) {
      expect(keyAction(press(key), folder)).toBeNull();
    }
  });

  it("ignores keys typed into an input and chords with a modifier", () => {
    expect(keyAction(press("f", { targetEditable: true }), folder)).toBeNull();
    expect(
      keyAction(press("Backspace", { targetEditable: true }), module),
    ).toBeNull();
    expect(
      keyAction(press("Escape", { targetEditable: true }), module),
    ).toBeNull();
    expect(keyAction(press("f", { metaKey: true }), folder)).toBeNull();
    expect(keyAction(press("z", { ctrlKey: true }), folder)).toBeNull();
  });
});
