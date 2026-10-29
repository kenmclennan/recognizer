import { describe, expect, it } from "vitest";
import {
  loadShowPrivate,
  SHOW_PRIVATE_KEY,
  saveShowPrivate,
} from "./show-private";

const storageOf = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));

  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
};

describe("show private preference", () => {
  it("reads off for a missing key", () => {
    expect(loadShowPrivate(storageOf())).toBe(false);
  });

  it("reads off for a thrown read", () => {
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
    };

    expect(loadShowPrivate(throwing)).toBe(false);
  });

  it("reads off for false and for any other text", () => {
    expect(loadShowPrivate(storageOf({ [SHOW_PRIVATE_KEY]: "false" }))).toBe(
      false,
    );
    expect(loadShowPrivate(storageOf({ [SHOW_PRIVATE_KEY]: "1" }))).toBe(false);
  });

  it("reads on only for the exact text true", () => {
    expect(loadShowPrivate(storageOf({ [SHOW_PRIVATE_KEY]: "true" }))).toBe(
      true,
    );
  });

  it("round-trips both states under the key", () => {
    const storage = storageOf();

    saveShowPrivate(storage, true);
    expect(storage.getItem("recognizer.show-private")).toBe("true");
    expect(loadShowPrivate(storage)).toBe(true);

    saveShowPrivate(storage, false);
    expect(loadShowPrivate(storage)).toBe(false);
  });

  it("does not throw when the write is refused", () => {
    const throwing = {
      setItem: () => {
        throw new Error("full");
      },
    };

    expect(() => saveShowPrivate(throwing, true)).not.toThrow();
  });
});
