import { describe, expect, it } from "vitest";
import {
  InvalidRequest,
  scaffoldPlugin,
  templateLanguages,
} from "../../src/index.js";
import { createFakes } from "../fakes/container.js";

const PROGRAM = ["recognizer", "scan", "demo"].join("-");

const MAP = {
  "a/language.json": JSON.stringify({ order: 2 }),
  "a/scanner/{{program}}": "a\n",
  "b/language.json": JSON.stringify({
    order: 1,
    launch: "bin/{{program}}",
    build: "make",
  }),
  "b/scanner/{{program}}": "b\n",
  "c/scanner/x": "x\n",
};

function world(templates: Record<string, string> = MAP) {
  const fakes = createFakes();

  fakes.pluginTemplates.templates = templates;

  return fakes;
}

function ports(fakes: ReturnType<typeof createFakes>) {
  return {
    sandbox: fakes.checkSandbox,
    templates: fakes.pluginTemplates,
    validators: fakes.documentValidators,
  };
}

function scaffold(language: string) {
  return scaffoldPlugin(ports(world()), {
    kind: "scanner",
    language,
    name: "demo",
    folder: "/out",
  });
}

describe("template languages", () => {
  it("lists languages by order, not by name, and skips a folder without language.json", () => {
    expect(templateLanguages(MAP)).toEqual(["b", "a"]);
  });

  it("breaks an order tie by name", () => {
    expect(
      templateLanguages({
        "y/language.json": '{"order":1}',
        "x/language.json": '{"order":1}',
      }),
    ).toEqual(["x", "y"]);
  });

  it("throws naming the key for a non-integer order", () => {
    expect(() =>
      templateLanguages({ "a/language.json": '{"order":"1"}' }),
    ).toThrow("a/language.json");
  });

  it("throws for an extra member", () => {
    expect(() =>
      templateLanguages({ "a/language.json": '{"order":1,"extra":true}' }),
    ).toThrow("extra");
  });

  it("refuses an unknown language with the usage listing the bundle's languages", () => {
    expect(() => scaffold("c")).toThrow(InvalidRequest);

    try {
      scaffold("c");
    } catch (error) {
      const text = (error as InvalidRequest).messages.join("\n");

      expect(text).toContain("--language <b|a>");
      expect(text).toContain("--language is one of: b, a");
      expect(text).toContain("--language b");
    }
  });

  it("prints the launch and build lines only for a language that has them", () => {
    const withFacts = scaffold("b");
    const without = scaffold("a");

    expect(withFacts.status === "done" && withFacts.text).toContain(
      `  - build it: make\n  - check it: recognizer plugin check bin/${PROGRAM}`,
    );
    expect(without.status === "done" && without.text).not.toContain("build it");
    expect(without.status === "done" && without.text).toContain(
      `recognizer plugin check ./${PROGRAM}`,
    );
  });
});
