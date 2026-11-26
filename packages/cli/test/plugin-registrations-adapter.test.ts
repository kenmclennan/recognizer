import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PluginRegistrationsAdapter } from "../src/adapters/filesystem/plugin-registrations-adapter.js";
import { registrationCases } from "./plugin-registrations-cases.js";
import { realSubject } from "./plugin-registrations-subject.js";

const real = () => realSubject((io) => new PluginRegistrationsAdapter(io));

registrationCases("PluginRegistrationsAdapter", real);

describe("PluginRegistrationsAdapter writes", () => {
  it("register writes the file and leaves no temp file behind", () => {
    const subject = real();

    subject.registrations.register({
      kind: "sensor",
      name: "crap",
      command: ["/bin/crap"],
      manifest: ["/bin/crap", "manifest"],
      source: "user",
    });

    expect(readdirSync(subject.folders.user)).toEqual(["sensor-crap.json"]);
    expect(subject.registrations.entries().plugins[0]?.manifest).toEqual([
      "/bin/crap",
      "manifest",
    ]);
  });
});
