import assert from "node:assert/strict";
import {
  classify,
  doLoop,
  ifElse,
  logic,
  loops,
  mixed,
  nested,
  oneIf,
  optional,
  sprawl,
  straight,
  switchy,
} from "../../typescript/risk.ts";

assert.equal(straight(1), 2);
assert.equal(oneIf(true), 1);
assert.equal(oneIf(false), 0);
assert.equal(ifElse(1), "one");
assert.equal(ifElse(3), "many");
assert.equal(loops([1, 2], [3], 2), 6);
assert.notEqual(doLoop(2, "1"), undefined);
assert.equal(typeof switchy(2, { a: 1 }, true), "string");
assert.notEqual(optional({ b: { c: 1 } }, 2, 1), undefined);
assert.notEqual(logic(true, true, false, null, 5), undefined);
assert.equal(typeof mixed(true, false, false, [1], "1"), "number");
assert.equal(typeof nested([[1], []], {}, 1, "1"), "number");
assert.equal(typeof classify(5, false, false, false, false, ["x"]), "string");
assert.equal(typeof sprawl(5, true, true, true, [1], "1"), "number");
