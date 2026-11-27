import { afterAll, inject } from "vitest";

const original = process.env.TMPDIR;

process.env.TMPDIR = inject("serviceScratch");

afterAll(() => {
  if (original === undefined) {
    delete process.env.TMPDIR;
  } else {
    process.env.TMPDIR = original;
  }
});
