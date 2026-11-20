import { afterAll } from "vitest";
import { removeTempDirs } from "./temp-dirs.mjs";

afterAll(removeTempDirs);
