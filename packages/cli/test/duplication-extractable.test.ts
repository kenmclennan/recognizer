import {
  DEFAULT_DUPLICATION_SETTINGS,
  findFunctions,
  MODULE_MATCH_SHARE,
  MODULE_MIN_FUNCTIONS,
  measureDuplication,
} from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { analysisPortsOf, sayOf } from "./analysis-ports.js";
import {
  allParsers,
  GRAMMAR_RULES,
  measuredFixture,
  ROOT,
  ruleNamed,
} from "./duplication-helpers.js";

async function measure(directory: string) {
  const { fake, scans } = measuredFixture(
    `fixtures/duplication/extractable/${directory}`,
  );
  const parsers = await allParsers();
  const findings = measureDuplication(
    analysisPortsOf(fake.io),
    sayOf(fake.io),
    ROOT,
    scans,
    DEFAULT_DUPLICATION_SETTINGS,
    parsers,
    GRAMMAR_RULES,
  );

  return { findings, fake, parsers };
}

function functionsIn(
  parsers: Awaited<ReturnType<typeof allParsers>>,
  source: string,
): string[] {
  const tree = parsers.get("kotlin")?.parse(source);

  return findFunctions(tree?.rootNode as never, ruleNamed("kotlin")).map(
    (one) => one.qualified,
  );
}

const ids = (findings: { id: string }[]) => findings.map((f) => f.id);

describe("what the duplication check compares", () => {
  it("has the file rule constants the spec states", () => {
    expect(MODULE_MIN_FUNCTIONS).toBe(2);
    expect(MODULE_MATCH_SHARE).toBe(0.75);
  });

  it("bodiless declarations are not compared", async () => {
    const { findings, fake, parsers } = await measure("ports");

    expect(
      functionsIn(parsers, fake.files.get(`${ROOT}/Ports.kt`) as string),
    ).toEqual([
      "ProvisioningEventDispatcher.dispatch",
      "GetGroupPort.execute",
      "GetUserPort.execute",
    ]);
    expect(findings).toEqual([]);
  });

  it("endpoints that differ in annotated parameters and delegate to different helpers give no finding", async () => {
    const { findings, fake, parsers } = await measure("endpoints");
    const source = fake.files.get(`${ROOT}/Endpoints.kt`) as string;

    expect(source).toContain("fun members(");
    expect(source).toContain("fun owners(");
    expect(functionsIn(parsers, source)).toEqual([
      "GroupController.members",
      "GroupController.owners",
    ]);
    expect(findings).toEqual([]);
  });

  it("two near-copy classes give one file finding", async () => {
    const { findings } = await measure("copies");

    expect(ids(findings)).toEqual([
      "duplication:modules:GetGroupMembersUseCase.kt|GetGroupUsersUseCase.kt",
    ]);
    expect(findings[0]?.files).toEqual([
      "GetGroupMembersUseCase.kt",
      "GetGroupUsersUseCase.kt",
    ]);
    expect(findings[0]?.summary).toContain(
      "GetGroupMembersUseCase.execute in GetGroupMembersUseCase.kt ~ GetGroupUsersUseCase.execute in GetGroupUsersUseCase.kt",
    );
    expect(findings[0]?.summary).toContain(
      "GetGroupMembersUseCase.count in GetGroupMembersUseCase.kt ~ GetGroupUsersUseCase.count in GetGroupUsersUseCase.kt",
    );
  });

  it("a file pair exactly at the share qualifies", async () => {
    const { findings } = await measure("bounds/three-of-four");

    expect(ids(findings)).toEqual(["duplication:modules:a.py|b.py"]);
  });

  it("a file pair under the share does not", async () => {
    const { findings } = await measure("bounds/two-of-three");

    expect(findings).toHaveLength(2);
    expect(
      ids(findings).every((id) => !id.startsWith("duplication:modules:")),
    ).toBe(true);
  });

  it("a copy in a component's non-qualifying pair is absorbed", async () => {
    const { findings } = await measure("bounds/component");

    expect(ids(findings)).toEqual(["duplication:modules:a.py|b.py#3"]);
    expect(findings[0]?.files).toEqual(["a.py", "b.py", "c.py"]);
  });

  it("a single copied function is a plain pair", async () => {
    const { findings } = await measure("genuine");

    expect(ids(findings)).toEqual([
      "duplication:a.py::order_total|b.py::order_total",
    ]);
  });
});
