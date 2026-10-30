import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { promptVersion } from "../src/prompt.js";
import { REPO, REQUEST, sandbox, writeRequest } from "./helpers.js";

const config = parse(
  readFileSync(join(REPO, ".recognizer/config.yaml"), "utf8"),
) as { describer: { command: string[]; version: string } };

describe("the committed registration", () => {
  it("validates against the config schema", () => {
    const schema = JSON.parse(
      readFileSync(join(REPO, "schema/config.schema.json"), "utf8"),
    );
    const validate = new Ajv2020({ allErrors: true }).compile(schema);

    expect(validate(config), JSON.stringify(validate.errors)).toBe(true);
  });

  it("runs the built describer", () => {
    expect(config.describer.command).toEqual([
      "node",
      "{repository}/describers/claude/dist/bin.js",
      "{request}",
    ]);
  });

  it("names the current prompt version", () => {
    expect(
      config.describer.version,
      "update .recognizer/config.yaml to the output of recognizer-describe-claude --prompt-version",
    ).toBe(promptVersion());
  });

  it("runs end to end against the fake claude", () => {
    const box = sandbox();
    const scan = JSON.parse(
      readFileSync(join(REPO, "fixtures/python/expected-scan.json"), "utf8"),
    ) as { modules: { id: string; kind: string; members: unknown[] }[] };
    const module = scan.modules.find((m) => m.id === "shop/domain/order.py");
    const request = writeRequest(box, {
      ...REQUEST,
      module: "shop/domain/order.py",
      kind: module?.kind,
      members: module?.members,
      source: readFileSync(
        join(REPO, "fixtures/python/sample/shop/domain/order.py"),
        "utf8",
      ),
    });
    const [program, ...args] = config.describer.command.map((item) =>
      item.replace("{repository}", REPO).replace("{request}", request),
    );
    const result = spawnSync(program as string, args, {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${box.bin}:${process.env.PATH}`,
        FAKE_CLAUDE_RECORD: box.record,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("Handles orders.\n");
  });
});
