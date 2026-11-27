import { describe, expect, it } from "vitest";
import { Gate, typescriptScanner } from "../../../cli/test/support/index";
import { bridge, untilHolds } from "../app-harness";
import {
  type InProcessRootOptions,
  inProcessAppRoot,
} from "../in-process-root";

type Call = { command: string; args: Record<string, unknown> };

async function editorRoot(
  failWith: string | null,
  options: InProcessRootOptions = {},
) {
  const root = await inProcessAppRoot(options);
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

  return { root, calls };
}

async function loadedRoot(failWith: string | null) {
  const made = await editorRoot(failWith);

  await untilHolds(
    made.root.service,
    () => made.root.view.loaded() ?? undefined,
  );

  return made;
}

const errorsOf = (root: { view: { posted: { kind: string }[] } }) =>
  root.view.posted.filter((notice) => notice.kind === "error");

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
    expect(errorsOf(root)).toEqual([]);
  });

  it("is not disturbed by the open scan's started notice", async () => {
    const gate = new Gate();

    gate.hold();

    const { root, calls } = await editorRoot(null, {
      programs: { "recognizer-scan-typescript": typescriptScanner({ gate }) },
    });

    await untilHolds(root.service, () =>
      root.view.posted.some((notice) =>
        String((notice as { text?: string }).text).startsWith("Scan started"),
      )
        ? true
        : undefined,
    );

    gate.open();
    await untilHolds(root.service, () => root.view.loaded() ?? undefined);

    root.view.explorer()?.select({ kind: "module", id: "api/src/a.ts" });
    root.app.openSelectedInEditor();

    await untilHolds(root.service, () =>
      calls.length > 0 ? calls : undefined,
    );

    expect(calls).toHaveLength(1);
    expect(errorsOf(root)).toEqual([]);
  });

  it("posts the editor's rejection as an error notice", async () => {
    const { root, calls } = await loadedRoot("no editor is configured");

    root.view.explorer()?.select({ kind: "module", id: "api/src/a.ts" });
    root.app.openSelectedInEditor();

    const posted = await untilHolds(root.service, () =>
      errorsOf(root).length > 0 ? errorsOf(root) : undefined,
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
