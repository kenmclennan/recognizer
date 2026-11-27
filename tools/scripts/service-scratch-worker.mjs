import { inject } from "vitest";

process.env.TMPDIR = inject("serviceScratch");
