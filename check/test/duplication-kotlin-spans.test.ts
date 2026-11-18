import { describe, expect, it } from "vitest";
import {
  DEFAULT_DUPLICATION_SETTINGS,
  findingsForUnits,
} from "../src/duplication/findings.js";
import { findFunctions } from "../src/duplication/functions.js";
import { unitsInSource, withIdentities } from "../src/duplication/measure.js";
import { allParsers } from "./duplication-helpers.js";

const SETTINGS = DEFAULT_DUPLICATION_SETTINGS;

async function unitsOf(source: string, settings = SETTINGS) {
  const parsers = await allParsers();

  return withIdentities(
    unitsInSource("m", "m.kt", source, "kotlin", parsers, settings),
  );
}

async function summaries(source: string) {
  return findingsForUnits(await unitsOf(source), SETTINGS).map(
    (finding) => finding.summary,
  );
}

async function functionCount(source: string) {
  const parsers = await allParsers();
  const tree = parsers.get("kotlin")?.parse(source);

  return findFunctions(tree?.rootNode as never, "kotlin").length;
}

function endpoint(name: string, role: string, annotation: string) {
  return `    @Get("/${name}")
    @${annotation}(summary = "Lists ${name}")
    @ApiResponse(responseCode = "200", description = "ok")
    fun ${name}(
        @Parameter(description = "the id") id: Long,
        @Parameter(description = "the page") page: Int,
        @Parameter(description = "the size") size: Int,
        @Parameter(description = "the sort") sort: String,
    ) = usersForClass(id, UserRole.${role}, page, size, sort)
`;
}

describe("Kotlin line floors measure the body", () => {
  it("endpoints with heavy annotations and one-line bodies give no finding", async () => {
    const source = `class E {\n${endpoint("a", "TEACHER", "Operation")}\n${endpoint("b", "STUDENT", "Tag")}}\n`;

    expect(await functionCount(source)).toBe(2);
    expect(await unitsOf(source)).toEqual([]);
    expect(await summaries(source)).toEqual([]);
  });

  it("identical annotations on distinct short bodies give no finding", async () => {
    const source = `class E {\n${endpoint("a", "TEACHER", "Operation")}\n${endpoint("b", "STUDENT", "Operation")}}\n`;

    expect(await functionCount(source)).toBe(2);
    expect(await summaries(source)).toEqual([]);
  });

  it("a body one line above the floor is compared and one on the floor is not", async () => {
    const body = (inner: number) =>
      `class B {
    fun f(a: Int): Int {
${Array.from({ length: inner }, (_, i) => `        val v${i} = compute(a, ${i}, a + ${i}, a * ${i})`).join("\n")}
    }
}
`;
    const loose = { ...SETTINGS, min_nodes: 1 };

    expect((await unitsOf(body(2), loose)).length).toBe(1);
    expect((await unitsOf(body(1), loose)).length).toBe(0);
  });
});
