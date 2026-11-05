import { beforeAll, describe, expect, it } from "vitest";
import { collectFacts, webkit } from "./look-page";

const HARNESS = `
const box = document.createElement("div");
box.style.cssText = "width:200px;height:100px;overflow:auto";
const tall = document.createElement("div");
tall.style.cssText = "height:1000px;width:100%";
box.append(tall);
document.body.append(box);
const out = { clientWidth: box.clientWidth, offsetWidth: box.offsetWidth, overflowing: box.scrollHeight > box.clientHeight };
document.getElementById("out").textContent = btoa(JSON.stringify(out));
`;

type Facts = { clientWidth: number; offsetWidth: number; overflowing: boolean };

describe.skipIf(webkit === undefined)("the look page scrollbars", () => {
  let facts: Facts;

  beforeAll(async () => {
    facts = await collectFacts<Facts>(
      HARNESS,
      "scrollbar-look",
      "light",
      "bare",
    );
  });

  it("overflows the container", () => {
    expect(facts.overflowing).toBe(true);
  });

  it("leaves no scrollbar gutter", () => {
    expect(facts.clientWidth).toBe(facts.offsetWidth);
  });
});
