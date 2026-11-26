import { describe, expect, it } from "vitest";
import {
  InvalidRequest,
  type PluginKind,
  registerWithRegistry,
  unregisterFromRegistry,
} from "../../src/index.js";
import { createFakes, pluginPortsOf } from "../fakes/container.js";

function setup() {
  const fakes = createFakes();

  function install(
    path: string,
    kind: PluginKind,
    name: string,
    extra: Record<string, unknown> = {},
  ): void {
    const directory = path.slice(0, path.lastIndexOf("/"));
    const file = path.slice(path.lastIndexOf("/") + 1);

    fakes.programs.install(directory, file, (args) =>
      args[0] === "manifest"
        ? {
            stdout: JSON.stringify({
              kind,
              name,
              protocol: fakes.documentValidators.facts.protocol,
              install: `brew install ${name}`,
              ...extra,
            }),
          }
        : {},
    );
  }

  return {
    fakes,
    install,
    ports: () => pluginPortsOf(fakes),
  };
}

describe("registerWithRegistry", () => {
  it.each([
    ["sensor", {}],
    ["scanner", {}],
    ["describer", { prompt_version: "1" }],
  ] as const)("registers a %s from a path", (kind, extra) => {
    const { fakes, install, ports } = setup();

    install("/tools/mine", kind, "mine", extra);

    const result = registerWithRegistry(ports(), { program: "/tools/mine" });

    expect(result.status).toBe("done");
    expect(fakes.pluginRegistrations.writes).toEqual([
      {
        kind,
        name: "mine",
        command: ["/tools/mine"],
        manifest: ["/tools/mine", "manifest"],
        source: "user",
      },
    ]);
  });

  it("resolves a bare program name on PATH to its absolute path", () => {
    const { fakes, install, ports } = setup();

    install("/bin/mine", "sensor", "mine");

    registerWithRegistry(ports(), { program: "mine" });

    expect(fakes.pluginRegistrations.writes[0]?.command).toEqual(["/bin/mine"]);
  });

  it("a bare program name that is not on PATH is an invalid request", () => {
    const { ports } = setup();

    expect(() => registerWithRegistry(ports(), { program: "ghost" })).toThrow(
      InvalidRequest,
    );
  });

  it("registers a describer while another is registered and makes it the newest with no refusal", () => {
    const { fakes, install, ports } = setup();

    install("/tools/first", "describer", "first", { prompt_version: "1" });
    install("/tools/second", "describer", "second", { prompt_version: "1" });

    registerWithRegistry(ports(), { program: "/tools/first" });

    const second = registerWithRegistry(ports(), { program: "/tools/second" });

    expect(second.status).toBe("done");
    expect(fakes.pluginRegistrations.entries().describer?.name).toBe("second");

    registerWithRegistry(ports(), { program: "/tools/first" });

    expect(fakes.pluginRegistrations.entries().describer?.name).toBe("first");
  });

  it("refuses a manifest that fails protocol and writes nothing", () => {
    const { fakes, install, ports } = setup();

    install("/tools/mine", "sensor", "mine", { protocol: 99 });

    const result = registerWithRegistry(ports(), { program: "/tools/mine" });

    expect(result.status).toBe("failed");
    expect(fakes.pluginRegistrations.writes).toEqual([]);
  });

  it("warns and still registers a plugin that speaks the previous protocol", () => {
    const { fakes, install, ports } = setup();

    install("/tools/mine", "sensor", "mine", {
      protocol: fakes.documentValidators.facts.protocol - 1,
    });

    const result = registerWithRegistry(ports(), { program: "/tools/mine" });

    expect(result.status === "done" && result.warnings).toHaveLength(1);
    expect(fakes.pluginRegistrations.writes).toHaveLength(1);
  });

  it("refuses a describer manifest without prompt_version and writes nothing", () => {
    const { fakes, install, ports } = setup();

    install("/tools/mine", "describer", "mine");

    const result = registerWithRegistry(ports(), { program: "/tools/mine" });

    expect(result.status).toBe("failed");
    expect(fakes.pluginRegistrations.writes).toEqual([]);
  });

  it.each([
    ["kind", { kind: "scanner" as const }],
    ["name", { name: "other" }],
  ])(
    "refuses a manifest whose %s disagrees with what was asked",
    (_what, expected) => {
      const { fakes, install, ports } = setup();

      install("/tools/mine", "sensor", "mine");

      const result = registerWithRegistry(ports(), {
        program: "/tools/mine",
        expected,
      });

      expect(result.status).toBe("failed");
      expect(fakes.pluginRegistrations.writes).toEqual([]);
    },
  );

  it("refuses a program that prints no manifest and writes nothing", () => {
    const { fakes, ports } = setup();

    const result = registerWithRegistry(ports(), { program: "/tools/missing" });

    expect(result.status).toBe("failed");
    expect(fakes.pluginRegistrations.writes).toEqual([]);
  });
});

describe("unregisterFromRegistry", () => {
  const text = (kind: PluginKind, name: string) =>
    JSON.stringify({
      registration_version: 1,
      kind,
      name,
      command: ["/x"],
      manifest: ["/x", "manifest"],
    });

  it("removes the user file only", () => {
    const { fakes, ports } = setup();

    fakes.pluginRegistrations.place(
      "user",
      "sensor-a.json",
      text("sensor", "a"),
      1,
    );
    fakes.pluginRegistrations.place(
      "homebrew",
      "sensor-a.json",
      text("sensor", "a"),
      1,
    );

    const result = unregisterFromRegistry(ports(), {
      name: "a",
      kind: undefined,
    });

    expect(result.status).toBe("done");
    expect(fakes.pluginRegistrations.files.map((held) => held.source)).toEqual([
      "homebrew",
    ]);
  });

  it("answers homebrew-only and removes nothing", () => {
    const { fakes, ports } = setup();

    fakes.pluginRegistrations.place(
      "homebrew",
      "scanner-b.json",
      text("scanner", "b"),
      1,
    );

    const result = unregisterFromRegistry(ports(), {
      name: "b",
      kind: undefined,
    });

    expect(result.message).toContain("brew uninstall");
    expect(fakes.pluginRegistrations.files).toHaveLength(1);
  });

  it("fails for a name that is not registered", () => {
    const { ports } = setup();

    expect(
      unregisterFromRegistry(ports(), { name: "c", kind: undefined }).status,
    ).toBe("failed");
  });

  it("names the kinds when ambiguous and --kind removes just one", () => {
    const { fakes, ports } = setup();

    fakes.pluginRegistrations.place(
      "user",
      "sensor-d.json",
      text("sensor", "d"),
      1,
    );
    fakes.pluginRegistrations.place(
      "user",
      "scanner-d.json",
      text("scanner", "d"),
      1,
    );

    const ambiguous = unregisterFromRegistry(ports(), {
      name: "d",
      kind: undefined,
    });

    expect(ambiguous.status).toBe("failed");
    expect(ambiguous.message).toContain("scanner, sensor");
    expect(fakes.pluginRegistrations.files).toHaveLength(2);

    unregisterFromRegistry(ports(), { name: "d", kind: "sensor" });

    expect(
      fakes.pluginRegistrations.files.map((held) => held.fileName),
    ).toEqual(["scanner-d.json"]);
  });
});
