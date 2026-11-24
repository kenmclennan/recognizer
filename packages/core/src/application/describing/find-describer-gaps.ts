import type { DescriberBuild } from "../../domain/config-repository.js";
import { type Gap, installFix } from "../../domain/gap.js";
import {
  NO_RUN_LINE,
  probeDescriberCheck,
} from "../plugins/probe-describer-check.js";
import { describerProgram } from "../plugins/shipped-plugins.js";
import type { DescribingPorts } from "./internal/describing-ports.js";
import type { LocatedDescriber } from "./ports/describer.js";
import type { DescriberRef } from "./ports/describer-ref.js";

export interface FindDescriberGapsInput {
  root: string;
  describe: boolean;
  located: LocatedDescriber;
  install: Record<string, string>;
  build: DescriberBuild | null;
}

function isReference(
  command: readonly string[],
  program: string,
  build: DescriberBuild | null,
): boolean {
  return command[0] === program || build !== null;
}

function argumentsGap(
  ports: DescribingPorts,
  input: FindDescriberGapsInput,
  describer: DescriberRef,
): Gap | null {
  const check = probeDescriberCheck(
    (program, args, cwd) => ports.describer.probe(program, args, cwd),
    input.root,
    describer.command,
  );

  if (check.kind === "passed") {
    return null;
  }

  if (check.kind === "no-run") {
    return {
      id: "describe:arguments",
      line: NO_RUN_LINE,
      needs: ["describe"],
      fix: installFix(input.install, describer.command[0] as string),
    };
  }

  const filled = check.words;
  const { build } = input;

  return {
    id: "describe:arguments",
    line: "the describer rejects the arguments the scan passes",
    needs: ["describe"],
    fix:
      build === null
        ? installFix(input.install, filled[0] as string)
        : {
            text: build.command.join(" "),
            command: build.command,
            cwd: build.directory,
            env: {},
            kind: "repository",
          },
  };
}

export function findDescriberGaps(
  ports: DescribingPorts,
  input: FindDescriberGapsInput,
): Gap[] {
  if (!input.describe) {
    return [];
  }

  const describer = input.located.describer;
  const reference = describerProgram(ports.describer.shippedName());

  if (describer === null) {
    return [
      {
        id: "describe:missing",
        line: `no describer is registered and ${reference} is not installed`,
        needs: ["describe"],
        fix: installFix(input.install, reference),
      },
    ];
  }

  if (isReference(describer.command, reference, input.build)) {
    const gap = argumentsGap(ports, input, describer);

    return gap === null ? [] : [gap];
  }

  const program = describer.command[0] as string;
  const probe = ports.describer.probe(program, ["--version"], input.root);

  return probe.started
    ? []
    : [
        {
          id: "describe:program",
          line: `the describer program ${program} does not start`,
          needs: ["describe"],
          fix: installFix(input.install, program),
        },
      ];
}
