import { readFileSync } from "node:fs";
import { join } from "node:path";
import { longFunctionWarnings } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { REPO } from "./helpers.js";
import { validatedRepository as validateScan } from "./repository-from.js";

const scan = validateScan(
  JSON.parse(
    readFileSync(join(REPO, "fixtures/csharp/expected-scan.json"), "utf8"),
  ),
);

const PLACE =
  "long_function:src/Shop.Application/OrderService.cs::OrderService.Place";

describe("long_function over a committed scan", () => {
  it("measures the body of a method whose braces sit on their own lines", () => {
    const at = (limit: number) =>
      longFunctionWarnings(scan, null, limit).find(
        (record) => record.id === PLACE,
      );

    expect(at(5)).toBeUndefined();
    expect(at(3)?.summary).toBe(
      "OrderService.Place has a 4-line body, over the limit of 3",
    );
  });
});
