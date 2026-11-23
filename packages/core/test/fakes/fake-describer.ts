import type {
  DescribeCall,
  DescribeResult,
  Describer,
  DescriberRef,
  LocatedDescriber,
  Projection,
  RunEntry,
} from "../../src/index.js";

export class FakeDescriber implements Describer {
  registered = false;
  projected: Projection = { modules: 2, cost_usd: 8 };
  described: string[] = [];
  command: readonly string[] = ["quill", "run"];
  unavailable = new Set<string>();
  folder: string | null = null;

  locate(): LocatedDescriber {
    return {
      describer: this.registered
        ? ({ describerRef: true, command: this.command } as DescriberRef)
        : null,
      shipped: false,
    };
  }

  refuseShipped(): void {}

  probe(program: string): { started: boolean; status: number | null } {
    return this.unavailable.has(program)
      ? { started: false, status: null }
      : { started: true, status: 0 };
  }

  shippedName(): string {
    return "claude";
  }

  folderInRepository(): string | null {
    return this.folder;
  }

  settings(): { model: string; batchSize: number } {
    return { model: "quill", batchSize: 2 };
  }

  async describe(call: DescribeCall): Promise<DescribeResult> {
    call.onProjection(this.projected);

    if (call.confirm !== undefined && !(await call.confirm(this.projected))) {
      return { stopped: null };
    }

    call.onStart(this.projected.modules);

    for (let index = 0; index < this.projected.modules; index += 1) {
      const name = `module-${index}`;
      const entry: RunEntry = {
        name,
        command: ["quill"],
        status: 0,
        outcome: "ok",
        duration_ms: 1,
        stderr: "",
      };

      this.described.push(name);
      call.onEntry(entry);
    }

    return { stopped: null };
  }
}
