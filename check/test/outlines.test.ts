import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyse } from "../src/analyse.js";
import { check, parsePolicy, validateScan } from "../src/index.js";
import { REPO } from "./helpers.js";

const POLICY = `
levels: [domain, ports, application, adapters]
components:
  domain: shop/domain/**
  ports: shop/ports/**
  application: shop/application/**
  adapters: shop/adapters/**
`;

function expectedScan(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(REPO, "fixtures/python/expected-scan.json"), "utf8"),
  );
}

function stripped(): Record<string, unknown> {
  const scan = expectedScan() as {
    modules: { members: Record<string, unknown>[] }[];
    calls?: unknown;
  };

  delete scan.calls;

  for (const module of scan.modules) {
    module.members = module.members.map((member) => ({
      name: member.name,
      kind: member.kind,
      line: member.line,
      exported: member.exported,
    }));
  }

  return scan;
}

describe("outlines and calls", () => {
  it("accepts a scan with outlines and calls and the same scan without them", () => {
    const full = expectedScan() as { calls: unknown[] };

    expect(full.calls.length).toBeGreaterThan(0);
    expect(() => validateScan(full)).not.toThrow();
    expect(() => validateScan(stripped())).not.toThrow();
  });

  it("reports identically with and without them, private members included", () => {
    const policy = parsePolicy(POLICY);
    const full = expectedScan();
    const bare = stripped();
    const privateMembers = (
      full as { modules: { members: { exported: boolean }[] }[] }
    ).modules.flatMap((m) => m.members.filter((x) => !x.exported));

    expect(privateMembers.length).toBeGreaterThan(0);
    expect(check(full, policy, null)).toEqual(check(bare, policy, null));
    expect(analyse(validateScan(full), { hub: 3 })).toEqual(
      analyse(validateScan(bare), { hub: 3 }),
    );
  });
});
