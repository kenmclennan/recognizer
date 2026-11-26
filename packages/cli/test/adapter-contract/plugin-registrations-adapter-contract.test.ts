import { FakePluginRegistrations } from "../../../core/test/fakes/fake-plugin-registrations.js";
import { PluginRegistrationsAdapter } from "../../src/adapters/filesystem/plugin-registrations-adapter.js";
import { registrationCases } from "../plugin-registrations-cases.js";
import { realSubject } from "../plugin-registrations-subject.js";

registrationCases("PluginRegistrations contract (fake)", () => {
  const fake = new FakePluginRegistrations();

  return {
    registrations: fake,
    place: (source, fileName, text, modified) =>
      fake.place(source, fileName, text, modified),
    present: (source, fileName) =>
      fake.files.some(
        (held) => held.source === source && held.fileName === fileName,
      ),
  };
});

registrationCases("PluginRegistrations contract (real adapter)", () =>
  realSubject((io) => new PluginRegistrationsAdapter(io)),
);
