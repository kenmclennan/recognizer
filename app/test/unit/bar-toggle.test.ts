import { describe, expect, it } from "vitest";

import {
  type BarPanel,
  type PanelActions,
  pressKey,
  pressPanel,
} from "../../src/bar-toggle";
import { keyAction } from "../../src/canvas-keys";
import type { InspectorTab } from "../../src/inspector-model";
import type { BarModel } from "../../src/selection-bar-view";

function bench() {
  const state: { tab: InspectorTab | null; note: boolean } = {
    tab: null,
    note: false,
  };
  const actions: PanelActions = {
    openTab: (tab) => {
      state.tab = tab;
    },
    openContents: () => {
      state.tab = "contents";
    },
    closeInspector: () => {
      state.tab = null;
    },
    openNote: () => {
      state.note = true;
    },
    closeNote: () => {
      state.note = false;
    },
  };
  const model = (): BarModel => ({
    kind: "module",
    dependencies: 2,
    notes: { noted: false, open: state.note },
    findings: { count: 1, tone: "amber" },
    files: null,
    focused: false,
    folded: false,
    inspectorTab: state.tab,
  });
  const press = (panel: BarPanel) => pressPanel(model(), panel, actions);

  const key = (name: string) => {
    const action = keyAction(
      {
        key: name,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        targetEditable: false,
      },
      { kind: "module", id: "a.py" },
    );

    return action !== null && pressKey(action, model(), actions);
  };

  return { state, press, key };
}

describe("pressing a bar panel button", () => {
  it.each(["contents", "dependencies", "findings"] as const)(
    "opens the %s panel and closes it on the second press",
    (panel) => {
      const { state, press } = bench();

      press(panel);
      expect(state.tab).toBe(panel);

      press(panel);
      expect(state.tab).toBeNull();
    },
  );

  it("opens the note popover and closes it on the second press", () => {
    const { state, press } = bench();

    press("notes");
    expect(state.note).toBe(true);

    press("notes");
    expect(state.note).toBe(false);
  });

  it("switches to Dependencies while the inspector shows Findings", () => {
    const { state, press } = bench();

    press("findings");
    press("dependencies");

    expect(state.tab).toBe("dependencies");
  });

  it("switches to Findings while the inspector shows Dependencies", () => {
    const { state, press } = bench();

    press("dependencies");
    press("findings");

    expect(state.tab).toBe("findings");
  });
});

describe("pressing a shortcut key", () => {
  it.each([
    ["i", "contents"],
    ["d", "dependencies"],
    ["w", "findings"],
  ] as const)(
    "%s opens its panel and closes it on the second press",
    (name, tab) => {
      const { state, key } = bench();

      expect(key(name)).toBe(true);
      expect(state.tab).toBe(tab);

      expect(key(name)).toBe(true);
      expect(state.tab).toBeNull();
    },
  );

  it("n opens the note popover and closes it on the second press", () => {
    const { state, key } = bench();

    expect(key("n")).toBe(true);
    expect(state.note).toBe(true);

    expect(key("n")).toBe(true);
    expect(state.note).toBe(false);
  });

  it("d switches to Dependencies while the inspector shows Findings", () => {
    const { state, key } = bench();

    key("w");
    key("d");

    expect(state.tab).toBe("dependencies");
  });
});
