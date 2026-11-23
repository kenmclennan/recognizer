import {
  interpretManifest,
  MANIFEST_TIMEOUT_MS,
  type ManifestRead,
  type ManifestRun,
} from "../../domain/plugins/manifest.js";
import type { DocumentValidators } from "./ports/document-validators.js";
import type { Programs } from "./ports/programs.js";

interface ManifestPorts {
  programs: Programs;
  validators: DocumentValidators;
}

export function runManifest(
  ports: Pick<ManifestPorts, "programs">,
  command: string,
  cwd?: string,
  leading: string[] = [],
): ManifestRun {
  return ports.programs.run(command, [...leading, "manifest"], {
    timeoutMs: MANIFEST_TIMEOUT_MS,
    ...(cwd === undefined ? {} : { cwd }),
  });
}

export function readManifest(
  ports: ManifestPorts,
  command: string,
): ManifestRead {
  return interpretManifest(command, runManifest(ports, command), (value) =>
    ports.validators.manifest(value),
  );
}

export function readManifestOf(
  ports: ManifestPorts,
  prefix: string[],
): ManifestRead {
  const [program, ...leading] = prefix as [string, ...string[]];

  return interpretManifest(
    prefix.join(" "),
    runManifest(ports, program, undefined, leading),
    (value) => ports.validators.manifest(value),
  );
}
