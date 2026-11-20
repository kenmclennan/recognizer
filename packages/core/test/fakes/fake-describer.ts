import type {
  DescribeCall,
  DescribeResult,
  Describer,
  DescriberGapsInput,
  DescriberRef,
  Gap,
  LocatedDescriber,
  Projection,
  RunEntry,
} from "../../src/index.js";

export class FakeDescriber implements Describer {
  registered = false;
  projected: Projection = { modules: 2, cost_usd: 8 };
  described: string[] = [];
  needs: Gap[] = [];

  locate(): LocatedDescriber {
    return {
      describer: this.registered
        ? ({ describerRef: true } as DescriberRef)
        : null,
      shipped: false,
    };
  }

  refuseShipped(): void {}

  gaps(_input: DescriberGapsInput): Gap[] {
    return this.needs;
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
