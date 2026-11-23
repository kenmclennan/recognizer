import type {
  PluginRegistry,
  Registered,
  RegisterOutcome,
  Registration,
} from "../../src/index.js";

export class FakePluginRegistry implements PluginRegistry {
  readonly state = new Map<string, Registered>();
  readonly writes: { root: string; registration: Registration }[] = [];

  registered(root: string): Registered {
    return this.state.get(root) ?? { sensors: {}, describerProgram: undefined };
  }

  register(root: string, registration: Registration): RegisterOutcome {
    const current = this.registered(root);
    const already =
      registration.kind === "sensor"
        ? current.sensors[registration.name] !== undefined
        : current.describerProgram === registration.program;

    if (!already) {
      this.writes.push({ root, registration });
      this.state.set(
        root,
        registration.kind === "sensor"
          ? {
              ...current,
              sensors: { ...current.sensors, [registration.name]: {} },
            }
          : { ...current, describerProgram: registration.program },
      );
    }

    return { status: already ? "already-registered" : "registered" };
  }
}
