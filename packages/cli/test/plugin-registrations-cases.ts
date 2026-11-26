import {
  type PluginRegistrations,
  type RegistrationSource,
  serializeRegistration,
} from "@recognizer/core";
import { describe, expect, it } from "vitest";

export interface RegistrationsSubject {
  registrations: PluginRegistrations;
  place(
    source: RegistrationSource,
    fileName: string,
    text: string,
    modified: number,
  ): void;
  present(source: RegistrationSource, fileName: string): boolean;
}

export function registrationText(
  kind: "scanner" | "sensor" | "describer",
  name: string,
  program = `/bin/${name}`,
): string {
  return serializeRegistration({
    kind,
    name,
    command: [program],
    manifest: [program, "manifest"],
  });
}

export function registrationCases(
  title: string,
  make: () => RegistrationsSubject,
): void {
  describe(title, () => {
    it("user file outranks homebrew file", () => {
      const subject = make();

      subject.place(
        "homebrew",
        "sensor-crap.json",
        registrationText("sensor", "crap", "/brew/crap"),
        10,
      );
      subject.place(
        "user",
        "sensor-crap.json",
        registrationText("sensor", "crap", "/dev/crap"),
        5,
      );

      expect(subject.present("homebrew", "sensor-crap.json")).toBe(true);
      expect(subject.present("user", "sensor-crap.json")).toBe(true);

      const entries = subject.registrations.entries();

      expect(entries.plugins.map((plugin) => plugin.command)).toEqual([
        ["/dev/crap"],
      ]);
      expect(entries.plugins[0]?.source).toBe("user");
      expect(entries.shadowed.map((plugin) => plugin.source)).toEqual([
        "homebrew",
      ]);
    });

    it("newest describer wins across folders", () => {
      const subject = make();

      subject.place(
        "user",
        "describer-old.json",
        registrationText("describer", "old"),
        10,
      );
      subject.place(
        "homebrew",
        "describer-new.json",
        registrationText("describer", "new"),
        20,
      );
      subject.place(
        "homebrew",
        "scanner-python.json",
        registrationText("scanner", "python"),
        1,
      );

      expect(subject.present("user", "describer-old.json")).toBe(true);
      expect(subject.present("homebrew", "describer-new.json")).toBe(true);

      const entries = subject.registrations.entries();

      expect(entries.describer?.name).toBe("new");
      expect(entries.plugins.map((plugin) => plugin.name)).toEqual([
        "new",
        "python",
      ]);
      expect(entries.shadowed.map((plugin) => plugin.name)).toEqual(["old"]);
    });

    it("a tie goes to the user file", () => {
      const subject = make();

      subject.place(
        "homebrew",
        "describer-brew.json",
        registrationText("describer", "brew"),
        10,
      );
      subject.place(
        "user",
        "describer-mine.json",
        registrationText("describer", "mine"),
        10,
      );

      expect(subject.present("homebrew", "describer-brew.json")).toBe(true);
      expect(subject.present("user", "describer-mine.json")).toBe(true);
      expect(subject.registrations.entries().describer?.name).toBe("mine");
    });

    it("unreadable files are reported and skipped while others load", () => {
      const subject = make();

      subject.place(
        "user",
        "sensor-good.json",
        registrationText("sensor", "good"),
        1,
      );
      subject.place("user", "sensor-bad.json", "{not json", 1);
      subject.place(
        "user",
        "sensor-versioned.json",
        registrationText("sensor", "versioned").replace(
          '"registration_version": 1',
          '"registration_version": 2',
        ),
        1,
      );
      subject.place(
        "homebrew",
        "sensor-other.json",
        registrationText("sensor", "mismatch"),
        1,
      );
      subject.place(
        "homebrew",
        "sensor-empty.json",
        registrationText("sensor", "empty").replace(
          /"command": \[[^\]]*\]/,
          '"command": []',
        ),
        1,
      );

      for (const file of ["sensor-good.json", "sensor-bad.json"]) {
        expect(subject.present("user", file)).toBe(true);
      }

      const entries = subject.registrations.entries();

      expect(entries.plugins.map((plugin) => plugin.name)).toEqual(["good"]);
      expect(entries.unreadable).toHaveLength(4);
      expect(entries.unreadable.every((item) => item.reason.length > 0)).toBe(
        true,
      );
    });

    it("a missing folder is an empty registry", () => {
      const entries = make().registrations.entries();

      expect(entries).toEqual({
        plugins: [],
        shadowed: [],
        unreadable: [],
        describer: null,
      });
    });

    it("re-registering a describer makes it the newest", () => {
      const subject = make();

      subject.place(
        "user",
        "describer-first.json",
        registrationText("describer", "first"),
        1_000_000,
      );

      const outcome = subject.registrations.register({
        kind: "describer",
        name: "second",
        command: ["/bin/second"],
        manifest: ["/bin/second", "manifest"],
        source: "user",
      });

      expect(outcome.status).toBe("registered");
      expect(subject.present("user", "describer-second.json")).toBe(true);
      expect(subject.present("user", "describer-first.json")).toBe(true);
      expect(subject.registrations.entries().describer?.name).toBe("second");

      subject.registrations.register({
        kind: "describer",
        name: "first",
        command: ["/bin/first"],
        manifest: ["/bin/first", "manifest"],
        source: "user",
      });

      expect(subject.registrations.entries().describer?.name).toBe("first");
    });

    it("unregister removes only the user file", () => {
      const subject = make();

      subject.place(
        "user",
        "sensor-crap.json",
        registrationText("sensor", "crap"),
        1,
      );
      subject.place(
        "homebrew",
        "sensor-crap.json",
        registrationText("sensor", "crap"),
        1,
      );
      subject.place(
        "homebrew",
        "scanner-python.json",
        registrationText("scanner", "python"),
        1,
      );

      expect(subject.registrations.unregister("crap", undefined)).toEqual({
        status: "removed",
        kind: "sensor",
      });
      expect(subject.present("user", "sensor-crap.json")).toBe(false);
      expect(subject.present("homebrew", "sensor-crap.json")).toBe(true);
      expect(subject.registrations.unregister("python", undefined)).toEqual({
        status: "homebrew-only",
        kind: "scanner",
      });
      expect(subject.present("homebrew", "scanner-python.json")).toBe(true);
      expect(subject.registrations.unregister("nothing", undefined)).toEqual({
        status: "not-registered",
      });
    });

    it("unregister of a name in two kinds is ambiguous until a kind is given", () => {
      const subject = make();

      subject.place(
        "user",
        "sensor-twin.json",
        registrationText("sensor", "twin"),
        1,
      );
      subject.place(
        "user",
        "scanner-twin.json",
        registrationText("scanner", "twin"),
        1,
      );

      expect(subject.registrations.unregister("twin", undefined)).toEqual({
        status: "ambiguous",
        kinds: ["scanner", "sensor"],
      });
      expect(subject.present("user", "sensor-twin.json")).toBe(true);
      expect(subject.present("user", "scanner-twin.json")).toBe(true);
      expect(subject.registrations.unregister("twin", "sensor")).toEqual({
        status: "removed",
        kind: "sensor",
      });
      expect(subject.present("user", "scanner-twin.json")).toBe(true);
    });
  });
}
