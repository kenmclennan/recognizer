import assert from "node:assert/strict";
import { both, clamp, defaultEnabled, isAdult, pick, tiered, total } from "../src/shop.ts";

assert.equal(clamp(0, 1, 5), 1);
assert.equal(clamp(9, 1, 5), 5);
assert.equal(clamp(3, 1, 5), 3);
assert.equal(clamp(1, 1, 5), 1);
assert.equal(clamp(5, 1, 5), 5);

assert.equal(isAdult(30), true);
assert.equal(isAdult(5), false);

assert.equal(total(3, 4), 12);

assert.equal(both(true, true), true);
assert.equal(both(false, false), false);

assert.equal(pick(null, 5), 5);
assert.equal(pick(3, 5), 3);

defaultEnabled();

assert.equal(tiered(11, true), 22);
assert.equal(tiered(5, false), 6);
