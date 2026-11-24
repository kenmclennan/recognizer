export interface RetiredKey {
  path: string[];
  message: string;
  tolerated?: true;
}

const DELETE =
  "delete the key; recognizer config --unset does that and removes a section it leaves empty";

export const RETIRED_KEYS: RetiredKey[] = [
  {
    path: ["overlays"],
    message:
      "config/overlays is retired: measurers are gone, a sensor measures for itself; remove the overlays key and register the sensor under sensors",
  },
  {
    path: ["sensors", "structure", "distance_threshold"],
    message: `config/sensors/structure/distance_threshold was removed: the stable abstractions warning it tuned is gone, so the setting did nothing; ${DELETE}`,
  },
  {
    path: ["sensors", "structure", "hub_threshold"],
    message: `config/sensors/structure/hub_threshold was removed: the hub warning it tuned is gone, so the setting did nothing; ${DELETE}`,
  },
  {
    path: ["sensors", "structure", "instability_gap"],
    message: `config/sensors/structure/instability_gap was removed: the stable dependencies warning it tuned is gone, so the setting did nothing; ${DELETE}`,
  },
  {
    path: ["sensors", "structure", "composition_roots"],
    message: `config/sensors/structure/composition_roots was removed: it only exempted the depending side of the stable dependencies warning, which is gone; ${DELETE}`,
  },
  {
    path: ["sensors", "structure", "warnings", "stable_abstractions"],
    message: `config/sensors/structure/warnings/stable_abstractions was removed: the warning is gone, so the switch did nothing; ${DELETE}`,
  },
  {
    path: ["sensors", "structure", "warnings", "hub"],
    message: `config/sensors/structure/warnings/hub was removed: the hub warning rested on no published principle, so the switch did nothing; ${DELETE}`,
  },
  {
    path: ["sensors", "structure", "warnings", "stable_dependencies"],
    message: `config/sensors/structure/warnings/stable_dependencies was removed: a folder is not a component, so the stable dependencies principle has nothing to apply to; ${DELETE}`,
  },
  {
    path: ["sensors", "structure", "warnings", "folder_cycle"],
    message: `config/sensors/structure/warnings/folder_cycle was removed: a folder declares no imports, so the warning had nothing of its own to report on a file; ${DELETE} (file-level cycles are still reported by the cycle warning)`,
  },
  {
    path: ["sensors", "structure", "warnings", "policy_drift"],
    message: `config/sensors/structure/warnings/policy_drift was removed: a policy that is out of date is a problem with the policy file, not a finding about the code, so it is always reported and there is nothing to switch; ${DELETE}`,
  },
  {
    path: ["sensors", "thresholds"],
    tolerated: true,
    message:
      "config/sensors/thresholds was retired: the thresholds sensor is gone, a coverage sensor reports low coverage and structural analysis reports complexity; recognizer doctor gives the commands that move it",
  },
];

export function retiredKeyFor(dotted: string): RetiredKey | undefined {
  return RETIRED_KEYS.find((retired) => {
    const path = retired.path.join(".");

    return dotted === path || dotted.startsWith(`${path}.`);
  });
}

export const RETIRED_POLICY_KEYS = [
  "components",
  "levels",
  "uses",
  "foreign",
] as const;
