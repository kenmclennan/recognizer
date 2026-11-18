import { describe, expect, it } from "vitest";
import {
  appliesJacoco,
  DEFAULT_JACOCO_REPORT,
  jacocoReportOf,
} from "../src/gradle-build.js";

describe("gradle build matcher", () => {
  it.each([
    ["a multi-line plugins block", `plugins {\n    id("jacoco")\n}\n`, true],
    ["a one-line plugins block", `plugins { id("jacoco") }\n`, true],
    ["the Groovy spelling", `plugins {\n    id 'jacoco'\n}\n`, true],
    ["a bare jacoco line", `plugins {\n    jacoco\n}\n`, true],
    ["a versioned id", `plugins {\n    id("jacoco") version "1"\n}\n`, true],
    ["apply plugin at the top", `apply plugin: 'jacoco'\n`, true],
    ["apply with a named argument", `apply(plugin = "jacoco")\n`, true],
    [
      "apply only inside subprojects",
      `subprojects {\n    apply plugin: 'jacoco'\n}\n`,
      false,
    ],
    ["a line comment", `plugins {\n    // id("jacoco")\n}\n`, false],
    ["a block comment", `/* apply plugin: 'jacoco' */\n`, false],
    ["configuration only", `jacoco {\n    toolVersion = "0.8.11"\n}\n`, false],
    ["a build with no jacoco", `plugins {\n    kotlin("jvm")\n}\n`, false],
  ])("%s", (_name, text, expected) => {
    expect(appliesJacoco(text)).toBe(expected);
  });

  it.each([
    [
      "Groovy assignment",
      `xml.outputLocation = layout.buildDirectory.file('coverage/jacoco.xml')`,
      { kind: "literal", path: "build/coverage/jacoco.xml" },
    ],
    [
      "Kotlin set",
      `xml.outputLocation.set(layout.buildDirectory.file("coverage/j.xml"))`,
      { kind: "literal", path: "build/coverage/j.xml" },
    ],
    ["nothing set", `plugins { jacoco }`, { kind: "default" }],
    [
      "a variable path",
      `xml.outputLocation = file("$buildDir/x.xml")`,
      { kind: "unreadable" },
    ],
    [
      "a parent segment",
      `xml.outputLocation = layout.buildDirectory.file('../x.xml')`,
      { kind: "unreadable" },
    ],
    [
      "a commented path",
      `// xml.outputLocation = file("x")\nplugins { jacoco }`,
      { kind: "default" },
    ],
  ])("report path: %s", (_name, text, expected) => {
    expect(jacocoReportOf(text)).toEqual(expected);
    expect(DEFAULT_JACOCO_REPORT).toContain("jacocoTestReport.xml");
  });
});
