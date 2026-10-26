import { describe, expect, it } from "vitest";
import { type KeyInput, keyAction } from "./canvas-keys";

const press = (key: string, extra: Partial<KeyInput> = {}): KeyInput => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  targetEditable: false,
  pickerOpen: false,
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

  it("maps I to the contents for a module or a folder only", () => {
    expect(keyAction(press("i"), folder)).toBe("contents");
    expect(keyAction(press("i"), module)).toBe("contents");
    expect(keyAction(press("I"), module)).toBe("contents");
    expect(keyAction(press("i"), { kind: "edge", id: "e" })).toBeNull();
    expect(keyAction(press("i"), null)).toBeNull();
    expect(keyAction(press("i", { targetEditable: true }), module)).toBeNull();
    expect(keyAction(press("i", { metaKey: true }), module)).toBeNull();
  });

  it("maps U and D to the pickers for a module or a folder", () => {
    for (const selection of [module, folder]) {
      expect(keyAction(press("u"), selection)).toBe("uses");
      expect(keyAction(press("U"), selection)).toBe("uses");
      expect(keyAction(press("d"), selection)).toBe("used-by");
    }
  });

  it("ignores U and D for an edge, no selection, a modifier or an editable target", () => {
    expect(keyAction(press("u"), { kind: "edge", id: "e" })).toBeNull();
    expect(keyAction(press("d"), null)).toBeNull();
    expect(keyAction(press("u", { metaKey: true }), module)).toBeNull();
    expect(keyAction(press("u", { targetEditable: true }), module)).toBeNull();
  });

  it("escapes from an editable target only while the picker is open", () => {
    expect(
      keyAction(
        press("Escape", { targetEditable: true, pickerOpen: true }),
        null,
      ),
    ).toBe("escape");
    expect(
      keyAction(
        press("Backspace", { targetEditable: true, pickerOpen: true }),
        module,
      ),
    ).toBeNull();
    expect(
      keyAction(press("Escape", { metaKey: true, pickerOpen: true }), null),
    ).toBeNull();
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
