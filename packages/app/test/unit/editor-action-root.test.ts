import { describe, expect, it } from "vitest";
import { bridge, untilHolds } from "../app-harness";
import { inProcessAppRoot } from "../in-process-root";

type Call = { command: string; args: Record<string, unknown> };

async function loadedRoot(failWith: string | null) {
  const root = await inProcessAppRoot();
  const calls: Call[] = [];
  const answer = bridge.invoke;

  bridge.invoke = async (command, args = {}) => {
    if (command === "open_in_editor") {
      calls.push({ command, args });

      if (failWith !== null) {
        throw new Error(failWith);
      }

      return undefined;
    }

    return answer(command, args);
  };

  await untilHolds(root.service, () => root.view.loaded() ?? undefined);

  return { root, calls };
}

describe("the explorer's open-in-editor action through the app root", () => {
  it("sends the selected module to the editor command", async () => {
    const { root, calls } = await loadedRoot(null);

    root.view.explorer()?.select({ kind: "module", id: "api/src/a.ts" });
    root.app.openSelectedInEditor();

    await untilHolds(root.service, () =>
      calls.length > 0 ? calls : undefined,
    );

    expect(calls).toEqual([
      {
        command: "open_in_editor",
        args: { relative: "api/src/a.ts", line: undefined },
      },
    ]);
    expect(root.view.posted).toEqual([]);
  });

  it("posts the editor's rejection as an error notice", async () => {
    const { root, calls } = await loadedRoot("no editor is configured");

    root.view.explorer()?.select({ kind: "module", id: "api/src/a.ts" });
    root.app.openSelectedInEditor();

    const posted = await untilHolds(root.service, () =>
      root.view.posted.length > 0 ? root.view.posted : undefined,
    );

    expect(calls).toHaveLength(1);
    expect(posted).toEqual([
      { kind: "error", text: "no editor is configured" },
    ]);
  });

  it("does nothing when an edge is selected", async () => {
    const { root, calls } = await loadedRoot(null);

    root.view.explorer()?.select({ kind: "edge", id: "a>b" });
    root.app.openSelectedInEditor();
    await root.service.signal(100);

    expect(calls).toEqual([]);
  });
});
