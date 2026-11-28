import { describe, expect, it } from "vitest";
import {
  describerInEffect,
  InvalidRequest,
  noneRegistered,
  readDescriber,
  registrationFileName,
  serializeRegistration,
} from "../../src/index.js";
import { createFakes, pluginPortsOf } from "../fakes/container.js";
import { DescribingWorld, ROOT } from "./describing-world.js";

function registryWorld() {
  const fakes = createFakes();

  function register(
    name: string,
    modified: number,
    manifest: Record<string, unknown> | null = { prompt_version: `pv-${name}` },
  ): void {
    const command = [`/registered/${name}`];

    if (manifest !== null) {
      fakes.programs.install("/registered", name, (args) =>
        args[0] === "manifest"
          ? {
              stdout: JSON.stringify({
                kind: "describer",
                name,
                display: name,
                protocol: fakes.documentValidators.facts.protocol,
                install: `brew install ${name}`,
                settings: [],
                ...manifest,
              }),
            }
          : {},
      );
    }

    fakes.pluginRegistrations.place(
      "user",
      registrationFileName("describer", name),
      serializeRegistration({
        kind: "describer",
        name,
        command,
        manifest: [...command, "manifest"],
      }),
      modified,
    );
  }

  return { fakes, register, ports: () => pluginPortsOf(fakes) };
}

describe("readDescriber", () => {
  it("gives the command and version of a registered describer", () => {
    const world = new DescribingWorld();

    expect(readDescriber(world.ports, ROOT)).toEqual({
      command: ["quill", "run", "{module}"],
      version: "v1",
    });
  });

  it("refuses when none is registered", () => {
    const world = new DescribingWorld();

    world.describer.registered = false;

    expect(() => readDescriber(world.ports, ROOT)).toThrow(InvalidRequest);
    expect(() => readDescriber(world.ports, ROOT)).toThrow(noneRegistered());
  });

  it("uses the registered describer with its manifest prompt version", () => {
    const { register, ports } = registryWorld();

    register("quill", 1);

    expect(describerInEffect(ports())).toEqual({
      command: ["/registered/quill", "run", "--model", "{model}", "{request}"],
      version: "pv-quill",
      install: "brew install quill",
    });
  });

  it("finds none registered when the registry holds no describer", () => {
    const { ports } = registryWorld();

    expect(describerInEffect(ports())).toBeNull();
  });

  it("reports the manifest reason when the describer manifest cannot be read", () => {
    const { register, ports } = registryWorld();

    register("quill", 1, null);

    const found = describerInEffect(ports());

    expect(found !== null && "unreadable" in found).toBe(true);
  });

  it("reports an unreadable describer with no prompt version", () => {
    const { register, ports } = registryWorld();

    register("quill", 1, { prompt_version: undefined });

    const found = describerInEffect(ports());

    expect(found).toEqual({
      unreadable: "/registered/quill manifest has no prompt_version",
    });
  });

  it("takes the describer registered later when two are registered", () => {
    const { register, ports } = registryWorld();

    register("first", 1);
    register("second", 2);

    expect(describerInEffect(ports())).toMatchObject({
      command: ["/registered/second", "run", "--model", "{model}", "{request}"],
      version: "pv-second",
    });
  });

  it("refuses with the manifest reason when the describer manifest cannot be read", () => {
    const world = new DescribingWorld();

    world.describer.unreadableReason = "quill manifest could not be started";

    expect(() => readDescriber(world.ports, ROOT)).toThrow(
      "quill manifest could not be started",
    );
  });
});
