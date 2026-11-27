import { describe, expect, it } from "vitest";
import {
  type PolicyFacts,
  PolicyRule,
  readPolicyArea,
} from "../../src/index.js";
import { scanOfFiles } from "../configuration/world.js";
import { FakeRepositoryChecks } from "../fakes/fake-repository-checks.js";

const ROOT = "/repo";
const POLICY_FILE = ".recognizer/policy.yaml";

function entry(glob: string): PolicyRule {
  return PolicyRule.of({ type: "entry", glob });
}

function rules(...list: PolicyRule[]): PolicyFacts {
  return { kind: "read", keys: [], parsed: { ok: true, rules: list } };
}

function area(
  facts: PolicyFacts,
  options: { named?: boolean; languages?: string[] } = {},
) {
  const repository = new FakeRepositoryChecks();

  repository.policyFactsValue = facts;

  return {
    repository,
    read: () =>
      readPolicyArea(
        repository,
        ROOT,
        options.named ?? false,
        options.languages ?? ["typescript"],
      ),
  };
}

describe("readPolicyArea", () => {
  it("reports nothing and reads no scan when there is no policy", () => {
    const { repository, read } = area({ kind: "absent" });

    expect(read()).toEqual([]);
    expect(repository.scansReads).toBe(0);
  });

  it("reports retired keys with the migrate fix", () => {
    const { read } = area({
      kind: "read",
      keys: ["levels", "entry", "uses"],
      parsed: { ok: false, messages: [] },
    });

    expect(read()).toEqual([
      {
        code: "policy-retired",
        subject: POLICY_FILE,
        line: "the policy uses retired keys: levels, uses",
        fix: {
          text: "recognizer policy --migrate",
          command: "recognizer policy --migrate",
        },
      },
    ]);
  });

  it("names the repository in the migrate command when named", () => {
    const { read } = area(
      {
        kind: "read",
        keys: ["levels"],
        parsed: { ok: false, messages: [] },
      },
      { named: true },
    );

    expect(read()[0]?.fix.command).toBe(
      "recognizer policy --migrate --repository /repo",
    );
  });

  it("reports one policy-invalid per message and drops the retired-key line", () => {
    const { repository, read } = area({
      kind: "read",
      keys: ["levels"],
      parsed: {
        ok: false,
        messages: [
          'policy: "levels" is retired; run recognizer doctor for the migration',
          "policy/entry must be an array",
          "policy/forbid must be an array",
        ],
      },
    });
    const found = read();

    expect(found.map((one) => [one.code, one.line])).toEqual([
      ["policy-retired", "the policy uses retired keys: levels"],
      ["policy-invalid", "policy/entry must be an array"],
      ["policy-invalid", "policy/forbid must be an array"],
    ]);
    expect(found[1]?.subject).toBe(POLICY_FILE);
    expect(found[1]?.fix.command).toBeNull();
    expect(repository.scansReads).toBe(0);
  });

  it("reports nothing for an empty policy and reads no scan", () => {
    const { repository, read } = area(
      rules(PolicyRule.of({ type: "ignore", glob: "x/**" })),
    );

    expect(read()).toEqual([]);
    expect(repository.scansReads).toBe(0);
  });

  it("reports nothing for a language-less repository and reads no scan", () => {
    const { repository, read } = area(rules(entry("src/**")), {
      languages: [],
    });

    expect(read()).toEqual([]);
    expect(repository.scansReads).toBe(0);
  });

  it("reports a missing scan with the plain and the named scan command", () => {
    const plain = area(rules(entry("src/**")), {
      languages: ["typescript", "python"],
    });
    const named = area(rules(entry("src/**")), { named: true });

    expect(plain.read()).toEqual([
      {
        code: "scan-missing",
        subject: "typescript, python",
        line: "no scan of typescript, python: the policy was not compared with the code",
        fix: { text: "recognizer scan", command: "recognizer scan" },
      },
    ]);
    expect(plain.repository.scansReads).toBe(1);
    expect(named.read()[0]?.fix.command).toBe("recognizer scan /repo");
  });

  describe("uncommitted changes", () => {
    function stale(paths: string[], named = false) {
      const { repository, read } = area(rules(entry("src/**")), { named });

      repository.scansStateValue = {
        state: "stale",
        reason: "uncommitted",
        paths,
      };

      return read()[0];
    }

    it("says one uncommitted change in the singular", () => {
      expect(stale(["a.ts"])?.line).toBe(
        "the scan of typescript was not used: the working tree has 1 uncommitted change outside .recognizer/ (a.ts), so the policy was not compared with the code",
      );
    });

    it("shows exactly three paths with no suffix", () => {
      expect(stale(["a.ts", "b.ts", "c.ts"])?.line).toBe(
        "the scan of typescript was not used: the working tree has 3 uncommitted changes outside .recognizer/ (a.ts, b.ts, c.ts), so the policy was not compared with the code",
      );
    });

    it("says and 1 more at four paths", () => {
      expect(stale(["a.ts", "b.ts", "c.ts", "d.ts"])?.line).toContain(
        "(a.ts, b.ts, c.ts and 1 more)",
      );
    });

    it("says and 2 more at five paths and gives a text fix", () => {
      const found = stale(["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"], true);

      expect(found?.line).toContain("(a.ts, b.ts, c.ts and 2 more)");
      expect(found?.code).toBe("scan-stale");
      expect(found?.fix).toEqual({
        text: "commit, ignore or stash these changes, then run recognizer scan /repo",
        command: null,
      });
    });
  });

  it("reports an out-of-date scan with the scan command", () => {
    const { read, repository } = area(rules(entry("src/**")));

    repository.scansStateValue = { state: "stale", reason: "scan" };

    expect(read()).toEqual([
      {
        code: "scan-stale",
        subject: "typescript",
        line: "the scan of typescript is out of date with the working tree: the policy was not compared with the code",
        fix: { text: "recognizer scan", command: "recognizer scan" },
      },
    ]);
  });

  describe("against a current scan", () => {
    function current(list: PolicyRule[], named: boolean) {
      const { read, repository } = area(rules(...list), { named });

      repository.scansStateValue = {
        state: "current",
        repository: scanOfFiles(["src/a.ts"]),
      };

      return read();
    }

    it("reports an entry glob matching no file with an unset command", () => {
      expect(current([entry("src/**"), entry("lib/**")], false)).toEqual([
        {
          code: "policy-entry",
          subject: "lib/**",
          line: "policy entry lib/** matches no scanned file",
          fix: {
            text: "recognizer policy --unset entry 'lib/**'",
            command: "recognizer policy --unset entry 'lib/**'",
          },
        },
      ]);
    });

    it("names the repository in the unset command when named", () => {
      expect(current([entry("lib/**")], true)[0]?.fix.command).toBe(
        "recognizer policy --unset entry 'lib/**' --repository /repo",
      );
    });

    it("reports a forbid glob matching no file with a text fix", () => {
      const found = current(
        [
          PolicyRule.of({
            type: "forbid",
            pattern: "no-lib",
            from: ["src/**"],
            to: ["lib/**"],
          }),
        ],
        false,
      );

      expect(found).toEqual([
        {
          code: "policy-forbid",
          subject: "lib/**",
          line: "policy forbid no-lib: lib/** matches no scanned file",
          fix: {
            text: "correct the glob lib/** in .recognizer/policy.yaml, or remove it from its forbid rule",
            command: null,
          },
        },
      ]);
    });

    it("reports nothing when every glob matches", () => {
      expect(current([entry("src/**")], false)).toEqual([]);
    });
  });
});
