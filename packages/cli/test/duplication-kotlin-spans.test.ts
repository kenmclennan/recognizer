import {
  comparedSpan,
  DEFAULT_DUPLICATION_SETTINGS,
  findFunctions,
  findingsForUnits,
  unitsInSource,
  withIdentities,
} from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { DigestAdapter } from "../src/adapters/system/digest-adapter.js";
import { allParsers } from "./duplication-helpers.js";

const SETTINGS = DEFAULT_DUPLICATION_SETTINGS;

async function unitsOf(source: string, settings = SETTINGS) {
  const parsers = await allParsers();

  return withIdentities(
    unitsInSource(
      "m",
      "m.kt",
      source,
      "kotlin",
      parsers,
      settings,
      new DigestAdapter().sha1Prefix,
    ),
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

const TRIO = `class C {
    fun cached(key: String): String {
        return synchronized(lock) {
            val hit = cache[key]
            if (hit != null) {
                return hit
            }
            val made = build(key)
            cache[key] = made
            made
        }
    }

    fun drained(): Int {
        return synchronized(lock) {
            var total = 0
            while (queue.isNotEmpty()) {
                val next = queue.removeFirst()
                total += next.weight()
                log(next)
            }
            total
        }
    }

    fun ordered(): List<Int> {
        return synchronized(lock) {
            val copy = items.toMutableList()
            copy.sortBy { it.rank }
            copy.reverse()
            copy.map { it.id }
        }
    }
}
`;

const INNER = `            val first = compute(a)
            val second = compute(b)
            val sum = first + second
            val scaled = sum * 2
            record(scaled)
            scaled`;

function wrap(statements: string) {
  return `class P {\n    fun f(a: Int, b: Int): Int {\n        ${statements}\n    }\n}\n`;
}

async function spanOf(source: string) {
  const parsers = await allParsers();
  const tree = parsers.get("kotlin")?.parse(source);
  const found = findFunctions(tree?.rootNode as never, "kotlin")[0];

  return comparedSpan(found?.node as never, "kotlin") as NonNullable<
    ReturnType<typeof comparedSpan>
  >;
}

function copied(lock: string) {
  return `    fun f${lock}(a: Int, b: Int) = synchronized(${lock}) {
        val first = compute(a)
        val second = compute(b)
        val sum = first + second
        val scaled = sum * 2
        record(scaled)
        scaled
    }
`;
}

describe("Kotlin line floors measure the compared span", () => {
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

  it("two functions sharing only synchronized around unrelated bodies give no finding", async () => {
    expect(await functionCount(TRIO)).toBe(3);
    expect(await summaries(TRIO)).toEqual([]);
  });

  it("two copied bodies inside the same wrapper still give a finding", async () => {
    const source =
      `class D {\n${copied("lockA").replace("fflockA", "a")}\n${copied("lockB")}}\n`
        .replace("flockA", "a")
        .replace("flockB", "b");

    expect(await summaries(source)).toEqual([
      "D.a in m is 100% similar to D.b in m",
    ]);
  });

  it("unwrapping applies through a member call, a return and a nested wrapper", async () => {
    const forms = [
      "return lock.withLock {\n${inner}\n        }",
      "return synchronized(lock) {\n${inner}\n        }",
      "return@f synchronized(a) {\n            runCatching {\n${inner}\n            }\n        }",
      "return stream.use { s ->\n${inner}\n        }",
    ];

    for (const form of forms) {
      const span = await spanOf(wrap(form.replace("${inner}", INNER)));

      expect(span.node.type).toBe("statements");
      expect(span.node.text).toBe(INNER.trim());
      expect(span.lines).toBe(6);
    }
  });

  it("a call chain after the scope call and a multi-statement body are not unwrapped", async () => {
    const chained = `return runCatching {\n${INNER}\n        }.getOrNull()`;
    const several = `log(a)\n        return synchronized(lock) {\n${INNER}\n        }`;
    const outside = `return transaction {\n${INNER}\n        }`;

    for (const form of [chained, several, outside]) {
      const span = await spanOf(wrap(form));

      expect(span.node.type).toBe("function_body");
    }
  });

  it("a wrapper whose lambda is below the floor produces no unit", async () => {
    const source = `class W {
    fun bump(): Int {
        return synchronized(lock) {
            counter++
        }
    }
}
`;

    expect(await functionCount(source)).toBe(1);
    expect(await unitsOf(source)).toEqual([]);
  });

  it("a wrapped member keeps its whole-function lines in the evidence", async () => {
    const plain = `    fun fplain(a: Int, b: Int): Int {
        val first = compute(a)
        val second = compute(b)
        val sum = first + second
        val scaled = sum * 2
        record(scaled)
        scaled
    }
`;
    const source = `class D {\n${copied("lockA").replace("flockA", "a")}\n${plain.replace("fplain", "b")}}\n`;
    const findings = findingsForUnits(await unitsOf(source), SETTINGS);

    expect(findings.length).toBe(1);

    const members = findings[0]?.members ?? [];
    const spans = members.map(
      (m) =>
        (m.lines as [number, number])[1] - (m.lines as [number, number])[0] + 1,
    );

    expect(spans.sort()).toEqual([8, 8]);
  });

  describe("expression bodies", () => {
    const OBJECT_BODY = `    fun headers(): Headers = object : Headers {
        override fun get(name: String): String? = values[name]
        override fun names(): Set<String> = values.keys
        override fun all(): Map<String, List<String>> = values
        override fun isEmpty(): Boolean = values.isEmpty()
        override fun getAll(name: String): List<String>? = values[name]
    }
`;
    const LAMBDA_BODY = `    fun resolver(): suspend (String) -> List<String> = { hostname ->
        withContext(dispatcher) {
            val found = resolve(hostname)
            log(found)
            audit(found)
            found.map { it.toString() }
        }
    }
`;

    it("two unrelated expression bodies, an object and a lambda, give no finding", async () => {
      const source = `class E {\n${OBJECT_BODY}\n${LAMBDA_BODY}}\n`;

      expect(await functionCount(source)).toBeGreaterThanOrEqual(2);
      expect(await summaries(source)).toEqual([]);
    });

    it("two copied object expression bodies still give a finding", async () => {
      const source = `class E {\n${OBJECT_BODY}\n${OBJECT_BODY.replace("fun headers", "fun headers2")}}\n`;

      expect(await summaries(source)).toHaveLength(1);
    });

    it("two copied lambda expression bodies still give a finding", async () => {
      const source = `class E {\n${LAMBDA_BODY}\n${LAMBDA_BODY.replace("fun resolver", "fun resolver2")}}\n`;

      expect(await summaries(source)).toHaveLength(1);
    });
  });
});
