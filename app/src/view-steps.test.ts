import { resolveView, type ViewStep } from "recognizer";
import { describe, expect, it } from "vitest";
import { expectedScan } from "./fixtures";
import { stepsFor } from "./view-steps";

const scans = [expectedScan("python")];
const view = (steps: ViewStep[]) => ({
  schema_version: 1 as const,
  description: "d",
  commit: null,
  steps,
});
const canvas = (
  modules: string[],
  folded: string[] = [],
  focus: string | null = null,
) => ({
  modules,
  folded,
  focus,
});
const roundTrip = (steps: ViewStep[]) =>
  resolveView(view(steps), scans).modules;

const A = "shop/application/place.py";
const B = "shop/application/refund.py";
const C = "shop/ports/store.py";
const D = "shop/domain/aliases.py";

describe("stepsFor", () => {
  it("saves a new view of three modules as three picks in order", () => {
    const steps = stepsFor([], canvas([A, B, C]), scans);

    expect(steps).toEqual([
      { kind: "pick", module: A },
      { kind: "pick", module: B },
      { kind: "pick", module: C },
    ]);
    expect(roundTrip(steps)).toEqual([A, B, C].sort());
  });

  it("leaves an untouched rule alone and adds one pick for a module the user added", () => {
    const base: ViewStep[] = [
      { kind: "rule", relation: "folder", of: "shop/domain" },
    ];
    const domain = resolveView(view(base), scans).modules;
    const steps = stepsFor(base, canvas([...domain, A]), scans);

    expect(steps).toEqual([...base, { kind: "pick", module: A }]);
  });

  it("deletes the pick of a picked module taken off", () => {
    const base: ViewStep[] = [
      { kind: "pick", module: A },
      { kind: "pick", module: B },
    ];
    const steps = stepsFor(base, canvas([B]), scans);

    expect(steps).toEqual([{ kind: "pick", module: B }]);
  });

  it("records left-out for a rule-contributed module taken off and drops it when ticked back", () => {
    const base: ViewStep[] = [
      { kind: "rule", relation: "folder", of: "shop/domain" },
    ];
    const domain = resolveView(view(base), scans).modules;
    const without = domain.filter((id) => id !== D);
    const off = stepsFor(base, canvas(without), scans);

    expect(off).toEqual([...base, { kind: "left-out", module: D }]);
    expect(roundTrip(off)).toEqual(without);
    expect(domain).toHaveLength(4);
    expect(without).toHaveLength(3);

    const back = stepsFor(off, canvas(domain), scans);

    expect(back).toEqual(base);
  });

  it("records only a left-out for a module both picked and rule-contributed", () => {
    const base: ViewStep[] = [
      { kind: "rule", relation: "folder", of: "shop/domain" },
      { kind: "pick", module: D },
    ];
    const domain = resolveView(view(base), scans).modules;
    const without = domain.filter((id) => id !== D);
    const steps = stepsFor(base, canvas(without), scans);

    expect(steps.filter((step) => step.kind === "pick")).toEqual([]);
    expect(steps).toContainEqual({ kind: "left-out", module: D });
    expect(roundTrip(steps)).toEqual(without);
  });

  it("replaces fold and focus rather than duplicating them", () => {
    const base: ViewStep[] = [
      { kind: "pick", module: A },
      { kind: "fold", folder: "shop/ports" },
      { kind: "focus", folder: "shop/ports" },
    ];
    const steps = stepsFor(
      base,
      canvas([A], ["shop/domain", "shop/application"], "shop/domain"),
      scans,
    );

    expect(steps).toEqual([
      { kind: "pick", module: A },
      { kind: "fold", folder: "shop/application" },
      { kind: "fold", folder: "shop/domain" },
      { kind: "focus", folder: "shop/domain" },
    ]);
  });

  it("round-trips a rule view with a module taken off against the committed fixture scan", () => {
    const base: ViewStep[] = [
      { kind: "rule", relation: "folder", of: "shop/domain" },
    ];
    const without = resolveView(view(base), scans).modules.filter(
      (id) => id !== D,
    );
    const resolved = resolveView(
      view(stepsFor(base, canvas(without), scans)),
      scans,
    );

    expect(resolved.modules).toEqual(without);
    expect(resolved.modules).toEqual([
      "shop/domain/__init__.py",
      "shop/domain/customer.py",
      "shop/domain/order.py",
    ]);
  });
});
