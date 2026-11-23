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
}

const IN_TREE_DESCRIBER = "packages/describers/claude/dist/bin.js";

function isReference(command: readonly string[], program: string): boolean {
  return (
    command[0] === program ||
    command.some((item) => item.endsWith(IN_TREE_DESCRIBER))
  );
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
  const tree = filled.find((item) => item.endsWith(IN_TREE_DESCRIBER));
  const folder =
    tree === undefined
      ? null
      : ports.describer.folderInRepository(input.root, tree);

  return {
    id: "describe:arguments",
    line: "the describer rejects the arguments the scan passes",
    needs: ["describe"],
    fix:
      folder === null
        ? installFix(input.install, filled[0] as string)
        : {
            text: "npm run build",
            command: ["npm", "run", "build"],
            cwd: folder,
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

  if (isReference(describer.command, reference)) {
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
