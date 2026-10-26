import type { Scan, ScanCall } from "recognizer";
import { describe, expect, it } from "vitest";
import { expectedScan } from "./fixtures";
import { buildCallerIndex, callerButton } from "./member-callers";

const call = (
  from: string,
  to: string,
  how: ScanCall["how"] = "call",
): ScanCall => ({ from, to, line: 1, how });

const scanOf = (calls: ScanCall[] | undefined): Scan => ({
  modules: [],
  edges: [],
  foreign: [],
  ...(calls === undefined ? {} : { calls }),
});

const summaryOf = (calls: ScanCall[], module: string, qualified: string) =>
  buildCallerIndex([scanOf(calls)]).of(module, qualified);

describe("callers", () => {
  it("finds direct callers and sorts them by label", () => {
    const summary = summaryOf(
      [call("z.py::f", "m.py::g"), call("a.py::f", "m.py::g")],
      "m.py",
      "g",
    );

    expect(summary.callers).toEqual([
      { module: "a.py", through: null },
      { module: "z.py", through: null },
    ]);
    expect(summary.constructed).toBe(false);
  });

  it("marks a construct", () => {
    const summary = summaryOf(
      [call("a.py::f", "m.py::C", "construct")],
      "m.py",
      "C",
    );

    expect(summary.constructed).toBe(true);
  });

  it("excludes the member's own module", () => {
    const summary = summaryOf(
      [call("m.py::f", "m.py::g"), call("a.py::f", "m.py::g")],
      "m.py",
      "g",
    );

    expect(summary.callers.map((caller) => caller.module)).toEqual(["a.py"]);
  });

  it("follows one dispatch hop and names the abstraction", () => {
    const summary = summaryOf(
      [
        call("a.py::f", "p.py::Port.save"),
        call("p.py::Port.save", "m.py::Impl.save", "dispatch"),
      ],
      "m.py",
      "Impl.save",
    );

    expect(summary.callers).toEqual([{ module: "a.py", through: "Port" }]);
  });

  it("follows two hops and keeps the abstraction the caller called", () => {
    const summary = summaryOf(
      [
        call("a.py::f", "p.py::Outer.save"),
        call("p.py::Outer.save", "q.py::Inner.save", "dispatch"),
        call("q.py::Inner.save", "m.py::Impl.save", "dispatch"),
      ],
      "m.py",
      "Impl.save",
    );

    expect(summary.callers).toEqual([{ module: "a.py", through: "Outer" }]);
  });

  it("ends on a dispatch cycle", () => {
    const summary = summaryOf(
      [
        call("p.py::A.x", "q.py::B.x", "dispatch"),
        call("q.py::B.x", "p.py::A.x", "dispatch"),
        call("a.py::f", "p.py::A.x"),
      ],
      "q.py",
      "B.x",
    );

    expect(summary.callers).toEqual([{ module: "a.py", through: "A" }]);
  });

  it("takes a module with direct and through calls as direct", () => {
    const summary = summaryOf(
      [
        call("a.py::f", "m.py::Impl.save"),
        call("a.py::g", "p.py::Port.save"),
        call("p.py::Port.save", "m.py::Impl.save", "dispatch"),
      ],
      "m.py",
      "Impl.save",
    );

    expect(summary.callers).toEqual([{ module: "a.py", through: null }]);
  });

  it("uses the whole name as the abstraction when it has no dot", () => {
    const summary = summaryOf(
      [
        call("a.py::f", "p.py::port"),
        call("p.py::port", "m.py::impl", "dispatch"),
      ],
      "m.py",
      "impl",
    );

    expect(summary.callers).toEqual([{ module: "a.py", through: "port" }]);
  });

  it("separates a scan with no calls from one with empty calls", () => {
    const index = buildCallerIndex([
      { ...scanOf(undefined), modules: [{ id: "u.py", kind: "module" }] },
      { ...scanOf([]), modules: [{ id: "k.py", kind: "module" }] },
    ]);

    expect(index.known("u.py")).toBe(false);
    expect(index.known("k.py")).toBe(true);
    expect(index.of("k.py", "f").callers).toEqual([]);
  });
});

describe("caller text", () => {
  const direct = (...modules: string[]) => ({
    callers: modules.map((module) => ({ module, through: null })),
    constructed: false,
  });

  it("has no button for no callers", () => {
    expect(callerButton("function", "f", direct())).toBeNull();
  });

  it("names one or two callers and counts three", () => {
    expect(callerButton("function", "f", direct("a.py"))?.text).toBe(
      "called by a",
    );
    expect(callerButton("function", "f", direct("a.py", "b.py"))?.text).toBe(
      "called by a, b",
    );
    expect(
      callerButton("function", "f", direct("a.py", "b.py", "c.py"))?.text,
    ).toBe("called by 3");
  });

  it("picks the verb from the kind and the constructs", () => {
    const built = { ...direct("a.py"), constructed: true };

    expect(callerButton("class", "C", built)?.text).toBe("built by a");
    expect(callerButton("class", "C", direct("a.py"))?.text).toBe("used by a");
    expect(callerButton("constant", "K", direct("a.py"))?.text).toBe(
      "used by a",
    );
    expect(callerButton("method", "C.m", direct("a.py"))?.text).toBe(
      "called by a",
    );
  });

  it("appends the abstraction only when every caller goes through one", () => {
    const all = {
      callers: [
        { module: "a.py", through: "Store" },
        { module: "b.py", through: "Store" },
        { module: "c.py", through: "Store" },
      ],
      constructed: false,
    };

    expect(callerButton("method", "C.m", all)?.text).toBe(
      "called by 3, through Store",
    );
    expect(callerButton("method", "C.m", all)?.title).toBe("a, b, c");
  });

  it("counts abstractions above two", () => {
    const many = {
      callers: ["A", "B", "C"].map((through, index) => ({
        module: `m${index}.py`,
        through,
      })),
      constructed: false,
    };

    expect(callerButton("method", "C.m", many)?.text).toBe(
      "called by 3, through 3 abstractions",
    );
  });

  it("gives a mixed case no suffix and a breakdown title", () => {
    const mixed = {
      callers: [
        { module: "a.py", through: null },
        { module: "b.py", through: "Store" },
        { module: "c.py", through: "Store" },
      ],
      constructed: false,
    };
    const button = callerButton("method", "C.m", mixed);

    expect(button?.text).toBe("called by 3");
    expect(button?.title).toBe("a, b (through Store), c (through Store)");
  });

  it("has no button for constructors", () => {
    expect(callerButton("method", "C.__init__", direct("a.py"))).toBeNull();
    expect(callerButton("method", "C.constructor", direct("a.py"))).toBeNull();
  });

  it("titles the picker with the verb and the last name segment", () => {
    const built = { ...direct("a.py"), constructed: true };

    expect(
      callerButton("method", "Store.save", direct("a.py"))?.pickerTitle,
    ).toBe("calls save");
    expect(callerButton("class", "CreateItemInput", built)?.pickerTitle).toBe(
      "builds CreateItemInput",
    );
    expect(callerButton("constant", "BUSY", direct("a.py"))?.pickerTitle).toBe(
      "uses BUSY",
    );
    expect(
      callerButton("method", "Store.save", direct("a.py"))?.callers,
    ).toEqual(["a.py"]);
  });
});

describe("callers in fixtures/python", () => {
  const scan = expectedScan("python");
  const index = buildCallerIndex([scan]);

  it("reads MemoryStore.save as called by refund through Store", () => {
    const summary = index.of(
      "shop/adapters/memory_store.py",
      "MemoryStore.save",
    );

    expect(callerButton("method", "MemoryStore.save", summary)?.text).toBe(
      "called by refund, through Store",
    );
  });

  it("reads Store.save as called by refund", () => {
    const summary = index.of("shop/ports/store.py", "Store.save");

    expect(callerButton("method", "Store.save", summary)?.text).toBe(
      "called by refund",
    );
  });

  it("reads new_order as called by place", () => {
    const summary = index.of("shop/domain/order.py", "new_order");

    expect(callerButton("function", "new_order", summary)?.text).toBe(
      "called by place",
    );
  });

  it("gives Order no button because its only construct is in its own module", () => {
    const summary = index.of("shop/domain/order.py", "Order");

    expect(callerButton("class", "Order", summary)).toBeNull();
  });
});
