import { describe, expect, it } from "vitest";
import {
  entryNameFor,
  isForbidList,
  isUnlistableName,
  type PublishedKeys,
  renderListItem,
  renderScalar,
} from "../../src/index.js";

function listEntry(name: string, identity: string, shape = "list-entry") {
  return {
    owner: "core",
    segments: [{ literal: name }],
    shape,
    identity,
    description: "",
  };
}

describe("isUnlistableName", () => {
  it("skips a dotted name", () => {
    expect(isUnlistableName("a.b")).toBe(true);
  });

  it("skips the empty name", () => {
    expect(isUnlistableName("")).toBe(true);
  });

  it("lists a plain name", () => {
    expect(isUnlistableName("a")).toBe(false);
  });
});

describe("isForbidList", () => {
  it("is true only for the policy forbid list", () => {
    expect(isForbidList("policy", ["forbid"])).toBe(true);
    expect(isForbidList("config", ["forbid"])).toBe(false);
    expect(isForbidList("policy", ["other"])).toBe(false);
    expect(isForbidList("policy", ["forbid", "x"])).toBe(false);
  });
});

describe("renderScalar", () => {
  it("renders strings, numbers and booleans as text", () => {
    expect(renderScalar("a")).toBe("a");
    expect(renderScalar(3)).toBe("3");
    expect(renderScalar(false)).toBe("false");
  });

  it("renders null and undefined as empty", () => {
    expect(renderScalar(null)).toBe("");
    expect(renderScalar(undefined)).toBe("");
  });
});

describe("renderListItem", () => {
  it("renders a scalar as its text", () => {
    expect(renderListItem({ kind: "scalar", value: 4 })).toBe("4");
  });

  it("renders a section as its JSON", () => {
    expect(renderListItem({ kind: "section", json: () => '{"a":1}' })).toBe(
      '{"a":1}',
    );
  });

  it("renders an empty item as null", () => {
    expect(renderListItem({ kind: "empty" })).toBe("null");
  });

  it("renders any other item as empty text", () => {
    expect(renderListItem({ kind: "other" })).toBe("");
  });
});

describe("entryNameFor", () => {
  const published = {
    keys: [],
    sections: [
      listEntry("first", "alpha"),
      { ...listEntry("second", "beta"), segments: [{ capture: "n" }] },
    ],
    notAnswering: null,
    subject: "config",
  } as unknown as PublishedKeys;

  it("returns an empty name when the identity text is empty", () => {
    expect(entryNameFor(published, ["x"], () => "")).toBe("");
  });

  it("returns an empty name when no published section matches", () => {
    const none = { ...published, sections: [] } as PublishedKeys;

    expect(entryNameFor(none, ["x"], () => "name")).toBe("");
  });

  it("returns an empty name when the section is not a list entry", () => {
    const map = {
      ...published,
      sections: [listEntry("first", "alpha", "map-entry")],
    } as unknown as PublishedKeys;

    expect(entryNameFor(map, ["x"], () => "name")).toBe("");
  });
});
